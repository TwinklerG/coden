import { describe, expect, it } from "vitest";
import { stripVTControlCharacters } from "node:util";
import {
  ASSISTANT_TRUNCATE_LIMIT,
  formatDateTime,
  formatPermissionQuestion,
  formatSessionList,
  renderResumeBanner,
  renderResumeTranscript,
  singleLine,
} from "../src/cli/format.js";
import type { AgentMessage, ToolDefinition } from "../src/core/types.js";
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

  it("formats generic multiline tool permission questions", () => {
    const tool: ToolDefinition = {
      name: "third_party_write",
      description: "writes content",
      risk: "modify",
      inputSchema: {
        type: "object",
        properties: { path: { type: "string" }, content: { type: "string" } },
      },
      async execute() {
        return { content: "ok" };
      },
    };
    const question = formatPermissionQuestion(
      tool,
      {
        callId: "call-1",
        name: tool.name,
        input: { path: "a.txt", content: "line 1\nline 2" },
      },
      "modify",
    );

    expect(question).toContain("MODIFY  third_party_write");
    expect(question).toContain("  path: a.txt");
    expect(question).toContain("  content:\n    line 1\n    line 2");
    expect(question).toContain("Allow? [y]es / [s]ession / [N]o: ");
    expect(question).not.toContain("\\n");
  });

  it("does not offer session permission for dangerous tools", () => {
    const tool = {
      name: "deploy",
      description: "deploy",
      risk: "dangerous" as const,
      inputSchema: { type: "object" },
      async execute() {
        return { content: "ok" };
      },
    };
    const question = formatPermissionQuestion(
      tool,
      { callId: "call-2", name: "deploy", input: { target: "production" } },
      "dangerous",
    );
    expect(question).toContain("Allow? [y]es / [N]o: ");
    expect(question).not.toContain("session");
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

  it("renders the full user/assistant transcript and hides system/tool messages", () => {
    const messages: AgentMessage[] = [
      { role: "system", content: "You are CodeN." },
      { role: "user", content: "hello" },
      { role: "assistant", content: "hi", toolCalls: [] },
      { role: "tool", callId: "call-1", name: "read", content: "file", isError: false },
      { role: "user", content: "next" },
      { role: "assistant", content: "again", toolCalls: [] },
    ];
    const transcript = renderResumeTranscript("sess-id", messages);
    expect(transcript).toContain("Resumed session sess-id (6 messages).");
    expect(transcript.indexOf("> hello")).toBeLessThan(transcript.indexOf("hi"));
    expect(transcript.indexOf("hi")).toBeLessThan(transcript.indexOf("> next"));
    expect(transcript.indexOf("> next")).toBeLessThan(transcript.indexOf("again"));
    expect(transcript).not.toContain("You are CodeN.");
    expect(transcript).not.toContain("call-1");
    expect(transcript).not.toContain("file");
  });

  it("preserves multi-line user content under the > prompt", () => {
    const transcript = renderResumeTranscript("s", [
      { role: "user", content: "line one\nline two\nline three" },
    ]);
    expect(transcript).toContain("> line one\n  line two\n  line three");
  });

  it("renders assistant Markdown instead of raw markup", () => {
    const transcript = renderResumeTranscript("s", [
      { role: "assistant", content: "# Title\n**bold** and `code`\n- item", toolCalls: [] },
    ]);
    const plain = stripVTControlCharacters(transcript);
    expect(plain).toContain("Title");
    expect(plain).toContain("bold and code");
    expect(plain).toContain("• item");
    expect(plain).not.toContain("**bold**");
    expect(plain).not.toContain("`code`");
  });

  it("truncates assistant replies over the limit and reports the omitted count", () => {
    const over = renderResumeTranscript("s", [
      { role: "assistant", content: "x".repeat(ASSISTANT_TRUNCATE_LIMIT + 40), toolCalls: [] },
    ]);
    expect(over).toContain("…（已省略 40 个字符）");
    expect(stripVTControlCharacters(over)).toContain("x".repeat(ASSISTANT_TRUNCATE_LIMIT));
    expect(stripVTControlCharacters(over)).not.toContain("x".repeat(ASSISTANT_TRUNCATE_LIMIT + 1));

    const exact = renderResumeTranscript("s", [
      { role: "assistant", content: "y".repeat(ASSISTANT_TRUNCATE_LIMIT), toolCalls: [] },
    ]);
    expect(exact).not.toContain("已省略");
  });

  it("counts Unicode code points, not UTF-16 units, for truncation", () => {
    const emoji = "😀".repeat(ASSISTANT_TRUNCATE_LIMIT + 1);
    const transcript = renderResumeTranscript("s", [
      { role: "assistant", content: emoji, toolCalls: [] },
    ]);
    expect(transcript).toContain("…（已省略 1 个字符）");
  });

  it("summarizes tool usage and failures", () => {
    const messages: AgentMessage[] = [
      { role: "assistant", content: "", toolCalls: [{ callId: "c1", name: "read", input: {} }] },
      { role: "tool", callId: "c1", name: "read", content: "ok", isError: false },
      {
        role: "assistant",
        content: "",
        toolCalls: [
          { callId: "c2", name: "read", input: {} },
          { callId: "c3", name: "bash", input: {} },
        ],
      },
      { role: "tool", callId: "c2", name: "read", content: "x", isError: true },
      { role: "tool", callId: "c3", name: "bash", content: "ok", isError: false },
    ];
    const transcript = renderResumeTranscript("s", messages);
    expect(transcript).toContain("Tools: 3 calls — read ×2, bash ×1; 1 failed");
  });

  it("omits the tool summary when no tools were used", () => {
    const transcript = renderResumeTranscript("s", [
      { role: "user", content: "hello" },
      { role: "assistant", content: "hi", toolCalls: [] },
    ]);
    expect(transcript).not.toContain("Tools:");
  });

  it("does not leak an unclosed code fence across messages", () => {
    const transcript = renderResumeTranscript("s", [
      { role: "assistant", content: "```ts\nconst x = 1;", toolCalls: [] },
      { role: "user", content: "continue" },
    ]);
    const plain = stripVTControlCharacters(transcript);
    expect(plain).toContain("const x = 1;");
    expect(plain).not.toContain("```");
  });
});
