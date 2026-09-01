import type {
  WebBlock,
  WebInteractionDecision,
} from "../../../web/protocol.js";
import type { WebMessages } from "../i18n.js";

type InteractionBlock = Extract<WebBlock, { kind: "interaction" }>;

export function InteractionCard({
  block,
  messages,
  enabled,
  onDecision,
}: {
  block: InteractionBlock;
  messages: WebMessages;
  enabled: boolean;
  onDecision(decision: WebInteractionDecision): void;
}) {
  const pending = block.status === "pending";
  return (
    <section
      className={`interaction-card interaction-${block.status}`}
      aria-label={block.interaction}
    >
      <header>
        <span className="interaction-mark" aria-hidden="true">
          ?
        </span>
        <div>
          <span className="eyebrow">{block.interaction}</span>
          <strong>{block.toolName ?? block.message}</strong>
        </div>
        {block.risk && (
          <code className={`risk risk-${block.risk}`}>{block.risk}</code>
        )}
      </header>
      {block.toolName && block.input !== undefined && (
        <pre>{formatInput(block.input)}</pre>
      )}
      {block.toolName && block.message && <p>{block.message}</p>}
      {pending ? (
        <div className="interaction-actions">
          {block.interaction === "permission" ? (
            <>
              <button
                type="button"
                disabled={!enabled}
                onClick={() => onDecision("allow_once")}
              >
                {messages.allowOnce}
              </button>
              {block.allowSession && (
                <button
                  className="button-secondary"
                  type="button"
                  disabled={!enabled}
                  onClick={() => onDecision("allow_session")}
                >
                  {messages.allowSession}
                </button>
              )}
              <button
                className="button-danger"
                type="button"
                disabled={!enabled}
                onClick={() => onDecision("deny")}
              >
                {messages.deny}
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                disabled={!enabled}
                onClick={() => onDecision("confirm")}
              >
                {messages.confirm}
              </button>
              <button
                className="button-danger"
                type="button"
                disabled={!enabled}
                onClick={() => onDecision("reject")}
              >
                {messages.reject}
              </button>
            </>
          )}
        </div>
      ) : (
        <p className="interaction-result">{block.decision ?? block.status}</p>
      )}
    </section>
  );
}

function formatInput(input: unknown): string {
  try {
    return JSON.stringify(input, null, 2);
  } catch {
    return String(input);
  }
}
