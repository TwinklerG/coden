import { describe, expect, it } from "vitest";
import {
  formatDateTime,
  formatSessionList,
  renderResumeBanner,
  singleLine,
} from "../src/cli/format.js";
import type { AgentMessage } from "../src/core/types.js";
import type { SessionMeta } from "../src/sessions/store.js";

describe("cli format helpers", () => {
  it("singleLine collapses whitespace and truncates", () => {
    expect(singleLine("a   b\nc", 20)).toBe("a b c");
    expect(singleLine("x".repeat(10), 5)).toBe("xxxx…");
  });

  it("formatDateTime renders an ISO timestamp", () => {
    expect(formatDateTime("2026-08-27T10:30:00.000Z")).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
    expect(formatDateTime("not-a-date")).toBe("not-a-date");
  });

  it("renders an empty list as No sessions found", () => {
    expect(formatSessionList([])).toBe("No sessions found.\n");
  });

  it("renders session metadata with title, messages, and activity", () => {
    const sessions: SessionMeta[] = [
      {
        id: "a",
        title: "First question",
        messageCount: 3,
        lastActivity: "2026-08-27T10:30:00.000Z",
      },
      { id: "b", messageCount: 0, lastActivity: "2026-08-27T09:00:00.000Z" },
    ];
    const out = formatSessionList(sessions);
    expect(out).toContain("a  First question  (3 messages,");
    expect(out).toContain("b  (no title)  (new session,");
    expect(out).not.toContain("Current session:");
  });

  it("marks the current session and appends a current-session footer", () => {
    const sessions: SessionMeta[] = [
      {
        id: "a",
        title: "First question",
        messageCount: 3,
        lastActivity: "2026-08-27T10:30:00.000Z",
      },
    ];
    const out = formatSessionList(sessions, "a");
    expect(out).toContain("a  *");
    expect(out).toContain("Current session: a");
  });

  it("renders a resume banner with a preview of the last messages", () => {
    const messages: AgentMessage[] = [
      { role: "system", content: "You are CodeN." },
      { role: "user", content: "hello world" },
      { role: "assistant", content: "hi there", toolCalls: [] },
    ];
    const banner = renderResumeBanner("sess-id", messages);
    expect(banner).toContain("Resumed session sess-id (3 messages).");
    expect(banner).toContain("Showing last 2 of 3 messages.");
    expect(banner).toContain("┌ user      hello world");
    expect(banner).toContain("┌ assistant hi there");
  });
});
