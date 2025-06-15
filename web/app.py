import eventlet
eventlet.monkey_patch()


from flask import Flask, request, render_template, jsonify
from flask_socketio import SocketIO, emit
import traceback
import threading
import time
import select
import paramiko
import os
import json

from core.ssh_manager import SSHManager

app = Flask(__name__)
CONFIG_FILE = os.path.expanduser("~/.ssh_connections.json")
#socketio = SocketIO(app)
socketio = SocketIO(app, cors_allowed_origins="*", async_mode="eventlet")
ssh_mgr = SSHManager()
active_channels = {}      # { sid: channel }
background_sessions = {}  # { alias: channel }
session_logs = {}  # { alias: [lines] }

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
        "key_file": data.get("key_file")
    }
    save_profiles(profiles)
    return jsonify({"message": "Profile saved"}), 200

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

        # Send saved log history first
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
    # Don't close the channel; it's stored in background_sessions

if __name__ == "__main__":
    socketio.run(app, host="0.0.0.0", port=5050, debug=True)
