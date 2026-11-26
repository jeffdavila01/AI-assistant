import { Globe } from "lucide-react";

export default function SearchToggle({
  enabled,
  onChange,
  disabled = false
}) {
  return (
    <button
      type="button"
      className={`search-toggle ${enabled ? "enabled" : ""}`}
      aria-pressed={enabled}
      disabled={disabled}
      title={
        enabled
          ? "Disable web research"
          : "Enable web research"
      }
      onClick={() => onChange(!enabled)}
    >
      <Globe size={17} />

      <span>Search</span>
    </button>
  );
}
