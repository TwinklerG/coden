import { useEffect, useRef, useState } from "react";
import type {
  WebBlock,
  WebInteractionDecision,
} from "../../../web/protocol.js";
import type { WebMessages } from "../i18n.js";
import { MarkdownContent } from "../markdown.js";
import { InteractionCard } from "./interaction-card.js";
import { ThinkingCard } from "./thinking-card.js";
import { ToolCard } from "./tool-card.js";

export function Transcript({
  blocks,
  messages,
  phase,
  interactionEnabled,
  actionError,
  onInteraction,
}: {
  blocks: WebBlock[];
  messages: WebMessages;
  phase: string;
  interactionEnabled: boolean;
  actionError?: string;
  onInteraction(id: string, decision: WebInteractionDecision): void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const [following, setFollowing] = useState(true);
  const lastBlock = blocks.at(-1);
  useEffect(() => {
    if (!following || !container.current || !lastBlock) return;
    container.current.scrollTop = container.current.scrollHeight;
  }, [lastBlock, following]);
  const onScroll = () => {
    const element = container.current;
    if (!element) return;
    setFollowing(
      element.scrollHeight - element.scrollTop - element.clientHeight <= 32,
    );
  };
  const latest = () => {
    const element = container.current;
    if (element) element.scrollTop = element.scrollHeight;
    setFollowing(true);
  };
  return (
    <div className="transcript-wrap">
      <div className="activity-label" aria-live="polite">
        <span className="activity-pulse" aria-hidden="true" />{" "}
        {messages.phases[phase] ?? phase}
      </div>
      <div className="transcript" ref={container} onScroll={onScroll}>
        <div className="transcript-column">
          {blocks.length === 0 && (
            <section className="welcome-block">
              <span className="prompt-mark" aria-hidden="true">
                ~/
              </span>
              <h2>CodeN</h2>
              <p>{messages.prompt}</p>
            </section>
          )}
          {blocks.map((block) => {
            if (block.kind === "user")
              return (
                <article className="message user-message" key={block.id}>
                  <header>you</header>
                  <p>{block.text}</p>
                </article>
              );
            if (block.kind === "assistant")
              return (
                <article className="message assistant-message" key={block.id}>
                  <header>coden</header>
                  <MarkdownContent markdown={block.markdown} />
                </article>
              );
            if (block.kind === "thinking")
              return (
                <ThinkingCard
                  key={block.id}
                  block={block}
                  messages={messages}
                />
              );
            if (block.kind === "tool")
              return (
                <ToolCard key={block.id} block={block} messages={messages} />
              );
            if (block.kind === "interaction")
              return (
                <InteractionCard
                  key={block.id}
                  block={block}
                  messages={messages}
                  enabled={interactionEnabled}
                  onDecision={(decision) => onInteraction(block.id, decision)}
                />
              );
            return (
              <article className={`notice notice-${block.kind}`} key={block.id}>
                <code>{block.kind}</code> {block.text}
              </article>
            );
          })}
          {actionError && (
            <article className="notice notice-error" role="alert">
              <code>error</code> {actionError}
            </article>
          )}
        </div>
      </div>
      {!following && (
        <button className="return-latest" type="button" onClick={latest}>
          ↓ {messages.returnLatest}
        </button>
      )}
    </div>
  );
}
