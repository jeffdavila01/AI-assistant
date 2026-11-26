import { useState, useEffect, useRef } from "react";
import {
  Terminal as TerminalIcon,
  X,
  Power,
  ShieldAlert
} from "lucide-react";

import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";

import "@xterm/xterm/css/xterm.css";

function FreebuffTerminal() {
  const container = useRef(null);
  const [status, setStatus] = useState("Connecting");

  useEffect(() => {
    const terminal = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: "Consolas, monospace",
      scrollback: 5000,
      convertEol: false,
      theme: {
        background: "#0b0d10",
        foreground: "#e8e8e8",
        cursor: "#b9a7ff"
      }
    });

    const fit = new FitAddon();

    terminal.loadAddon(fit);
    terminal.open(container.current);
    fit.fit();

    const socket = new WebSocket(
      "ws://127.0.0.1:5001/freebuff"
    );

    function send(message) {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify(message));
      }
    }

    function resize() {
      fit.fit();

      send({
        type: "resize",
        cols: terminal.cols,
        rows: terminal.rows
      });
    }

    socket.onopen = () => {
      setStatus("Connected");
      resize();
      terminal.focus();
    };

    socket.onmessage = event => {
      terminal.write(event.data);
    };

    socket.onerror = () => {
      setStatus("Connection error");

      terminal.writeln(
        "\r\nUnable to connect to Freebuff bridge."
      );
    };

    socket.onclose = event => {
      setStatus("Disconnected");

      terminal.writeln(
        `\r\nSession disconnected. ${event.reason || ""}`
      );
    };

    const input = terminal.onData(data => {
      send({
        type: "input",
        data
      });
    });

    const observer = new ResizeObserver(resize);

    observer.observe(container.current);

    return () => {
      observer.disconnect();
      input.dispose();

      socket.onopen = null;
      socket.onmessage = null;
      socket.onerror = null;
      socket.onclose = null;

      socket.close();
      terminal.dispose();
    };
  }, []);

  return (
    <>
      <div className="freebuff-status">
        <span className={
          status === "Connected"
            ? "freebuff-online"
            : ""
        }>
          {status}
        </span>
      </div>

      <div
        ref={container}
        className="freebuff-terminal"
      />
    </>
  );
}

export default function FreebuffAgent({ visible, onBack, onMenu }) {
  const [started, setStarted] = useState(false);

  function endSession() {
    if (!window.confirm("End the current Freebuff session?")) {
      return;
    }

    setStarted(false);
  }

  return (
    <section
      className="freebuff-workspace"
      hidden={!visible}
    >
      <header className="freebuff-header">

        <button
          className="icon-button"
          aria-label="Toggle sidebar"
          onClick={onMenu}
        >
          <TerminalIcon size={23} />
        </button>

        <div>
          <h2>Freebuff Agent</h2>
          <p>Intelligent coding workspace</p>
        </div>

        {started && (
          <button
            className="agent-end-button"
            onClick={endSession}
          >
            <Power size={16} />
            End session
          </button>
        )}

        <button
          className="icon-button"
          aria-label="Return to AI Chat"
          onClick={onBack}
        >
          <X size={22} />
        </button>

      </header>

      {!started ? (
        <div className="freebuff-welcome">

          <TerminalIcon size={58} />

          <h2>Build something amazing</h2>

          <p>
            Your interactive AI coding assistant.
          </p>

          <div className="freebuff-warning">
            <ShieldAlert size={20} />

            <span>
              Freebuff can edit files and execute
              commands using your computer account.
              Review actions carefully.
              This workspace is not a security sandbox.
            </span>
          </div>

          <button
            className="freebuff-start"
            onClick={() => setStarted(true)}
          >
            <Power size={18} />
            Start Freebuff session
          </button>

        </div>
      ) : (
        <FreebuffTerminal />
      )}

      <footer className="freebuff-footer">
        Local coding workspace - workspace/freebuff
      </footer>

    </section>
  );
}
