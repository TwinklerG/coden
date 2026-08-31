import type { AgentMessage } from "../core/types.js";
import type { I18n } from "../i18n/i18n.js";
import { MarkdownStreamRenderer } from "../observability/markdown.js";
import { sanitizeTerminalText } from "../observability/terminal-text.js";
import { formatActivityLine } from "./activity.js";
import type { TranscriptBlock } from "./types.js";

export function renderMarkdown(markdown: string, columns: number): string {
  let rendered = "";
  const renderer = new MarkdownStreamRenderer(
    (chunk) => {
      rendered += chunk;
    },
    () => Math.max(1, columns),
  );
  renderer.push(markdown);
  renderer.complete();
  return rendered;
}

export function renderTranscriptBlock(
  block: TranscriptBlock,
  columns: number,
  i18n?: I18n,
  activityFrame = 0,
): string {
  switch (block.kind) {
    case "user":
      return sanitizeTerminalText(block.text)
        .split("\n")
        .map((line, index) => `${index === 0 ? "> " : "  "}${line}`)
        .join("\n");
    case "assistant":
      return renderMarkdown(block.markdown, columns);
    case "tool":
      return sanitizeTerminalText(block.text);
    case "info":
    case "error":
      return sanitizeTerminalText(block.text);
    case "activity":
      return formatActivityLine(
        block.phase,
        block.text,
        i18n?.messages.tui.phases[block.phase] ?? block.phase,
        columns,
        activityFrame,
      );
  }
}

export function messagesToTranscript(messages: readonly AgentMessage[]): TranscriptBlock[] {
  const blocks: TranscriptBlock[] = [];
  let index = 0;
  for (const message of messages) {
    if (message.role === "user") {
      blocks.push({ id: `history-${index++}`, kind: "user", text: message.content });
    } else if (message.role === "assistant" && message.content) {
      blocks.push({ id: `history-${index++}`, kind: "assistant", markdown: message.content });
    }
  }
  return blocks;
}
