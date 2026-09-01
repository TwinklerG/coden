import type { WebSnapshot } from "../../../web/protocol.js";
import type { WebMessages } from "../i18n.js";

export interface StatusHeaderProps {
  snapshot: WebSnapshot;
  messages: WebMessages;
  connection: "connecting" | "connected" | "reconnecting";
  isOwner: boolean;
  onTakeover(): void;
  onOpenSessions(): void;
}

export function StatusHeader({
  snapshot,
  messages,
  connection,
  isOwner,
  onTakeover,
  onOpenSessions,
}: StatusHeaderProps) {
  const metadata = snapshot.metadata;
  return (
    <header className="status-header">
      <button
        className="session-drawer-trigger"
        type="button"
        onClick={onOpenSessions}
      >
        <span aria-hidden="true">≡</span> {messages.openSessions}
      </button>
      <div className="status-path">
        <strong>~/ CodeN</strong>
        <span className="experimental-label">{messages.experimental}</span>
        <code
          className="workspace-path"
          {...(metadata?.workspace ? { title: metadata.workspace } : {})}
        >
          {metadata?.workspace ?? "workspace"}
        </code>
      </div>
      <dl className="runtime-meta">
        <div>
          <dt>model</dt>
          <dd>{metadata ? `${metadata.provider}/${metadata.model}` : "—"}</dd>
        </div>
        <div>
          <dt>approval</dt>
          <dd>{metadata?.approvalMode ?? "—"}</dd>
        </div>
        <div>
          <dt>thinking</dt>
          <dd>{metadata?.thinkingDisplay ?? "—"}</dd>
        </div>
        <div>
          <dt>context</dt>
          <dd>
            {snapshot.contextPercent === undefined
              ? "—"
              : `${Math.round(snapshot.contextPercent)}%`}
          </dd>
        </div>
      </dl>
      <div className="control-state">
        <span className={`connection connection-${connection}`}>
          <span className="status-dot" aria-hidden="true" />{" "}
          {messages[connection]}
        </span>
        <span>{isOwner ? messages.owner : messages.readOnly}</span>
        {!isOwner && (
          <button
            className="button-secondary compact"
            type="button"
            onClick={onTakeover}
          >
            {messages.takeover}
          </button>
        )}
      </div>
    </header>
  );
}
