import { useState } from "react";

export function CopyableField({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="app-copyable">
      <div className="app-copyable__meta">
        <span className="app-copyable__label">{label}</span>
        {hint && <span className="app-muted app-copyable__hint">{hint}</span>}
      </div>
      <div className="app-copyable__row">
        <code className="app-copyable__value" title={value}>
          {value}
        </code>
        <button type="button" className="app-btn app-btn--small" onClick={() => void copy()}>
          {copied ? "已复制" : "复制"}
        </button>
      </div>
    </div>
  );
}
