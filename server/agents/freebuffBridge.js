import * as pty from "node-pty";
import { WebSocketServer, WebSocket } from "ws";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PORT = 5001;

const workspace = fileURLToPath(
  new URL("../../workspace/freebuff/", import.meta.url)
);

const freebuffPath = path.join(
  process.env.APPDATA,
  "npm",
  "freebuff.ps1"
);

const allowedOrigins = new Set([
  "http://localhost:5173",
  "http://localhost:5174",
  "http://127.0.0.1:5173",
  "http://127.0.0.1:5174"
]);

fs.mkdirSync(workspace, { recursive: true });

if (!fs.existsSync(freebuffPath)) {
  throw new Error("Freebuff CLI not found.");
}

// Only pass required operating system variables.
const allowedEnv = new Set([
  "PATH", "PATHEXT", "SYSTEMROOT", "WINDIR",
  "COMSPEC", "USERPROFILE", "USERNAME",
  "APPDATA", "LOCALAPPDATA", "TEMP", "TMP",
  "HOMEDRIVE", "HOMEPATH", "PROGRAMFILES",
  "PROGRAMFILES(X86)", "PROGRAMDATA", "SYSTEMDRIVE"
]);

const env = Object.fromEntries(
  Object.entries(process.env).filter(([key]) =>
    allowedEnv.has(key.toUpperCase())
  )
);

const wss = new WebSocketServer({
  host: "127.0.0.1",
  port: PORT,
  path: "/freebuff",
  maxPayload: 65536,

  verifyClient(info) {
    return allowedOrigins.has(info.origin);
  }
});

let activeSession = false;

wss.on("connection", socket => {
  if (activeSession) {
    socket.close(1013, "A Freebuff session is already running.");
    return;
  }

  activeSession = true;

  let terminal;
  let closed = false;

  function cleanup() {
    if (closed) return;

    closed = true;

    try {
      terminal?.kill();
    } catch {}

    activeSession = false;
  }

  function send(data) {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(data);
    }
  }

  socket.on("error", cleanup);
  socket.on("close", cleanup);

  try {
    terminal = pty.spawn(
      "powershell.exe",
      [
        "-NoLogo",
        "-NoProfile",
        "-File",
        freebuffPath,
        "--cwd",
        workspace
      ],
      {
        name: "xterm-256color",
        cols: 100,
        rows: 30,
        cwd: workspace,
        env
      }
    );

    terminal.onData(data => {
      send(data);
    });

    terminal.onExit(({ exitCode }) => {
      send(`\r\nFreebuff session ended (${exitCode}).\r\n`);
      cleanup();
      socket.close();
    });

    socket.on("message", raw => {
      if (closed) return;

      try {
        const message = JSON.parse(raw.toString());

        if (
          message.type === "input" &&
          typeof message.data === "string"
        ) {
          terminal.write(message.data);
        }

        if (message.type === "resize") {
          const cols = Number(message.cols);
          const rows = Number(message.rows);

          if (
            Number.isInteger(cols) &&
            Number.isInteger(rows) &&
            cols >= 10 && cols <= 300 &&
            rows >= 5 && rows <= 150
          ) {
            terminal.resize(cols, rows);
          }
        }
      } catch {
        send("\r\nInvalid terminal request.\r\n");
      }
    });

  } catch (error) {
    send(`\r\nUnable to start Freebuff: ${error.message}\r\n`);
    cleanup();
    socket.close(1011);
  }
});

wss.on("listening", () => {
  console.log("==============================");
  console.log(" FREEBUFF AGENT BRIDGE ONLINE");
  console.log(` ws://127.0.0.1:${PORT}/freebuff`);
  console.log("==============================");
});

wss.on("error", error => {
  console.error("Bridge error:", error.message);
});
