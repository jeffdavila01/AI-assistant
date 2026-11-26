import { useState, useEffect } from "react";
import {
  Globe,
  Brain,
  Clock,
  LoaderCircle,
  CheckCircle2,
  Square,
  AlertCircle
} from "lucide-react";

export default function ProcessingStatus({ request }) {
  const [now, setNow] = useState(Date.now());

  const active = [
    "connecting",
    "searching",
    "analyzing",
    "queued",
    "generating"
  ].includes(request?.status);

  useEffect(() => {
    if (!active) return;

    setNow(Date.now());

    const timer = setInterval(() => {
      setNow(Date.now());
    }, 200);

    return () => clearInterval(timer);
  }, [active, request?.startedAt]);

  if (!request) return null;

  const elapsed = Math.max(
    0,
    ((request.finishedAt || now) -
      (request.startedAt || now)) / 1000
  ).toFixed(1);

  const states = {
    connecting: {
      label: "Connecting to AI",
      icon: LoaderCircle
    },
    searching: {
      label: "Searching online documentation",
      icon: Globe
    },
    analyzing: {
      label: "Preparing retrieved information",
      icon: Brain
    },
    queued: {
      label: "Waiting in queue",
      icon: Clock
    },
    generating: {
      label: "Generating response",
      icon: LoaderCircle
    },
    completed: {
      label: "Response completed",
      icon: CheckCircle2
    },
    stopped: {
      label: "Generation stopped",
      icon: Square
    },
    error: {
      label: "Response interrupted",
      icon: AlertCircle
    }
  };

  const state = states[request.status] ||
    states.connecting;

  const Icon = state.icon;

  return (
    <div className={`processing-status ${request.status}`}>

      <div className="processing-heading">

        <Icon
          size={16}
          className={
            Icon === LoaderCircle
              ? "processing-spin"
              : ""
          }
        />

        <span>{state.label}</span>

        <span className="processing-elapsed">
          {elapsed}s
        </span>

      </div>

      <div className="processing-details">

        {request.model && (
          <span>{request.model}</span>
        )}

        {request.status === "queued" && (
          <span>
            Initial queue position: {request.position}
          </span>
        )}

        {Number.isInteger(request.sourceCount) && (
          <span>
            {request.sourceCount} retrieved sources
          </span>
        )}

        {request.firstTokenAt && request.startedAt && (
          <span>
            First response: {
              ((request.firstTokenAt -
                request.startedAt) / 1000).toFixed(1)
            }s
          </span>
        )}

      </div>

    </div>
  );
}
