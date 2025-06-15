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
socketio = SocketIO(app, cors_allowed_origins="*", async_mode="eventlet")
#socketio = SocketIO(app)
ssh_mgr = SSHManager()
active_channels = {}  # { sid: channel }

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
        return jsonify({"message": f"Connected to {alias}"})
    except Exception as e:
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500

@app.route("/api/disconnect/<alias>", methods=["POST"])
def disconnect_profile(alias):
    try:
        ssh_mgr.close(alias)
        return jsonify({"message": f"Disconnected {alias}"})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

active_channels = {}


@socketio.on("start_session")
def start_session(data):
    alias = data.get("alias")
    sid = request.sid
    profile = load_profiles().get(alias)

    if not profile:
        emit("shell_output", "[ERROR] Unknown alias\n")
        return

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
        #channel = client.invoke_shell()

        transport = client.get_transport()
        channel = transport.open_session()
        channel.get_pty(term='xterm', width=120, height=40)
        channel.invoke_shell()

        active_channels[sid] = channel

    except Exception as e:
        emit("shell_output", f"[ERROR] {str(e)}\n")
        return


    def read_output():
        try:
            while True:
                if sid not in active_channels:
                    break

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


@socketio.on("disconnect")
def on_disconnect():
    sid = request.sid
    print(f"[DISCONNECT] Socket {sid} disconnected")

    channel = active_channels.pop(sid, None)
    if channel:
        try:
            channel.close()
            print(f"[CLEANUP] SSH session {sid} closed")
        except Exception as e:
            print(f"[ERROR] Closing channel for {sid}: {e}")




@socketio.on("background_session")
def background_session():
    sid = request.sid
    print(f"[BG] Backgrounding session: {sid}")
    # Do nothing — just detach from the terminal UI

@socketio.on("close_session")
def close_session():
    sid = request.sid
    print(f"[CLOSE] Closing session: {sid}")
    ch = active_channels.pop(sid, None)
    if ch:
        try:
            ch.close()
        except Exception as e:
            print(f"[ERROR closing session] {e}")

@socketio.on('shell_input')
def handle_input(data):
    channel = active_channels.get(request.sid)
    if channel:
        try:
            channel.send(data)
        except Exception:
            emit('shell_output', '[ERROR] Channel closed\n')

@socketio.on('disconnect')
def handle_disconnect():
    channel = active_channels.pop(request.sid, None)
    if channel:
        try:
            channel.close()
        except:
            pass

if __name__ == "__main__":
    #app.run(host="0.0.0.0", port=5050, debug=True)
    socketio.run(app, host="0.0.0.0", port=5050, debug=True)
