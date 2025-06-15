import paramiko
import os
import subprocess

SESSION_DIR = "/tmp/ssh_sessions"
os.makedirs(SESSION_DIR, exist_ok=True)

class SSHManager:
    def __init__(self):
        self.sessions = {}  # key: alias, value: paramiko.SSHClient

    def start_session(self, alias, config):
        host = config["host"]
        port = config.get("port", 22)
        username = config["username"]

        # Build base SSH command
        cmd = ["xterm", "-T", f"SSH: {alias}", "-e", "ssh"]

        # Jump host (-J)
        jump = config.get("jumpHost")
        if jump:
            cmd += ["-J", jump]

        # Gateway ports
        if config.get("gatewayPorts"):
            cmd.append("-g")

        # Compression (-C)
        if config.get("compression"):
            cmd.append("-C")

        # Agent forwarding (-A)
        if config.get("agentForwarding"):
            cmd.append("-A")

        # X11 forwarding (-X)
        if config.get("x11Forwarding"):
            cmd.append("-X")

        # Local forwarding
        lf = config.get("localForward")
        if lf:
            cmd += ["-L", lf]

        # Remote forwarding
        rf = config.get("remoteForward")
        if rf:
            cmd += ["-R", rf]

        # SOCKS5 proxy
        dp = config.get("socksProxy")
        if dp:
            cmd += ["-D", dp]

        # Custom -o options (space-separated list of Option=Value)
        custom_opts = config.get("customOptions", "")
        if custom_opts:
            for opt in custom_opts.strip().split():
                cmd += ["-o", opt]

        # Add user@host and port
        cmd += ["-p", str(port), f"{username}@{host}"]

        # Start the SSH session in a new xterm window
        subprocess.Popen(cmd)




    def attach_session(self, alias):
        # Placeholder for attach functionality
        print(f"Attach requested for {alias}")





    def connect(self, alias, host, port=22, username=None, password=None, key_file=None):
        if alias in self.sessions:
            raise Exception(f"Alias '{alias}' already in use.")

        client = paramiko.SSHClient()
        client.set_missing_host_key_policy(paramiko.AutoAddPolicy())

        if key_file:
            pkey = paramiko.RSAKey.from_private_key_file(key_file)
            client.connect(hostname=host, port=port, username=username, pkey=pkey)
        else:
            client.connect(hostname=host, port=port, username=username, password=password)

        self.sessions[alias] = client
        print(f"[+] Connected to {host} as {username}")

    def open_shell(self, alias, elevate=False):
        client = self.sessions.get(alias)
        if not client:
            raise Exception("No active session found for alias.")

        channel = client.invoke_shell()
        print("[+] Shell opened. Interactive session begins.")

        if elevate:
            channel.send("sudo -i\n")

        # Attach local stdin/stdout to remote shell
        import termios, tty, sys, select
        oldtty = termios.tcgetattr(sys.stdin)
        try:
            tty.setraw(sys.stdin.fileno())
            channel.settimeout(0.0)
            while True:
                r, w, e = select.select([channel, sys.stdin], [], [])
                if sys.stdin in r:
                    data = sys.stdin.read(1)
                    if not data:
                        break
                    channel.send(data)
                if channel in r:
                    try:
                        x = channel.recv(1024)
                        if not x:
                            break
                        sys.stdout.write(x.decode())
                        sys.stdout.flush()
                    except Exception:
                        pass
        finally:
            termios.tcsetattr(sys.stdin, termios.TCSADRAIN, oldtty)

    def open_sftp(self, alias):
        client = self.sessions.get(alias)
        if not client:
            raise Exception("No active session found for alias.")

        sftp = client.open_sftp()
        print("[+] SFTP session opened. Type 'exit' to quit.")

        while True:
            try:
                cmd = input("sftp> ").strip()
                if cmd == "exit":
                    break
                elif cmd.startswith("get "):
                    _, remote_path = cmd.split(maxsplit=1)
                    filename = os.path.basename(remote_path)
                    sftp.get(remote_path, filename)
                    print(f"[+] Downloaded {filename}")
                elif cmd.startswith("put "):
                    _, local_path = cmd.split(maxsplit=1)
                    filename = os.path.basename(local_path)
                    sftp.put(local_path, filename)
                    print(f"[+] Uploaded {filename}")
                elif cmd == "ls":
                    for f in sftp.listdir():
                        print(f)
                elif cmd.startswith("cd "):
                    _, path = cmd.split(maxsplit=1)
                    sftp.chdir(path)
                elif cmd == "pwd":
                    print(sftp.getcwd())
                else:
                    print("[-] Unknown SFTP command.")
            except Exception as e:
                print(f"[-] Error: {e}")

        sftp.close()

    def background_shell(self, alias, elevate=False):
        client = self.sessions.get(alias)
        if not client:
            raise Exception("No active session found for alias.")

        session = client.get_transport().open_session()
        session.get_pty()
        if elevate:
            session.exec_command("sudo -i")
        else:
            session.exec_command("/bin/bash")

        # Attach to tmux session
        local_tmux = f"{alias}_bg"
        subprocess.run([
            "tmux", "new-session", "-d", "-s", local_tmux,
            f"ssh {client.get_transport().get_username()}@{client.get_transport().getpeername()[0]}"
        ])
        print(f"[+] Background shell started in tmux session '{local_tmux}'.")

    def close(self, alias):
        if alias in self.sessions:
            self.sessions[alias].close()
            del self.sessions[alias]
            print(f"[+] Session '{alias}' closed.")
        else:
            print("[-] Alias not found.")

    def is_connected(self, alias):
        client = self.sessions.get(alias)
        if not client:
            return False
        transport = client.get_transport()
        return transport is not None and transport.is_active()

    def list_connected_aliases(self):
        return [alias for alias, client in self.sessions.items()
                if client.get_transport() and client.get_transport().is_active()]
