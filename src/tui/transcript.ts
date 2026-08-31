import type { AgentMessage } from "../core/types.js";
import { I18n } from "../i18n/i18n.js";
import { MarkdownStreamRenderer } from "../observability/markdown.js";
import { sanitizeTerminalText } from "../observability/terminal-text.js";
import { formatActivityLine } from "./activity.js";
import type { TranscriptBlock, TranscriptInteractionBlock } from "./types.js";

function interactionSuffix(block: TranscriptInteractionBlock, i18n: I18n): string {
  if (block.status === "cancelled") return i18n.messages.tui.interactionCancelled;
  return block.answer ?? "";
}

function renderInteraction(block: TranscriptInteractionBlock, columns: number, i18n: I18n): string {
  const suffix = interactionSuffix(block, i18n);
  if (block.interaction === "confirm") {
    const message = sanitizeTerminalText(block.message).trimEnd();
    const prompt = /\[y\/N\]$/u.test(message) ? message : `${message} [y/N]`;
    return `${prompt} ${suffix}`;
  }

  const rule = "─".repeat(Math.max(1, columns));
  const values = block.lines.map((line) => `  ${sanitizeTerminalText(line)}`).join("\n");
  const choices =
    i18n.currentLanguage === "zh"
      ? block.allowSession
        ? "[y] 是 / [s] 本会话 / [N] 否"
        : "[y] 是 / [N] 否"
      : block.allowSession
        ? "[y]es / [s]ession / [N]o"
        : "[y]es / [N]o";
  return `${rule}\n${block.risk.toUpperCase()}  ${sanitizeTerminalText(block.toolName)}\n\n${values}\n${rule}\n${i18n.messages.format.allow} ${choices}: ${suffix}`;
}

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
    case "interaction":
      return renderInteraction(block, columns, i18n ?? new I18n("en"));
  }
}

export function messagesToTranscript(messages: readonly AgentMessage[]): TranscriptBlock[] {
  const blocks: TranscriptBlock[] = [];
  let index = 0;
  for (const message of messages) {
    if (message.role === "user" && message.source !== "hook") {
      blocks.push({ id: `history-${index++}`, kind: "user", text: message.content });
    } else if (message.role === "assistant" && message.content) {
      blocks.push({ id: `history-${index++}`, kind: "assistant", markdown: message.content });
    }
  }
  return blocks;
}
