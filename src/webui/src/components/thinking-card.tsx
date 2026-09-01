import { useEffect, useRef, useState } from "react";
import type { WebBlock } from "../../../web/protocol.js";
import type { WebMessages } from "../i18n.js";

type ThinkingBlock = Extract<WebBlock, { kind: "thinking" }>;

export function ThinkingCard({
  block,
  messages,
}: {
  block: ThinkingBlock;
  messages: WebMessages;
}) {
  const [expanded, setExpanded] = useState(block.status === "streaming");
  const scrollRef = useRef<HTMLDivElement>(null);

  // Collapse once the agent finishes reasoning and starts answering.
  useEffect(() => {
    if (block.status === "done") setExpanded(false);
  }, [block.status]);

  // Keep the streaming reasoning pinned to the bottom of its scroll area.
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-scroll on each text delta
  useEffect(() => {
    if (expanded && block.status === "streaming" && scrollRef.current)
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [block.text, expanded, block.status]);

  return (
    <article
      className={`thinking-card thinking-${block.status}${expanded ? " open" : ""}`}
    >
      <button
        type="button"
        className="thinking-toggle"
        aria-expanded={expanded}
        aria-label={messages.thinking}
        onClick={() => setExpanded((value) => !value)}
      >
        <span className="thinking-chevron" aria-hidden="true">
          ›
        </span>
        <span className="thinking-label">{messages.thinking}</span>
        {block.status === "streaming" && (
          <span
            className="thinking-live"
            title={messages.phases.thinking}
            aria-hidden="true"
          />
        )}
      </button>
      {expanded && (
        <div className="thinking-body">
          <div className="thinking-scroll" ref={scrollRef}>
            <pre>{block.text || "…"}</pre>
          </div>
        </div>
      )}
    </article>
  );
}
