
let socket;
let term;
let editMode = false;
let editingAlias = null;

function checkHealthStatus(alias) {
    const el = document.getElementById(`status-health-${alias}`);
    if (el) {
        el.innerHTML = '🔄 Checking...';
        fetch(`/api/health/${alias}`)
            .then(res => res.json())
            .then(data => {
                if (data.status === "online") {
                    el.innerHTML = '🟢 <span style="color:lime">Online</span>';
                } else {
                    el.innerHTML = '🔴 <span style="color:red">Offline</span>';
                }
            })
            .catch(() => {
                el.innerHTML = '⚠️ <span style="color:red">Error</span>';
            });
    }
}

function checkConnectionStatus(alias) {
    const el = document.getElementById(`status-connect-${alias}`);
    if (el) {
        el.innerHTML = '🔄 Checking...';
        fetch(`/api/status/${alias}`)
            .then(res => res.json())
            .then(data => {
                if (data.connected) {
                    el.innerHTML = '🔌 <span style="color:deepskyblue">Connected</span>';
                } else {
                    el.innerHTML = '❌ <span style="color:gray">Not Connected</span>';
                }
            })
            .catch(() => {
                el.innerHTML = '⚠️ <span style="color:red">Error</span>';
            });
    }
}


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

                    const col = document.createElement("div");
                    col.className = "col-12 col-sm-6 col-md-4 col-lg-3 d-flex align-items-stretch";

                    const card = document.createElement("div");
                    card.className = "card bg-secondary text-white h-100 p-3";
                    card.style.minHeight = "200px";  // or adjust to 250px, etc.

                    const statusSpan = document.createElement("span");
                    statusSpan.id = `status-${alias}`;
                    // statusSpan.innerHTML = '⏳ Checking...';
                    card.appendChild(statusSpan);

                    card.innerHTML += `
                        <strong>${alias}</strong> → ${info.host}:${info.port} (${info.username})
                        <div class="d-flex justify-content-between mt-1 mb-2">
                            <div id="status-health-${alias}">🔄 Checking...</div>
                            <div id="status-connect-${alias}">🔄 Checking...</div>
                        </div>
                        <div class="mt-2 d-grid gap-2">
                            <button class="btn btn-sm btn-primary me-2 w-100" onclick="connect('${alias}')">Connect</button>
                            <button class="btn btn-sm btn-dark w-100" onclick="showDetails('${alias}')">Details 🔍</button>
                            <button class="btn btn-sm btn-warning me-2 w-100" onclick="attach('${alias}')">Attach</button>
                            <button class="btn btn-sm btn-outline-light me-2 w-100" onclick="editProfile('${alias}')">Edit</button>
                            <button class="btn btn-sm btn-info w-100" onclick="downloadLog('${alias}')">Get Log</button>
                            <button class="btn btn-sm btn-danger me-2 w-100" onclick="disconnect('${alias}')">Disconnect</button>
                            <button class="btn btn-sm btn-danger w-100" onclick="deleteProfile('${alias}')">Delete</button>
                            <button class="btn btn-sm btn-outline-success mt-1 w-100" onclick="injectKey('${alias}')">🔑 Inject Public Key</button>
                        </div>
                    `;

                    col.appendChild(card);
                    profileList.appendChild(col);

                    // profileList.appendChild(card);

                    // Immediately check health
                    checkHealthStatus(alias);
                    checkConnectionStatus(alias);
                    //checkHealth(alias);
                    // Then periodically every 30 seconds
                    setInterval(() => checkHealth(alias), 30000);

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
            key_text: document.getElementById("key_text").value,
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
            document.getElementById("key_text").value = profile.key_text || "";
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
    button.disabled = true;
    button.textContent = "Processing...";

    fetch(`/api/status/${alias}`)
        .then(res => res.json())
        .then(data => {
            if (data.connected) {
                fetch(`/api/disconnect/${alias}`, { method: 'POST' })
                    .then(() => {
                        button.classList.remove("btn-danger");
                        button.classList.add("btn-primary");
                        button.textContent = "Connect";
                        button.disabled = false;
                        checkConnectionStatus(alias);
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
                        button.disabled = false;
                        checkConnectionStatus(alias);
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

function showDetails(alias) {
    fetch("/api/profiles")
        .then(res => res.json())
        .then(data => {
            const profile = data[alias];
            if (!profile) return alert("Profile not found");

            let cmd = `ssh `;

            if (profile.key_file) {
                cmd += `-i ${profile.key_file} `;
            }
            if (profile.jumpHost) {
                cmd += `-J ${profile.jumpHost} `;
            }
            if (profile.gatewayPorts) {
                cmd += `-g `;
            }
            if (profile.compression) {
                cmd += `-C `;
            }
            if (profile.agentForwarding) {
                cmd += `-A `;
            }
            if (profile.x11Forwarding) {
                cmd += `-X `;
            }
            if (profile.customOptions) {
                cmd += `-o ${profile.customOptions} `;
            }

            cmd += `${profile.username}@${profile.host}`;
            if (profile.port && profile.port !== 22) {
                cmd += ` -p ${profile.port}`;
            }

            document.getElementById("detailsContent").textContent = cmd;
            const modal = new bootstrap.Modal(document.getElementById("detailsModal"));
            modal.show();
        });
}



function injectKey(alias) {
    if (!confirm(`Inject your public key into '${alias}'?`)) return;

    fetch(`/api/inject_key/${alias}`, {
        method: "POST"
    })
    .then(res => res.json())
    .then(data => {
        if (data.message) {
            alert(`✅ ${data.message}`);
        } else {
            alert(`❌ Failed to inject key: ${data.error || 'Unknown error'}`);
        }
    })
    .catch(err => {
        console.error("Error injecting key:", err);
        alert("❌ Error injecting key");
    });
}
