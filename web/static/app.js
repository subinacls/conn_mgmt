
let socket;
let term;
let editMode = false;
let editingAlias = null;

document.addEventListener("DOMContentLoaded", () => {
    const tooltipTriggerList = [].slice.call(document.querySelectorAll('[data-bs-toggle="tooltip"]'));
    tooltipTriggerList.forEach(el => new bootstrap.Tooltip(el));
});

function checkAndShowSudo(alias) {
    console.log("Checking sudo for", alias);

    fetch(`/api/profiles/${alias}/introspect`)
        .then(res => res.json())
        .then(data => {
            const el = document.getElementById(`sudo-test-${alias}`);
            if (!el) return;

            if (data.error) {
                el.innerHTML = `❌ ${data.error}`;
            } else if (data.has_sudo) {

                const lowerDetails = (data.sudo_details || "").toLowerCase();
                const requiresPassword = (
                    /require.*password/.test(lowerDetails) &&
                    !lowerDetails.includes("passwordless") &&
                    !lowerDetails.includes("no password required") &&
                    !lowerDetails.includes("nopasswd")
                );

                insertSudoElevateUI(alias, data.sudo_details, requiresPassword);

            } else {
                el.innerHTML = `⚠️ ${data.sudo_details || "No sudo access"}`;
            }
        })
        .catch(err => {
            const el = document.getElementById(`sudo-test-${alias}`);
            if (el) el.innerHTML = "❌ Failed to check sudo.";
        });
}

function updateConnectionStatus(alias) {
    fetch(`/api/status/${alias}`)
        .then(res => res.json())
        .then(data => {
            const statusEl = document.getElementById(`status-connect-${alias}`);
            const lastSeenEl = document.getElementById(`last-seen-${alias}`);
            const button = document.getElementById(`toggle-btn-${alias}`);

            if (!statusEl) return;

            if (data.connected) {
                statusEl.innerHTML = '🔌 <span style="color:deepskyblue">Connected</span>';
                if (lastSeenEl) lastSeenEl.style.display = "none";
                if (button) {
                    button.classList.remove("btn-primary");
                    button.classList.add("btn-danger");
                    button.textContent = "Disconnect";
                }
            } else {
                statusEl.innerHTML = '❌ <span style="color:gray">Not Connected</span>';
                if (lastSeenEl) lastSeenEl.style.display = "inline";
                if (button) {
                    button.classList.remove("btn-danger");
                    button.classList.add("btn-outline-warning");
                    button.textContent = "Connect";
                }
            }
        })
        .catch(() => {
            const statusEl = document.getElementById(`status-connect-${alias}`);
            if (statusEl) {
                statusEl.innerHTML = '⚠️ <span style="color:red">Error</span>';
            }
        });
}


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
    const togglebutton = document.getElementById(`toggle-btn-${alias}`);

    fetch(`/api/status/${alias}`)
        .then(res => res.json())
        .then(data => {
            if (el) {
                if (data.connected) {
                    el.innerHTML = '🔌 <span style="color:deepskyblue">Connected</span>';
                    const isConnected = true;
                } else {
                    el.innerHTML = '❌ <span style="color:yellow">Not Connected</span>';
                    const isConnected = false;
                }
            }

            if (!togglebutton && !attachBtn) {
                // DOM not ready — skip update
                return;
            }


            if (togglebutton) {
                if (data.connected) {
                    togglebutton.classList.remove("btn-outline-warning");
                    togglebutton.classList.add("btn-danger");
                    togglebutton.textContent = "Disconnect";
                } else {
                    togglebutton.classList.remove("btn-danger");
                    togglebutton.classList.add("btn-outline-warning");
                    togglebutton.textContent = "Connect to";
                }

            }
        });
}


function checkRemoteProfile(alias) {
    fetch(`/api/profiles/${alias}/introspect`)

        .then(res => res.json())
        .then(data => {
            const el = document.getElementById(`status-profile-${alias}`);
            if (!el) return;

            if (data.error) {
                el.innerHTML = `⚠️ <span style="color:orange">${data.error}</span>`;
            } else {
                el.innerHTML = `
                    <table class="table table-sm table-borderless text-white mb-0" style="font-size: 0.9rem;">
                    <tbody>
                        <tr>
                        <td>🧠 Host</td>
                        <td><span style="color:#00e1ff;">${data.hostname}</span></td>
                        </tr>
                        <tr>
                        <td>👤 User</td>
                        <td><span style="color:#00e1ff;">${data.user}</span></td>
                        </tr>
                        <tr>
                        <td>🔐 Sudo</td>
                        <td>
                            ${data.has_sudo
                            ? '<span style="color:lime">✔ sudo</span>'
                            : '<span style="color:gray">✖ no sudo</span>'}
                        </td>
                        </tr>
                    </tbody>
                    </table>
                `;
            }
        })
        .catch(err => {
            const el = document.getElementById(`status-profile-${alias}`);
            if (el) {
                el.innerHTML = `⚠️ <span style="color:red">Profile error</span>`;
            }
        });
}


    function refreshProfiles() {
        fetch("/api/profiles")
            .then(res => res.json())
            .then(data => {
                profileList.innerHTML = "";
                Object.entries(data).forEach(([alias, info]) => {
                    fetch(`/api/status/${alias}`)
                        .then(res => res.json())
                        .then(status => {
                            const isConnected = status.connected === true;

                            if (isConnected) {
                                checkRemoteProfile(alias);
                                checkAndShowSudo(alias);
                            }
                            const col = document.createElement("div");
                            col.className = "col-12 col-sm-6 col-md-4 col-lg-3 d-flex align-items-stretch";

                            const jumpInfo = info.jumpHost
                                ? `<br><span class="text-warning">🛰️ Jump via: <code>${info.jumpHost}</code></span>` : "";
                            const lastSeen = info.last_seen
                                ? `<br><small class="text-muted" id="last-seen-${alias}" style="display:none">Last Seen: ${info.last_seen}</small>` : "";

                            const card = document.createElement("div");
                            card.className = "card bg-secondary text-white h-100 p-3";
                            card.style.minHeight = "200px";

                            const statusSpan = document.createElement("span");
                            statusSpan.id = `status-${alias}`;
                            card.appendChild(statusSpan);

                            card.innerHTML += `
                                <div class="delete-tab" onclick="deleteProfile('${alias}')">✖</div>
                                <div>
                                    <strong>${alias}</strong> → ${info.host}:${info.port} (${info.username})
                                </div>
                                <div>
                                    ${jumpInfo}
                                    ${lastSeen}
                                </div>

                                <div class="d-flex justify-content-between mt-1 mb-2">
                                    <div id="status-health-${alias}">🔄 Checking...</div>
                                    <div id="status-connect-${alias}">🔄 Checking...</div>
                                </div>

                                <div class="d-flex justify-content-start gap-2">
                                    <!-- Connect / Disconnect -->
                                    <button id="toggle-btn-${alias}" class="btn btn-sm mt-3 ${isConnected ? 'btn-danger' : 'btn-primary'}"
                                        onclick="toggleConnection('${alias}', this)"
                                        data-bs-toggle="tooltip"
                                        title="${isConnected ? 'Disconnect from this host' : 'Establish an SSH connection'}">
                                        ${isConnected ? 'Disconnect' : 'Connect'}
                                    </button>
                                    <!-- Edit Profile -->
                                    <button class="btn btn-sm btn-outline-light mt-3"
                                        onclick="editProfile('${alias}')"
                                        data-bs-toggle="tooltip"
                                        title="Edit this SSH profile">
                                        ✏️ Edit Profile
                                    </button>

                                </div>
                                <br>
                                <div class="d-flex gap-2">
                                    <!-- Show SSH Details -->
                                    <button class="btn btn-sm btn-light w-100"
                                        onclick="showDetails('${alias}')"
                                        data-bs-toggle="tooltip"
                                        title="View the SSH command and connection details">
                                        🔍 Details
                                    </button>
                                </div>

                                <button></button>

                                <div id="status-profile-${alias}" style="${isConnected ? 'display:inline-block;' : 'display:none;'}" class="text-info small">🔄 Checking...</div>

                                <br>
                                <div>
                                    <div id="sudo-test-${alias}" class="mt-2 text-warning"></div>
                                </div>
                                <br>

                                <div class="mt-2 d-grid gap-2">

                                    <!-- Attach (Terminal) -->
                                    <button id="attach-btn-${alias}" class="btn btn-sm btn-warning me-2 w-100"
                                        style="${isConnected ? 'display:inline-block;' : 'display:none;'}"
                                        onclick="openTerminal('${alias}', false)"
                                        data-bs-toggle="tooltip"
                                        title="Open a remote terminal session in XTerm">
                                        🖥️ XTerm
                                    </button>

                                    <!-- Download Log -->
                                    <button id="log-btn-${alias}" class="btn btn-sm btn-info w-100"
                                        style="${isConnected ? 'display:inline-block;' : 'display:none;'}"
                                        onclick="downloadLog('${alias}')"
                                        data-bs-toggle="tooltip"
                                        title="Download the recorded terminal session logs">
                                        📄 Term Logs
                                    </button>

                                    <!-- Inject Public Key -->
                                    <button id="injectkey-btn-${alias}" class="btn btn-sm mt-1 w-100"
                                        style="${isConnected ? 'background-color: #28a745; color: #fff; font-weight: bold;' : 'display:none;'}"
                                        onclick="injectKey('${alias}')"
                                        data-bs-toggle="tooltip"
                                        title="Copy your local public SSH key into the remote authorized_keys">
                                        🔑 Inject Keys
                                    </button>

                                    <div class="d-flex gap-2">
                                        <button class="btn btn-sm btn-outline-info mb-3 mt-1 w-100 fw-bold rounded-2 shadow-sm"
                                            style="${isConnected ? '' : 'display:none;'}"
                                            onclick="promptAndExecute('${alias}')"
                                            data-bs-toggle="tooltip"
                                            title="Execute a single bash command on the remote host">
                                            ⚙️ CMD
                                        </button>

                                        <!-- Execute Script -->
                                        <button class="btn btn-sm btn-outline-warning mb-3 mt-1 w-100 fw-bold rounded-2 shadow-sm"
                                            style="${isConnected ? '' : 'display:none;'}"
                                            onclick="promptExecuteScript('${alias}')"
                                            data-bs-toggle="tooltip"
                                            title="Paste and run a multi-line bash script on this machine">
                                            📜 SCRIPT
                                        </button>
                                    </div>
                                    <hr>
                                </div>

                            `;

                            col.appendChild(card);
                            profileList.appendChild(col);

                            checkHealthStatus(alias);
                            checkConnectionStatus(alias);
                            setInterval(() => checkHealthStatus(alias), 60000);
                            setInterval(() => checkConnectionStatus(alias), 60000);

                        });

                updateConnectionStatus(alias);
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


function attach(alias, elevate = false) {
    if (term) term.dispose();
    term = new Terminal({
        cols: 120,
        rows: 40,
        scrollback: 10000,
        convertEol: true,
        cursorBlink: true,
        theme: { background: "#000000" }
    });
    term.open(document.getElementById("terminal"));
    term.focus();

    // Show terminal modal
    document.getElementById("terminalModal").style.display = "block";

    // Ensure socket is ready
    if (!socket) {
        socket = io();
    }

    // Setup clean listener
    socket.off("shell_output");
    socket.on("shell_output", data => {
        term.write(data);
    });

    term.onData(data => {
        socket.emit("shell_input", data);
    });

    // Correct emit (with elevate flag)
    socket.emit("start_session", { alias, elevate });
}


document.addEventListener("DOMContentLoaded", () => {
    const profileList = document.getElementById("profileList");
    const sessionList = document.getElementById("sessionList");
    const addForm = document.getElementById("addForm");

    populateSFTPAliases()

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
                return res.json().then(err => alert("❌ Error: " + err.error));
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


    refreshProfiles();
    refreshSessions();
});


function deleteProfile(alias) {
    if (!confirm(`Are you sure you want to delete profile "${alias}"?`)) return;

    fetch(`/api/profiles/${alias}`, { method: 'DELETE' })
        .then(res => {
            if (!res.ok) throw new Error("Failed to delete");
            // Remove from DOM or refresh UI
            const el = document.getElementById(`card-${alias}`);
            if (el) el.remove();
        })
        .catch(err => alert("❌ Could not delete profile."));
}


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

window.addEventListener("DOMContentLoaded", () => {
    document.querySelectorAll("[id^='attach-btn-']").forEach(btn => {
        btn.style.display = "none";
    });
});

function toggleConnection(alias, button) {
    button.disabled = true;
    const originalText = button.textContent;
    button.textContent = "Processing...";

    fetch(`/api/status/${alias}`)
        .then(res => res.json())
        .then(data => {
            if (data.connected) {
                // If connected, disconnect
                fetch(`/api/disconnect/${alias}`, { method: 'POST' })
                    .then(res => res.json())
                    .then(() => {

                        button.classList.remove("btn-danger");
                        button.classList.add("btn-primary");
                        button.textContent = "🔌 Connect";

                        refreshProfiles();

                    })
                    .catch(() => {
                        console.error("Connection error:", err);
                        alert("❌ Error disconnecting:\n" + (err.message || err));
                        button.textContent = originalText;
                    })
                    .finally(() => button.disabled = false);
            } else {
                // If not connected, connect
                fetch(`/api/connect/${alias}`, { method: 'POST' })
                    .then(res => res.json())
                    .then(resp => {

                        const status = resp.status?.toLowerCase() || "";
                        const message = resp.message?.toLowerCase() || "";

                        if (
                            status === "connected" ||
                            message.includes("connected")
                        ) {
                            button.classList.remove("btn-primary");
                            button.classList.add("btn-danger");
                            button.textContent = "Disconnect";

                        } else {
                            alert("❌ Failed to connect: " + (resp.message || "Unknown error"));
                            button.textContent = originalText;

                        }

                        refreshProfiles();
                    })
                    .catch((err) => {
                        console.error("Connection error:", err);
                        alert("❌ Error connecting:\n" + (err.message || err));
                        button.textContent = originalText;
                    })
                    .finally(() => button.disabled = false);
            }
        })
        .catch(() => {
            alert("❌ Failed to check status.");
            button.textContent = originalText;
            button.disabled = false;
        });
}


document.addEventListener("DOMContentLoaded", () => {
    const aliases = document.querySelectorAll("[id^=toggle-btn-]");
    aliases.forEach(el => {
        const alias = el.id.replace("toggle-btn-", "");
        checkConnectionStatus(alias);
    });
});

function openTerminal(alias, elevate = false) {
   // Show modal
    const modal = document.getElementById("terminalModal");
    modal.style.display = "block";

    // Ensure the container exists and is clean
    const container = document.getElementById("terminal");
    container.innerHTML = "";  // Clear any previous content

    // Initialize terminal
    const term = new Terminal({
        scrollback: 10000,
        convertEol: true,
        cursorBlink: true
    });

    // Load fit addon
    const fitAddon = new FitAddon.FitAddon(); // If using CDN
    term.loadAddon(fitAddon);

    // Open and fit terminal
    term.open(container);
    fitAddon.fit();
    term.focus();

    // Handle resizing
    window.addEventListener("resize", () => {
        fitAddon.fit();
    });

    // Connect to socket and start session
    socket = io();

    socket.emit("start_session", { alias, elevate });  // now dynamic
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
                const icon = file.permissions.startsWith('d') ? '📁' : '📄';
                row.innerHTML = `
                    <td>${file.isdir ? "📁" : "📄"} ${file.filename}</td>
                    <td>${icon}<code>${file.permissions}</code></td>
                    <td>${file.isdir ? "-" : file.size}</td>
                    <td>${new Date(file.mtime * 1000).toLocaleString()}</td>
                    <td>
                        ${!file.isdir ? `<button class="btn btn-sm btn-success" onclick="downloadFile('${alias}', '${path}/${file.filename}')">Download</button>` : ""}
                    </td>
                `;
                sftpList.appendChild(row);
            });
        } else {
            alert("❌ Failed to list directory: " + data.error);
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
            alert("❌ Upload failed: " + resp.error);
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

            // Build the ssh command string
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

            // Format additional metadata
            let extraInfo = "";
            if (profile.jumpHost) {
                extraInfo += `<div><strong>Jump Host:</strong> ${profile.jumpHost}</div>`;
            }
            if (profile.last_seen) {
                extraInfo += `<div><strong>Last Seen:</strong> ${profile.last_seen}</div>`;
            }

            // Inject into modal
            document.getElementById("detailsContent").innerHTML = `
                <pre class="mb-2">${cmd}</pre>
                ${extraInfo}
            `;

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
            alert(` ${data.message}`);
        } else {
            alert(`❌ Failed to inject key: ${data.error || 'Unknown error'}`);
        }
    })
    .catch(err => {
        console.error("Error injecting key:", err);
        alert("❌ Error injecting key");
    });
}

function promptAndExecute(alias) {
    const command = prompt(`Enter bash command to run on ${alias}`);
    if (!command) return;

    fetch(`/api/execute_command/${alias}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command })
    })
    .then(res => res.json())
    .then(result => {
        if (result.error) {
            alert(`❌ Error: ${result.error}`);
        } else {
            alert(`✅ Output:\n${result.output || '(no output)'}\n\n❌ Errors:\n${result.error || '(none)'}`);
        }
    })
    .catch(err => {
        alert("Request failed: " + err);
    });
}



function sendCommand(alias, scriptText) {
    const encoded = btoa(scriptText);
    fetch("/api/execute_command", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ alias: alias, command: encoded })
    })
    .then(res => res.json())
    .then(data => {
        alert("Output:\n" + (data.output || data.error));
    })
    .catch(err => alert("Error: " + err));
}

function promptAndSendScript(alias) {
    const rawScript = prompt("Paste your bash function/script below:");
    if (!rawScript) return;

    const b64 = btoa(rawScript);

    fetch(`/api/run_b64_script/${alias}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ b64 })
    })
    .then(res => res.json())
    .then(result => {
        if (result.error) {
            alert(`❌ Error: ${result.error}`);
        } else {
            alert(`✅ Output:\n${result.output || '(no output)'}\n\n❌ Errors:\n${result.error || '(none)'}`);
        }
    });
}




function executeBase64Script(alias, rawScript) {
    const b64script = btoa(rawScript);
    fetch("/api/execute_b64", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ alias, b64script }),
    })
    .then(res => res.json())
    .then(data => {
        if (data.error) {
            alert("❌ Error:\n" + data.error);
        } else {
            alert("✅ Output:\n" + data.output + (data.error ? "\n\n⚠️ Stderr:\n" + data.error : ""));
        }
    })
    .catch(err => {
        console.error("Error executing script:", err);
        alert("❌ Failed to execute script.");
    });
}


function insertSudoElevateUI(alias, details, requiresPassword = false) {
    const el = document.getElementById(`sudo-test-${alias}`);
    if (!el) return;
    const checkbox = `<input class="form-check-input" type="checkbox" disabled ${requiresPassword ? "" : "checked"}>`;
    const label = `<label class="form-check-label ${requiresPassword ? "text-warning" : "text-success"}">
        ${requiresPassword ? "⚠️ Password required" : "✅ No password"}
    </label>`;

    el.innerHTML = `
        <div class="p-2 mt-2 rounded border border-warning bg-dark text-white">
            <div class="form-check mb-2">
                ${checkbox}
                ${label}
            </div>

            <div class="d-flex gap-2 justify-content-start">
                <button class="btn btn-sm btn-dark btn-outline-warning"
                    onclick="openTerminal('${alias}', true)">
                    🖥️ Terminal
                </button>

                <button class="btn btn-sm btn-dark btn-outline-warning"
                    onclick="backgroundElevatedSession('${alias}')">
                    ⬇ Detached
                </button>
            </div>
        </div>
    `;
}


function launchElevatedSession(alias) {
    try {
        attach(alias, true);
        // open root shell via modal
    } catch (err) {
        console.error("Error launching elevated terminal:", err);
        alert("❌ Could not launch elevated shell.");
    }
}

function backgroundElevatedSession(alias) {
    // const name = prompt("Enter session name:", `${alias}_elevated`);
    if (!name) return;

    fetch(`/api/start_elevated/${alias}?elevate=true&background=true&session_name=${encodeURIComponent(name)}`, {
        method: 'POST'
    })
    .then(res => res.json())
    .then(data => {
        if (data.error) {
            alert(`❌ ${data.error}`);
        } // else {
        //    alert(`✅ Background session '${name}' started.`);
        //}
    });
}
