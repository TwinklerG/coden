import type { WebSessionSummary } from "../../../web/protocol.js";
import type { WebMessages } from "../i18n.js";

export interface SessionSidebarProps {
  sessions: WebSessionSummary[];
  currentId?: string;
  messages: WebMessages;
  running: boolean;
  isOwner: boolean;
  open: boolean;
  onClose(): void;
  onNew(): void;
  onResume(id: string): void;
}

export function SessionSidebar(props: SessionSidebarProps) {
  const disabled = props.running || !props.isOwner;
  return (
    <>
      {props.open && (
        <button
          type="button"
          className="drawer-scrim"
          aria-label={props.messages.closeSessions}
          onClick={props.onClose}
        />
      )}
      <aside
        className={`session-sidebar ${props.open ? "drawer-open" : ""}`}
        aria-label={props.messages.sessions}
      >
        <div className="sidebar-heading">
          <div>
            <span className="eyebrow">workspace</span>
            <h1>CodeN</h1>
          </div>
          <button
            className="drawer-close"
            type="button"
            aria-label={props.messages.closeSessions}
            onClick={props.onClose}
          >
            ×
          </button>
        </div>
        <button
          className="new-session"
          type="button"
          disabled={disabled}
          onClick={props.onNew}
        >
          <span aria-hidden="true">＋</span> {props.messages.newSession}
        </button>
        <nav className="session-list" aria-label={props.messages.sessions}>
          {props.sessions.length === 0 && (
            <p className="empty-state">{props.messages.noSessions}</p>
          )}
          {props.sessions.map((session) => (
            <button
              key={session.id}
              type="button"
              className={
                session.id === props.currentId
                  ? "session-item active"
                  : "session-item"
              }
              disabled={disabled || session.id === props.currentId}
              onClick={() => props.onResume(session.id)}
            >
              <span>{session.title?.trim() || session.id.slice(0, 10)}</span>
              <small>{session.messageCount}</small>
            </button>
          ))}
        </nav>
        <footer className="sidebar-footer">
          <span className="eyebrow">session</span>
          <code>{props.currentId?.slice(0, 12) ?? "not-created"}</code>
        </footer>
      </aside>
    </>
  );
}
