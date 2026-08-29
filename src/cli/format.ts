import type {
  AgentMessage,
  AssistantMessage,
  ToolCall,
  ToolDefinition,
  ToolRisk,
  UserMessage,
} from "../core/types.js";
import { MarkdownStreamRenderer } from "../observability/markdown.js";
import { formatToolInput } from "../observability/tool-input.js";
import type { SessionMeta } from "../sessions/store.js";

export const ASSISTANT_TRUNCATE_LIMIT = 2000;

export function singleLine(text: string, max: number): string {
  const one = text.replace(/\s+/g, " ").trim();
  return one.length <= max ? one : `${one.slice(0, max - 1)}…`;
}

export function formatDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function formatSessionList(sessions: SessionMeta[], currentId?: string): string {
  if (sessions.length === 0) return "No sessions found.\n";
  const lines = sessions.map((item) => {
    const title = item.title ? singleLine(item.title, 40) : "(no title)";
    const meta = item.messageCount === 0 ? "new session" : `${item.messageCount} messages`;
    const active = item.id === currentId ? "  *" : "";
    return `${item.id}${active}  ${title}  (${meta}, ${formatDateTime(item.lastActivity)})`;
  });
  const header = currentId ? `Current session: ${currentId}\n` : "";
  return `${lines.join("\n")}\n${header}`;
}

export function formatPermissionQuestion(
  tool: ToolDefinition,
  call: ToolCall,
  risk: ToolRisk,
): string {
  const display = formatToolInput({
    name: tool.name,
    risk,
    inputSchema: tool.inputSchema,
    input: call.input,
  });
  const values = display.lines.map((line) => `  ${line}`).join("\n");
  const choices = risk === "dangerous" ? "[y]es / [N]o" : "[y]es / [s]ession / [N]o";
  return `${risk.toUpperCase()}  ${tool.name}\n\n${values}\n\nAllow? ${choices}: `;
}

export function renderResumeTranscript(sessionId: string, messages: AgentMessage[]): string {
  const isVisible = (message: AgentMessage): message is UserMessage | AssistantMessage =>
    message.role === "user" || message.role === "assistant";
  const blocks: string[] = [`Resumed session ${sessionId} (${messages.length} messages).`];
  for (const message of messages.filter(isVisible)) {
    blocks.push(
      message.role === "user"
        ? renderUserMessage(message.content)
        : renderAssistantMessage(message.content),
    );
  }
  const summary = summarizeTools(messages);
  if (summary) blocks.push(summary);
  return blocks.join("\n\n");
}

function renderUserMessage(content: string): string {
  return content
    .split("\n")
    .map((line, index) => (index === 0 ? `> ${line}` : `  ${line}`))
    .join("\n");
}

function renderAssistantMessage(content: string): string {
  const { text, omitted } = truncateAssistant(content);
  let out = "";
  const renderer = new MarkdownStreamRenderer((chunk) => {
    out += chunk;
  });
  renderer.push(text);
  renderer.complete();
  if (!omitted) return out;
  const separated = out.endsWith("\n") ? out : `${out}\n`;
  return `${separated}…（已省略 ${omitted} 个字符）`;
}

function truncateAssistant(content: string): { text: string; omitted: number } {
  const chars = [...content];
  return chars.length <= ASSISTANT_TRUNCATE_LIMIT
    ? { text: content, omitted: 0 }
    : {
        text: chars.slice(0, ASSISTANT_TRUNCATE_LIMIT).join(""),
        omitted: chars.length - ASSISTANT_TRUNCATE_LIMIT,
      };
}

function summarizeTools(messages: AgentMessage[]): string | undefined {
  const counts = new Map<string, number>();
  for (const message of messages) {
    if (message.role === "assistant") {
      for (const call of message.toolCalls) {
        counts.set(call.name, (counts.get(call.name) ?? 0) + 1);
      }
    }
  }
  if (counts.size === 0) return undefined;
  const total = [...counts.values()].reduce((sum, count) => sum + count, 0);
  let failures = 0;
  for (const message of messages) {
    if (message.role === "tool" && message.isError) failures++;
  }
  const perTool = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([name, count]) => `${name} ×${count}`)
    .join(", ");
  const base = `Tools: ${total} calls — ${perTool}`;
  return failures > 0 ? `${base}; ${failures} failed` : base;
}
