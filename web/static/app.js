window.addEventListener("beforeunload", () => {
  if (socket) {
    socket.emit("close_session");
    socket.disconnect();
  }
});

document.addEventListener("DOMContentLoaded", () => {
    const profileList = document.getElementById("profileList");
    const addForm = document.getElementById("addForm");

    function refreshProfiles() {
        fetch("/api/profiles")
            .then(res => res.json())
            .then(data => {
                profileList.innerHTML = "";
                Object.entries(data).forEach(([alias, info]) => {
                    const card = document.createElement("div");
                    card.className = "card p-2 mb-2";
                    card.innerHTML = `
                        <strong>${alias}</strong> → ${info.host}:${info.port} (${info.username})
                        <div class="mt-2">
                            <button class="btn btn-sm btn-primary me-2" onclick="connect('${alias}')">Connect</button>
                            <button class="btn btn-sm btn-danger" onclick="disconnect('${alias}')">Disconnect</button>
                        </div>
                    `;
                    profileList.appendChild(card);
                });
            });
    }

    window.connect = function(alias) {
        fetch(`/api/connect/${alias}`, {method: "POST"})
            .then(res => res.json())
            .then(resp => alert(resp.message || resp.error))
            .then(refreshProfiles);
    };

    window.disconnect = function(alias) {
        fetch(`/api/disconnect/${alias}`, {method: "POST"})
            .then(res => res.json())
            .then(resp => alert(resp.message || resp.error))
            .then(refreshProfiles);
    };

    addForm.addEventListener("submit", e => {
        e.preventDefault();
        const formData = new FormData(addForm);
        const jsonData = Object.fromEntries(formData.entries());
        jsonData.port = parseInt(jsonData.port);
        fetch("/api/profiles", {
            method: "POST",
            headers: {"Content-Type": "application/json"},
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
});

let socket;
let term;

function openTerminal() {
    document.getElementById("terminalModal").style.display = "block";

    term = new Terminal({
        cols: 120,
        rows: 40,
        scrollback: 5000,
        convertEol: true
    });
    term.open(document.getElementById("terminal"));

    socket = io();

    const alias = prompt("Enter SSH profile alias to connect:");
    socket.emit("start_session", { alias });

    socket.on("shell_output", (data) => {
        term.write(data);
    });

    term.onData(data => {
        socket.emit("shell_input", data);
    });
}

function closeTerminal() {
    if (socket) socket.disconnect();
    document.getElementById("terminalModal").style.display = "none";
}

