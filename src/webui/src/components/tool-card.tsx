import type { WebBlock } from "../../../web/protocol.js";
import type { WebMessages } from "../i18n.js";

type ToolBlock = Extract<WebBlock, { kind: "tool" }>;

export function ToolCard({
  block,
  messages,
}: {
  block: ToolBlock;
  messages: WebMessages;
}) {
  return (
    <details className={`tool-card tool-${block.status}`}>
      <summary>
        <span className="tool-chevron" aria-hidden="true">
          ›
        </span>
        <code>{block.name}</code>
        <span className="tool-summary">{block.summary ?? block.status}</span>
        {block.durationMs !== undefined && (
          <span className="tool-duration">{block.durationMs}ms</span>
        )}
      </summary>
      <div className="tool-detail">
        {block.input !== undefined && (
          <section>
            <h3>{messages.input}</h3>
            <pre>{formatInput(block.input)}</pre>
          </section>
        )}
        {block.output !== undefined && (
          <section>
            <h3>{messages.output}</h3>
            <pre>{block.output}</pre>
          </section>
        )}
      </div>
    </details>
  );
}

function formatInput(input: unknown): string {
  try {
    return JSON.stringify(input, null, 2);
  } catch {
    return String(input);
  }
}
