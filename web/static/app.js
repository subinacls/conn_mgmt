let socket;
let term;
let editMode = false;
let editingAlias = null;

document.addEventListener("DOMContentLoaded", () => {
    const profileList = document.getElementById("profileList");
    const sessionList = document.getElementById("sessionList");
    const addForm = document.getElementById("addForm");

    populateSFTPAliases()

    function refreshProfiles() {
        fetch("/api/profiles")
            .then(res => res.json())
            .then(data => {
                profileList.innerHTML = "";
                Object.entries(data).forEach(([alias, info]) => {
                    const card = document.createElement("div");
                    card.className = "card bg-secondary text-white p-2 mb-2";
                    card.innerHTML = `
                        <strong>${alias}</strong> → ${info.host}:${info.port} (${info.username})
                        <div class="mt-2">
                            <button class="btn btn-sm btn-primary me-2" onclick="connect('${alias}')">Connect</button>
                            <button class="btn btn-sm btn-warning me-2" onclick="attach('${alias}')">Attach</button>
                            <button class="btn btn-sm btn-outline-light me-2" onclick="editProfile('${alias}')">Edit</button>
                            <button class="btn btn-sm btn-info" onclick="downloadLog('${alias}')">Download Log</button>
                            <button class="btn btn-sm btn-danger me-2" onclick="disconnect('${alias}')">Disconnect</button>
                            <button class="btn btn-sm btn-danger" onclick="deleteProfile('${alias}')">Delete</button>
                        </div>
                    `;
                    profileList.appendChild(card);
                });
            });
    }

    function refreshSessions() {
        fetch("/api/sessions")
            .then(res => res.json())
            .then(data => {
                sessionList.innerHTML = "";
                data.forEach(alias => {
                    const item = document.createElement("div");
                    item.className = "card bg-dark text-white p-2 mb-2";
                    item.innerHTML = `
                        <strong>Session:</strong> ${alias}
                        <div class="mt-2">
                            <button class="btn btn-sm btn-success" onclick="attach('${alias}')">Re-Attach</button>
                        </div>
                    `;
                    sessionList.appendChild(item);
                });
            });
    }


    addForm.addEventListener("submit", e => {
        e.preventDefault();
        const body = {
            alias: document.getElementById("alias").value,
            host: document.getElementById("host").value,
            port: parseInt(document.getElementById("port").value),
            username: document.getElementById("username").value,
            password: document.getElementById("password").value,
            key_file: document.getElementById("key_file").value,
            jumpHost: document.getElementById("jumpHost").value,
            gatewayPorts: document.getElementById("gatewayPorts").checked,
            compression: document.getElementById("compression").checked,
            agentForwarding: document.getElementById("agentForwarding").checked,
            x11Forwarding: document.getElementById("x11Forwarding").checked,
            localForward: document.getElementById("localForward").value,
            remoteForward: document.getElementById("remoteForward").value,
            socksProxy: document.getElementById("socksProxy").value,
            customOptions: document.getElementById("customOptions").value
        };

        const url = editMode ? `/api/profiles/${editingAlias}` : "/api/profiles";
        const method = editMode ? "PUT" : "POST";

        fetch(url, {
            method,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body)
        }).then(res => {
            if (!res.ok) {
                return res.json().then(err => alert("Error: " + err.error));
            }
            refreshProfiles();
            addForm.reset();
            editMode = false;
            editingAlias = null;
        });
    });

    window.connect = function (alias) {
        fetch(`/api/connect/${alias}`, { method: "POST" })
            .then(res => res.json())
            .then(resp => {
                alert(resp.message || resp.error);
                refreshProfiles();
                refreshSessions();
                openTerminal(alias);
            });
    };

    window.disconnect = function (alias) {
        fetch(`/api/disconnect/${alias}`, { method: "POST" })
            .then(res => res.json())
            .then(resp => {
                alert(resp.message || resp.error);
                refreshProfiles();
                refreshSessions();
                closeTerminal();
            });
    };

    window.attach = function (alias) {
        openTerminal(alias);
    };


    window.deleteProfile = function (alias) {
        if (confirm(`Are you sure you want to delete the profile '${alias}'? This action cannot be undone.`)) {
            fetch(`/api/profiles/${alias}`, { method: "DELETE" })
                .then(() => {
                    alert(`Profile '${alias}' deleted.`);
                    refreshProfiles();
                });
        }
    };

    refreshProfiles();
    refreshSessions();
});

function editProfile(alias) {
    fetch("/api/profiles")
        .then(res => res.json())
        .then(data => {
            const profile = data[alias];
            if (!profile) return alert("Profile not found");

            // Fill the form
            document.getElementById("alias").value = alias;
            document.getElementById("host").value = profile.host;
            document.getElementById("port").value = profile.port;
            document.getElementById("username").value = profile.username;
            document.getElementById("password").value = profile.password || "";
            document.getElementById("key_file").value = profile.key_file || "";
            document.getElementById("gatewayPorts").checked = !!profile.gatewayPorts;
            document.getElementById("compression").checked = !!profile.compression;
            document.getElementById("agentForwarding").checked = !!profile.agentForwarding;
            document.getElementById("x11Forwarding").checked = !!profile.x11Forwarding;
            document.getElementById("localForward").value = profile.localForward || "";
            document.getElementById("remoteForward").value = profile.remoteForward || "";
            document.getElementById("socksProxy").value = profile.socksProxy || "";
            document.getElementById("customOptions").value = profile.customOptions || "";
            document.getElementById("jumpHost").value = profile.jumpHost || "";

            editMode = true;
            editingAlias = alias;
        });
}


function downloadLog(alias) {
    window.open(`/api/sessions/logs/${alias}`, "_blank");
}

function toggleConnection(alias, button) {
    fetch(`/api/status/${alias}`)
        .then(res => res.json())
        .then(data => {
            if (data.connected) {
                fetch(`/api/disconnect/${alias}`, { method: 'POST' })
                    .then(() => {
                        button.classList.remove("btn-danger");
                        button.classList.add("btn-primary");
                        button.textContent = "Connect";
                    });
            } else {
                fetch(`/api/connect/${alias}`, { method: 'POST' })
                    .then(res => res.json())
                    .then(resp => {
                        if (resp.status === "connected") {
                            button.classList.remove("btn-primary");
                            button.classList.add("btn-danger");
                            button.textContent = "Disconnect";
                        } else {
                            alert("Failed to connect: " + (resp.message || "Unknown error"));
                        }
                    });
            }
        });
}

function openTerminal(alias) {
    document.getElementById("terminalModal").style.display = "block";

    term = new Terminal({
        cols: 120,
        rows: 40,
        scrollback: 10000,
        convertEol: true,
        cursorBlink: true,
    });
    term.open(document.getElementById("terminal"));
    term.focus();

    socket = io();
    socket.emit("start_session", { alias });

    socket.on("shell_output", (data) => {
        console.log("[RECV]", data);
        term.write(data);
    });

    term.onData(data => {
        console.log("[SEND]", data);
        socket.emit("shell_input", data);
    });

    socket.on("disconnect", () => {
        console.log("[DISCONNECTED]");
        term.write("\r\n[DISCONNECTED]\r\n");
    });
}

function closeTerminal() {
    if (socket) {
        socket.disconnect();
        socket = null;
    }
    if (term) {
        term.dispose();
        term = null;
    }
    document.getElementById("terminalModal").style.display = "none";
    refreshSessions();
}


function listRemote() {
    const alias = document.getElementById("sftpAlias").value;
    const path = document.getElementById("sftpPath").value;

    fetch("/api/sftp/list", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ alias, path })
    })
    .then(res => res.json())
    .then(data => {
        const sftpList = document.getElementById("sftpList");
        sftpList.innerHTML = "";
        if (data.files) {
            data.files.forEach(file => {
                const row = document.createElement("tr");
                row.innerHTML = `
                    <td>${file.isdir ? "📁" : "📄"} ${file.filename}</td>
                    <td>${file.isdir ? "-" : file.size}</td>
                    <td>${new Date(file.mtime * 1000).toLocaleString()}</td>
                    <td>
                        ${!file.isdir ? `<button class="btn btn-sm btn-success" onclick="downloadFile('${alias}', '${path}/${file.filename}')">Download</button>` : ""}
                    </td>
                `;
                sftpList.appendChild(row);
            });
        } else {
            alert("Failed to list directory: " + data.error);
        }
    });
}

function downloadFile(alias, fullPath) {
    const url = `/api/sftp/download?alias=${encodeURIComponent(alias)}&path=${encodeURIComponent(fullPath)}`;
    window.open(url, "_blank");
}

function uploadFile() {
    const alias = document.getElementById("sftpAlias").value;
    const path = document.getElementById("sftpPath").value;
    const fileInput = document.getElementById("uploadFile");
    const file = fileInput.files[0];
    if (!file) return alert("No file selected");

    const formData = new FormData();
    formData.append("alias", alias);
    formData.append("path", `${path}/${file.name}`);
    formData.append("file", file);

    fetch("/api/sftp/upload", {
        method: "POST",
        body: formData
    })
    .then(res => res.json())
    .then(resp => {
        if (resp.message) {
            alert("Upload successful");
            listRemote();  // refresh
        } else {
            alert("Upload failed: " + resp.error);
        }
    });
}

function populateSFTPAliases() {
    fetch("/api/profiles")
        .then(res => res.json())
        .then(data => {
            const sftpAlias = document.getElementById("sftpAlias");
            sftpAlias.innerHTML = "";
            Object.keys(data).forEach(alias => {
                const opt = document.createElement("option");
                opt.value = alias;
                opt.textContent = alias;
                sftpAlias.appendChild(opt);
            });
        });
}
