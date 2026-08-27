import type { AgentMessage } from "../core/types.js";
import type { SessionMeta } from "../sessions/store.js";

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

export function renderResumeBanner(sessionId: string, messages: AgentMessage[]): string {
  const count = messages.length;
  const preview = messages
    .filter((message) => message.role === "user" || message.role === "assistant")
    .slice(-3);
  const lines = [
    `Resumed session ${sessionId} (${count} messages).`,
    `Showing last ${preview.length} of ${count} messages.`,
  ];
  for (const message of preview) {
    const role = message.role === "user" ? "user" : "assistant";
    lines.push(`┌ ${role.padEnd(9)} ${singleLine(message.content, 120)}`);
  }
  return lines.join("\n");
}
