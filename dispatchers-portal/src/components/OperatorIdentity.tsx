import React, { useState } from "react";
import { Check, Copy } from "lucide-react";

export const CopyIdentity: React.FC<{ identity: string; children: React.ReactNode }> = ({ identity, children }) => {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(identity);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };
  return (
    <button
      onClick={copy}
      title={identity}
      aria-label="Copy operator identity"
      className="inline-flex items-center gap-1.5"
      style={{
        background: "none",
        border: "none",
        padding: 0,
        cursor: "pointer",
        color: "inherit",
        font: "inherit",
      }}
    >
      {children}
      {copied ? <Check className="w-3 h-3 shrink-0" /> : <Copy className="w-3 h-3 shrink-0" />}
    </button>
  );
};

/** A permission failure is not a stale case: retrying won't help until someone grants this identity. */
export const NotAuthorizedBanner: React.FC<{ identity?: string; onDismiss: () => void }> = ({ identity, onDismiss }) => (
  <div
    role="alert"
    className="px-6 py-2.5 flex items-start justify-between gap-4"
    style={{
      fontSize: 13,
      background: "rgb(240 197 106 / 14%)",
      borderBottom: "1px solid rgb(240 197 106 / 35%)",
      color: "#f5f5f6",
    }}
  >
    <div style={{ minWidth: 0 }}>
      <strong>This browser isn't authorized to dispatch, so nothing was changed.</strong>{" "}
      Ask whoever publishes this database to add this identity to <code>OPERATOR_IDENTITIES</code>, then try again.
      {identity && (
        <div className="mt-1" style={{ fontSize: 12, color: "#c2c2c9", overflowWrap: "anywhere" }}>
          <CopyIdentity identity={identity}>
            <code style={{ textAlign: "left" }}>{identity}</code>
          </CopyIdentity>
        </div>
      )}
    </div>
    <button
      onClick={onDismiss}
      style={{
        background: "none",
        border: "none",
        cursor: "pointer",
        color: "#9a9aa0",
        fontSize: 12,
        flexShrink: 0,
      }}
    >
      Dismiss
    </button>
  </div>
);
