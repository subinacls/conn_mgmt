import eventlet
eventlet.monkey_patch()

from flask import Flask, request, render_template, jsonify
from flask_socketio import SocketIO, emit
import traceback
import threading
import time
import select
import stat
import paramiko
import os
import json
import socket

from core.ssh_manager import SSHManager


from pydantic import BaseModel
import base64

class BashScriptPayload(BaseModel):
    alias: str
    b64script: str


app = Flask(__name__)
CONFIG_FILE = os.path.expanduser("~/.ssh_connections.json")
socketio = SocketIO(app, cors_allowed_origins="*", async_mode="eventlet")
ssh_mgr = SSHManager()
active_channels = {}      # { sid: channel }
background_sessions = {}  # { alias: channel }
session_logs = {}         # { alias: [lines] }

def load_profiles():
    if os.path.exists(CONFIG_FILE):
        with open(CONFIG_FILE, 'r') as f:
            return json.load(f)
    return {}

def save_profiles(profiles):
    with open(CONFIG_FILE, 'w') as f:
        json.dump(profiles, f, indent=2)

@app.route("/")
def index():
    profiles = load_profiles()
    return render_template("index.html", profiles=profiles)

@app.route("/api/status/<alias>")
def connection_status(alias):
    is_connected = ssh_mgr.is_connected(alias)
    return jsonify({"connected": is_connected})

@app.route("/api/profiles", methods=["GET"])
def get_profiles():
    return jsonify(load_profiles())

@app.route("/api/profiles", methods=["POST"])
def add_profile():
    data = request.json
    profiles = load_profiles()
    alias = data['alias']
    if alias in profiles:
        return jsonify({"error": "Alias already exists"}), 409

    profiles[alias] = {
        "host": data["host"],
        "port": data.get("port", 22),
        "username": data["username"],
        "password": data.get("password"),
        "key_file": data.get("key_file"),
        "key_text": data.get("key_text", ""),
        "jumpHost": data.get("jumpHost", ""),
        "gatewayPorts": data.get("gatewayPorts", False),
        "localForward": data.get("localForward", ""),
        "remoteForward": data.get("remoteForward", ""),
        "socksProxy": data.get("socksProxy", ""),
        "compression": data.get("compression", False),
        "agentForwarding": data.get("agentForwarding", False),
        "x11Forwarding": data.get("x11Forwarding", False),
        "customOptions": data.get("customOptions", "")
    }
    save_profiles(profiles)
    return jsonify({"message": "Profile saved"}), 200

@app.route("/api/profiles/<alias>", methods=["PUT"])
def update_profile(alias):
    data = request.json
    profiles = load_profiles()
    if alias not in profiles:
        return jsonify({"error": "Alias not found"}), 404

    profiles[alias] = {
        "host": data["host"],
        "port": data.get("port", 22),
        "username": data["username"],
        "password": data.get("password"),
        "key_file": data.get("key_file"),
        "gatewayPorts": data.get("gatewayPorts", False),
        "compression": data.get("compression", False),
        "agentForwarding": data.get("agentForwarding", False),
        "x11Forwarding": data.get("x11Forwarding", False),
        "localForward": data.get("localForward", ""),
        "remoteForward": data.get("remoteForward", ""),
        "socksProxy": data.get("socksProxy", ""),
        "customOptions": data.get("customOptions", ""),
        "jumpHost": data.get("jumpHost", "")
    }

    save_profiles(profiles)
    return jsonify({"message": "Profile updated"}), 200

@app.route("/api/profiles/<alias>", methods=["DELETE"])
def delete_profile(alias):
    profiles = load_profiles()
    if alias in profiles:
        del profiles[alias]
        save_profiles(profiles)
        return "", 204
    return jsonify({"error": "Alias not found"}), 404

@app.route("/api/connect/<alias>", methods=["POST"])
def connect_profile(alias):
    profiles = load_profiles()
    profile = profiles.get(alias)
    if not profile:
        return jsonify({"error": "Profile not found"}), 404
    try:
        ssh_mgr.connect(
            alias=alias,
            host=profile['host'],
            port=profile.get('port', 22),
            username=profile['username'],
            password=profile.get('password'),
            key_file=profile.get('key_file')
        )
        client = ssh_mgr.sessions[alias]
        channel = client.invoke_shell()
        background_sessions[alias] = channel
        return jsonify({"message": f"Connected to {alias}"})
    except Exception as e:
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500

@app.route("/api/disconnect/<alias>", methods=["POST"])
def disconnect_profile(alias):
    try:
        background_sessions.pop(alias, None)
        ssh_mgr.close(alias)
        return jsonify({"message": f"Disconnected {alias}"})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/api/sessions", methods=["GET"])
def get_sessions():
    return jsonify(list(background_sessions.keys()))

@socketio.on("start_session")
def start_session(data):
    alias = data.get("alias")
    sid = request.sid
    profiles = load_profiles()
    profile = profiles.get(alias)

    if not profile:
        emit("shell_output", "[ERROR] Unknown alias\n")
        return

    try:
        channel = background_sessions.get(alias)
        if not channel:
            ssh_mgr.connect(
                alias=alias,
                host=profile['host'],
                port=profile.get('port', 22),
                username=profile['username'],
                password=profile.get('password'),
                key_file=profile.get('key_file')
            )
            client = ssh_mgr.sessions[alias]
            channel = client.invoke_shell()
            background_sessions[alias] = channel

        active_channels[sid] = channel
    except Exception as e:
        emit("shell_output", f"[ERROR] {str(e)}\n")
        return

    def read_output():
        try:
            while sid in active_channels:
                r, _, _ = select.select([channel], [], [], 0.1)
                if r:
                    data = channel.recv(1024).decode("utf-8", errors="ignore")
                    socketio.emit("shell_output", data, to=sid)
                    # log to session_logs
                    if alias not in session_logs:
                        session_logs[alias] = []
                    session_logs[alias].append(data)

        except Exception as e:
            socketio.emit("shell_output", f"[ERROR: recv_loop] {e}\n", to=sid)

    threading.Thread(target=read_output, daemon=True).start()

@socketio.on("shell_input")
def on_shell_input(data):
    channel = active_channels.get(request.sid)
    if channel:
        try:
            channel.send(data)
        except Exception as e:
            emit("shell_output", f"[ERROR: send] {e}\n")

@socketio.on('reattach_session')
def reattach_session(data):
    alias = data.get('alias')
    sid = request.sid

    if alias in background_sessions:
        channel = background_sessions[alias]
        active_channels[sid] = channel

        for line in session_logs.get(alias, []):
            socketio.emit('shell_output', {'output': line}, to=sid)

        def forward_output():
            try:
                while True:
                    rlist, _, _ = select.select([channel], [], [], 0.1)
                    if channel in rlist:
                        output = channel.recv(1024).decode()
                        if output:
                            session_logs[alias].append(output)
                            socketio.emit('shell_output', {'output': output}, to=sid)
            except Exception as e:
                print(f"Error during reattach forward_output: {e}")

        thread = threading.Thread(target=forward_output)
        thread.daemon = True
        thread.start()

        emit('shell_output', {'output': f"Reattached to session '{alias}'\n"})
    else:
        emit('shell_output', {'output': f"No backgrounded session found for '{alias}'\n"})

@socketio.on("disconnect")
def on_disconnect():
    sid = request.sid
    channel = active_channels.pop(sid, None)



@app.route("/api/health/<alias>")
def health_check(alias):
    profiles = load_profiles()
    profile = profiles.get(alias)
    if not profile:
        return jsonify({"status": "offline", "error": "Profile not found"}), 404

    try:
        ip = profile.get("host")
        port = int(profile.get("port", 22))
        sock = socket.create_connection((ip, port), timeout=3)
        sock.close()
        return jsonify({"status": "online"})
    except Exception as e:
        return jsonify({"status": "offline", "error": str(e)})

    try:
        # Check SSH session state
        connected = ssh_mgr.is_connected(alias)
        return jsonify({
            "status": status,
            "connected": connected
        })
    except Exception as e:
        return jsonify({"status": "Connection status failed", "error": str(e)})

@app.route("/api/sftp/list", methods=["POST"])
def sftp_list():
    data = request.json
    alias = data.get("alias")
    path = data.get("path", ".")
    try:
        sftp = ssh_mgr.get_sftp(alias)
        files = []
        for entry in sftp.listdir_attr(path):
            files.append({
                "filename": entry.filename,
                "longname": entry.longname,
                "size": entry.st_size,
                "mtime": entry.st_mtime,
                "isdir": stat.S_ISDIR(entry.st_mode)
            })
        return jsonify({"files": files})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/api/sftp/download", methods=["GET"])
def sftp_download():
    alias = request.args.get("alias")
    path = request.args.get("path")
    try:
        sftp = ssh_mgr.get_sftp(alias)
        with sftp.file(path, 'rb') as f:
            data = f.read()
        filename = os.path.basename(path)
        return app.response_class(data, mimetype="application/octet-stream",
                                  headers={"Content-Disposition": f"attachment; filename={filename}"})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/api/sftp/upload", methods=["POST"])
def sftp_upload():
    alias = request.form.get("alias")
    path = request.form.get("path")  # full target path on remote
    file = request.files["file"]
    try:
        sftp = ssh_mgr.get_sftp(alias)
        with sftp.file(path, 'wb') as f:
            f.write(file.read())
        return jsonify({"message": "Upload successful"})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/api/sessions/logs/<alias>", methods=["GET"])
def get_session_log(alias):
    if alias in session_logs:
        log_text = "".join(session_logs[alias])
        return app.response_class(log_text, mimetype="text/plain")
    return jsonify({"error": "No logs found"}), 404

'''
@app.route("/api/inject_key/<alias>", methods=["POST"])
def inject_key(alias):
    profiles = load_profiles()
    profile = profiles.get(alias)
    if not profile:
        return {"error": "Profile not found"}

    key_path = os.path.expanduser("~/.ssh/id_rsa.pub")
    if not os.path.exists(key_path):
        return {"error": "No public key found at ~/.ssh/id_rsa.pub"}

    with open(key_path, "r") as f:
        pub_key = f.read().strip()

    try:
        manager = SSHManager()
        manager.connect(
            alias=alias,
            host=profile["host"],
            port=profile.get("port", 22),
            username=profile["username"],
            password=profile.get("password"),
            key_file=profile.get("key_file")
        )
        client = manager.sessions[alias]
        manager.inject_authorized_key(client, pub_key)
        manager.close(alias)
        return {"message": f"✅ Public key injected into {alias}"}
    except Exception as e:
        return {"error": str(e)}

'''
@app.route("/api/inject_key/<alias>", methods=["POST"])
def inject_key(alias):
    profiles = load_profiles()
    profile = profiles.get(alias)
    if not profile:
        return {"error": "Profile not found"}

    key_path = os.path.expanduser("~/.ssh/id_rsa.pub")
    if not os.path.exists(key_path):
        return {"error": "No public key found at ~/.ssh/id_rsa.pub"}

    with open(key_path, "r") as f:
        pub_key = f.read().strip()

    try:
        manager = SSHManager()
        manager.connect(
            alias=alias,
            host=profile["host"],
            port=profile.get("port", 22),
            username=profile["username"],
            password=profile.get("password"),
            key_file=profile.get("key_file")
        )
        client = manager.sessions[alias]
        result = manager.inject_authorized_key(client, pub_key)
        manager.close(alias)

        if result == "injected":
            return {"message": f"✅ Public key injected into {alias}"}
        else:
            return {"message": f"ℹ️ Public key already present on {alias}"}

    except Exception as e:
        return {"error": str(e)}
'''
@app.route("/api/execute_command/<alias>", methods=["POST"])
def execute_command(alias):
    data = request.get_json()
    alias = data.get("alias")
    command_b64 = data.get("command")

    if not alias or not command_b64:
        return {"error": "Alias and command required"}, 400

    try:
        decoded_command = base64.b64decode(command_b64).decode()
    except Exception as e:
        return {"error": f"Base64 decode failed: {str(e)}"}, 400

    try:
        manager = SSHManager()

        if alias not in manager.sessions:
            profiles = load_profiles()
            profile = profiles.get(alias)
            if not profile:
                return {"error": "Profile not found"}, 404

            manager.connect(
                alias=alias,
                host=profile["host"],
                port=profile.get("port", 22),
                username=profile["username"],
                password=profile.get("password"),
                key_file=profile.get("key_file")
            )

        client = manager.sessions[alias]
        #stdin, stdout, stderr = client.exec_command(decoded_command)
        #result = stdout.read().decode() + stderr.read().decode()

        channel = manager.shells.get(alias)
        if not channel:
            return {"error": "No active shell for alias"}, 400

        channel.send(decoded_command + "\n")
        time.sleep(0.5)  # Let command execute
        output = ""
        while channel.recv_ready():
            output += channel.recv(4096).decode()

        return {"output": result}
    except Exception as e:
        return {"error": str(e)}, 500

'''
@app.route("/api/execute_command/<alias>", methods=["POST"])
def execute_command(alias):
    data = request.get_json()
    command = data.get("command")

    if not command:
        return {"error": "Command is required"}, 400

    try:
        manager = SSHManager()
        profiles = load_profiles()
        profile = profiles.get(alias)

        if not profile:
            return {"error": f"Profile '{alias}' not found"}, 404

        manager.connect(
            alias=alias,
            host=profile["host"],
            port=profile.get("port", 22),
            username=profile["username"],
            password=profile.get("password"),
            key_file=profile.get("key_file")
        )

        client = manager.sessions[alias]
        stdin, stdout, stderr = client.exec_command(command)
        result = stdout.read().decode() + stderr.read().decode()
        manager.close(alias)

        return {"output": result}
    except Exception as e:
        return {"error": str(e)}, 500


@app.route("/api/execute_b64", methods=["POST"])
def execute_b64_script():
    try:
        data = request.get_json()
        alias = data.get("alias")
        b64script = data.get("b64script")

        profiles = load_profiles()
        profile = profiles.get(alias)
        if not profile:
            return jsonify({"error": "Profile not found"}), 404

        # Decode the script
        script = base64.b64decode(b64script).decode()
        encoded_command = f"bash -c {repr(script)}"

        manager = SSHManager()
        manager.connect(
            alias=alias,
            host=profile["host"],
            port=profile.get("port", 22),
            username=profile["username"],
            password=profile.get("password"),
            key_file=profile.get("key_file")
        )

        client = manager.sessions[alias]
        stdin, stdout, stderr = client.exec_command(encoded_command)
        out = stdout.read().decode().strip()
        err = stderr.read().decode().strip()
        manager.close(alias)

        return jsonify({"output": out, "error": err})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.post("/api/run_b64_script/<alias>")
def run_b64_script(alias: str, data: dict):
    b64_script = data.get("b64")
    if not b64_script:
        return {"error": "No base64 payload provided."}

    profiles = load_profiles()
    profile = profiles.get(alias)
    if not profile:
        return {"error": "Profile not found"}

    try:
        manager = SSHManager()
        manager.connect(
            alias=alias,
            host=profile["host"],
            port=profile.get("port", 22),
            username=profile["username"],
            password=profile.get("password"),
            key_file=profile.get("key_file")
        )
        result = manager.run_b64_script(alias, b64_script)
        manager.close(alias)
        return result
    except Exception as e:
        return {"error": str(e)}



if __name__ == "__main__":
    socketio.run(app, host="0.0.0.0", port=5050, debug=True)


