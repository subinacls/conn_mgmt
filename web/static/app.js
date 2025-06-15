let socket;
let term;

document.addEventListener("DOMContentLoaded", () => {
    const profileList = document.getElementById("profileList");
    const sessionList = document.getElementById("sessionList");
    const addForm = document.getElementById("addForm");

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
                            <!-- <button class="btn btn-sm btn-primary me-2" onclick="toggleConnection('${alias}', this)">Connect</button> -->
                            <button class="btn btn-sm btn-primary me-2" onclick="connect('${alias}')">Connect</button>
                            <button class="btn btn-sm btn-warning me-2" onclick="attach('${alias}')">Attach</button>
                            <button class="btn btn-sm btn-danger" onclick="disconnect('${alias}')">Disconnect</button>
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

    addForm.addEventListener("submit", e => {
        e.preventDefault();
        const formData = new FormData(addForm);
        const jsonData = Object.fromEntries(formData.entries());
        jsonData.port = parseInt(jsonData.port);
        fetch("/api/profiles", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(jsonData)
        })
            .then(res => res.json())
            .then(resp => alert(resp.message || resp.error))
            .then(() => {
                addForm.reset();
                refreshProfiles();
            });
    });

    refreshProfiles();
    refreshSessions();
});

function toggleConnection(alias, button) {
    fetch(`/api/status/${alias}`)
        .then(res => res.json())
        .then(data => {
            if (data.connected) {
                // Currently connected — Disconnect
                fetch(`/api/disconnect/${alias}`, { method: 'POST' })
                    .then(() => {
                        button.classList.remove("btn-danger");
                        button.classList.add("btn-primary");
                        button.textContent = "Connect";
                    });
            } else {
                // Currently disconnected — Connect
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
