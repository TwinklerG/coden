import { appendFile, mkdtemp, readFile, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ContextManager, TokenEstimator } from "../src/context/manager.js";
import { truncateOutput } from "../src/context/truncate.js";
import { EventBus } from "../src/core/events.js";
import type { AgentMessage, ToolDefinition } from "../src/core/types.js";
import { JSONLTraceWriter } from "../src/observability/trace.js";
import { LlmApprovalReviewer } from "../src/permissions/reviewer.js";
import { ScriptedProvider, scriptedText } from "../src/providers/scripted.js";
import { SessionStore } from "../src/sessions/store.js";

function completedTurn(index: number, body = "x".repeat(700)): AgentMessage[] {
  return [
    { role: "user", content: `request-${index} ${body}` },
    {
      role: "assistant",
      content: "",
      toolCalls: [
        { callId: `${index}-a`, name: "read", input: { path: "a" } },
        { callId: `${index}-b`, name: "read", input: { path: "b" } },
      ],
    },
    { role: "tool", callId: `${index}-a`, name: "read", content: body, isError: false },
    { role: "tool", callId: `${index}-b`, name: "read", content: "b", isError: false },
    { role: "assistant", content: `answer-${index}`, toolCalls: [] },
  ];
}

describe("context and sessions", () => {
  it("estimates and truncates tool output", () => {
    expect(new TokenEstimator().estimateText("1234567")).toBe(2);
    const truncated = truncateOutput("x".repeat(1000), 200);
    expect(truncated.length).toBeLessThanOrEqual(200);
    expect(truncated).toContain("omitted");
  });

  it("plans model compaction without truncating or mutating old history", () => {
    const long = "complete-tool-output-1 ".repeat(40);
    const messages: AgentMessage[] = [
      { role: "system", content: "system" },
      ...completedTurn(1, long),
      ...completedTurn(2),
      ...completedTurn(3),
      { role: "user", content: "current request" },
    ];
    const manager = new ContextManager({
      contextWindow: 1800,
      reservedOutputTokens: 100,
      safetyMargin: 100,
    });

    const prepared = manager.prepare(messages, []);

    expect(prepared.compactionPlan).toBeDefined();
    expect(JSON.stringify(prepared.compactionPlan?.messagesToCompact)).toContain(long);
    expect(prepared.compactionPlan?.retainedMessages).toEqual([
      ...completedTurn(3),
      { role: "user", content: "current request" },
    ]);
    expect(manager.getSummary()).toBeUndefined();
    expect(manager.getCompactionRange()).toBeUndefined();
  });

  it("keeps hook user messages inside their real user interaction", () => {
    const messages: AgentMessage[] = [
      { role: "system", content: "system" },
      ...completedTurn(1),
      ...completedTurn(2),
      { role: "user", content: "current" },
      { role: "user", source: "hook", content: "hook context" },
    ];
    const manager = new ContextManager({
      contextWindow: 700,
      reservedOutputTokens: 100,
      safetyMargin: 100,
    });

    const plan = manager.planCompaction(messages, "manual");

    expect(plan?.retainedMessages).toEqual([
      ...completedTurn(2),
      { role: "user", content: "current" },
      { role: "user", source: "hook", content: "hook context" },
    ]);
  });

  it("commits valid summaries atomically and rejects invalid summaries", () => {
    const messages: AgentMessage[] = [
      { role: "system", content: "system" },
      ...completedTurn(1),
      ...completedTurn(2),
      ...completedTurn(3),
    ];
    const manager = new ContextManager({
      contextWindow: 2400,
      reservedOutputTokens: 100,
      safetyMargin: 100,
    });
    const plan = manager.planCompaction(messages, "manual");
    if (!plan) throw new Error("expected compaction plan");

    expect(manager.commitCompaction(plan, "", messages.slice(0, 1), [])).toEqual({
      ok: false,
      reason: "empty_summary",
    });
    expect(manager.commitCompaction(plan, "z".repeat(20_000), messages.slice(0, 1), [])).toEqual({
      ok: false,
      reason: "inflated_summary",
    });
    expect(manager.getSummary()).toBeUndefined();

    const summary = "Compacted conversation summary:\n- Goal: finish task";
    const result = manager.commitCompaction(plan, summary, messages.slice(0, 1), []);
    expect(result.ok).toBe(true);
    expect(manager.getSummary()).toBe(summary);
    expect(manager.getCompactionRange()).toEqual(plan.sourceRange);
    if (result.ok) {
      expect(result.prepared.messages).toEqual([
        { role: "system", content: "system" },
        { role: "system", content: summary },
        ...plan.retainedMessages,
      ]);
    }
  });

  it("rejects a summary whose projected context remains over budget", () => {
    const messages: AgentMessage[] = [
      { role: "system", content: "system" },
      ...completedTurn(1),
      ...completedTurn(2),
      ...completedTurn(3),
    ];
    const manager = new ContextManager({
      contextWindow: 500,
      reservedOutputTokens: 100,
      safetyMargin: 100,
    });
    const plan = manager.planCompaction(messages, "emergency");
    if (!plan) throw new Error("expected compaction plan");

    expect(
      manager.commitCompaction(
        plan,
        "Compacted conversation summary:\nshort",
        [{ role: "system", content: "s".repeat(2000) }],
        [],
      ),
    ).toEqual({ ok: false, reason: "over_budget" });
    expect(manager.getSummary()).toBeUndefined();
  });

  it("merges an existing summary and extends its source range", () => {
    const manager = new ContextManager({
      contextWindow: 3000,
      reservedOutputTokens: 100,
      safetyMargin: 100,
    });
    manager.setSummary("old summary", { start: 1, end: 5 });
    const messages: AgentMessage[] = [
      { role: "system", content: "system" },
      ...completedTurn(1),
      ...completedTurn(2),
      ...completedTurn(3),
      ...completedTurn(4),
    ];

    const plan = manager.planCompaction(messages, "manual");

    expect(plan?.sourceRange.start).toBe(1);
    expect(plan?.messagesToCompact[0]).toEqual({ role: "system", content: "old summary" });
  });

  it("recovers messages and ignores a damaged final line", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "coden-session-"));
    const store = new SessionStore(root, root, "session-1");
    await store.create(root);
    await store.appendMessage({ role: "user", content: "hello" });
    await appendFile(store.sessionPath, "{broken", "utf8");
    const recovered = await store.recover();
    expect(recovered.messages).toEqual([{ role: "user", content: "hello" }]);
    expect(recovered.warnings).toHaveLength(1);
  });
  it("rejects a complete but structurally invalid final record", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "coden-session-"));
    const store = new SessionStore(root, root, "session-invalid");
    await store.create(root);
    await appendFile(
      store.sessionPath,
      `${JSON.stringify({ version: 2, id: "bad", timestamp: new Date().toISOString(), type: "message", data: {} })}\n`,
    );
    await expect(store.recover()).rejects.toThrow("unsupported schema version");
  });

  it("writes structured trace events with private permissions", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "coden-trace-"));
    const file = path.join(root, "trace.jsonl");
    const events = new EventBus();
    const trace = new JSONLTraceWriter(file, events);
    await events.emit("tool.completed", { name: "read", durationMs: 2 }, "turn-1");
    await trace.flush();
    expect(JSON.parse(await readFile(file, "utf8"))).toMatchObject({
      type: "tool.completed",
      turnId: "turn-1",
      data: { name: "read" },
    });
    expect((await stat(file)).mode & 0o777).toBe(0o600);
  });

  it("traces smart approval metadata without duplicating sensitive tool input", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "coden-review-trace-"));
    const file = path.join(root, "trace.jsonl");
    const events = new EventBus();
    const trace = new JSONLTraceWriter(file, events);
    const tool: ToolDefinition = {
      name: "write",
      description: "write",
      risk: "modify",
      inputSchema: { type: "object" },
      async execute() {
        return { content: "ok" };
      },
    };
    const reviewer = new LlmApprovalReviewer(
      new ScriptedProvider([
        [
          ...scriptedText('{"decision":"allow","reason":"bounded local change"}').slice(0, -1),
          { type: "usage", usage: { inputTokens: 10, outputTokens: 4 } },
          { type: "done" },
        ],
      ]),
      "review-model",
      "medium",
      events,
    );

    await reviewer.review({
      task: "write a secret",
      tool,
      call: {
        callId: "w",
        name: "write",
        input: { path: "a.txt", content: "TOP_SECRET_PAYLOAD" },
      },
      risk: "modify",
      workspace: root,
      pathScope: "inside",
    });
    await trace.flush();
    const text = await readFile(file, "utf8");
    expect(text).toContain("permission.review_completed");
    expect(text).toContain("inputTokens");
    expect(text).not.toContain("TOP_SECRET_PAYLOAD");
  });

  it("defers trace persistence until its session is active", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "coden-trace-"));
    const file = path.join(root, "trace.jsonl");
    const events = new EventBus();
    let active = false;
    const trace = new JSONLTraceWriter(file, events, () => active);

    await events.emit("plugin.loaded", { name: "startup" });
    await trace.flush();
    await expect(readFile(file, "utf8")).rejects.toMatchObject({ code: "ENOENT" });

    active = true;
    await events.emit("turn.started", { input: "hello" }, "turn-1");
    await trace.flush();
    const text = await readFile(file, "utf8");
    expect(text).toContain('"type":"plugin.loaded"');
    expect(text).toContain('"type":"turn.started"');
  });

  it("repairs trailing tool calls interrupted by a crash", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "coden-session-"));
    const store = new SessionStore(root, root, "session-missing");
    await store.create(root);
    await store.appendMessage({
      role: "assistant",
      content: "",
      toolCalls: [{ callId: "missing", name: "read", input: { path: "a" } }],
    });
    const recovered = await store.recover();
    expect(recovered.messages.at(-1)).toMatchObject({
      role: "tool",
      callId: "missing",
      isError: true,
    });
    expect(recovered.warnings).toContain("Recovered 1 interrupted tool call(s)");
    const recoveredAgain = await store.recover();
    expect(recoveredAgain.warnings).not.toContain("Recovered 1 interrupted tool call(s)");
    expect((await stat(store.sessionPath)).mode & 0o777).toBe(0o600);
  });

  it("rejects unsafe session identifiers", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "coden-session-"));
    expect(() => new SessionStore(root, root, "../escape")).toThrow("Invalid session ID");
  });

  it("rejects orphan tool results", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "coden-session-"));
    const store = new SessionStore(root, root, "session-2");
    await store.create(root);
    await store.appendMessage({
      role: "tool",
      callId: "missing",
      name: "read",
      content: "x",
      isError: false,
    });
    await expect(store.recover()).rejects.toThrow("Orphan tool result");
  });

  it("titles a session from the first user prompt and lists it", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "coden-list-"));
    const store = new SessionStore(root, root, "session-a");
    await store.create(root);
    await store.setTitle("First question");
    await store.appendMessage({ role: "user", content: "First question" });
    await store.appendMessage({ role: "assistant", content: "answer", toolCalls: [] });

    const list = await store.list();
    const meta = list.find((item) => item.id === "session-a");
    expect(meta?.title).toBe("First question");
    expect(meta?.messageCount).toBe(2);
    expect(meta?.lastActivity).toBeTruthy();
  });

  it("falls back to the first user prompt when no session.title is stored", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "coden-list-"));
    const store = new SessionStore(root, root, "session-f");
    await store.create(root);
    await store.appendMessage({ role: "user", content: "my first prompt" });
    await store.appendMessage({ role: "assistant", content: "ok", toolCalls: [] });

    const list = await store.list();
    expect(list[0]?.title).toBe("my first prompt");
  });

  it("resets conversation stats at session.reset", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "coden-list-"));
    const store = new SessionStore(root, root, "session-r");
    await store.create(root);
    await store.setTitle("old title");
    await store.appendMessage({ role: "user", content: "old" });
    await store.append("session.reset", {});
    await store.setTitle("new title");
    await store.appendMessage({ role: "user", content: "new" });

    const list = await store.list();
    expect(list[0]?.title).toBe("new title");
    expect(list[0]?.messageCount).toBe(1);
  });

  it("returns an empty list when no sessions exist", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "coden-list-"));
    const store = new SessionStore(root, root, "session-e");
    await expect(store.list()).resolves.toEqual([]);
  });

  it("orders sessions by lastActivity descending", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "coden-list-"));
    const a = new SessionStore(root, root, "session-a");
    await a.create(root);
    await a.appendMessage({ role: "user", content: "a" });
    const b = new SessionStore(root, root, "session-b");
    await b.create(root);
    await b.appendMessage({ role: "user", content: "b" });

    const list = await a.list();
    for (let i = 1; i < list.length; i++) {
      expect(
        Date.parse(list[i - 1]?.lastActivity ?? "") >= Date.parse(list[i]?.lastActivity ?? ""),
      ).toBe(true);
    }
  });

  it("persists and recovers the last thinking level", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "coden-session-"));
    const store = new SessionStore(root, root, "session-thinking");
    await store.create(root);
    await store.appendThinkingLevel("low");
    await store.appendThinkingLevel("high");
    expect((await store.recover()).thinkingLevel).toBe("high");
  });

  it("rejects an invalid stored thinking level", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "coden-session-"));
    const store = new SessionStore(root, root, "session-thinking-invalid");
    await store.create(root);
    await store.append("session.thinking", { level: "extreme" });
    await expect(store.recover()).rejects.toThrow("invalid thinking level record");
  });

  it("round-trips a valid assistant provider state and rejects malformed state", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "coden-session-"));
    const store = new SessionStore(root, root, "session-state");
    await store.create(root);
    await store.appendMessage({
      role: "assistant",
      content: "",
      toolCalls: [],
      providerState: {
        provider: "anthropic",
        data: { thinkingBlocks: [{ type: "thinking", thinking: "t", signature: "s" }] },
      },
    });
    const recovered = await store.recover();
    expect(recovered.messages.at(-1)).toMatchObject({
      role: "assistant",
      providerState: {
        provider: "anthropic",
        data: { thinkingBlocks: [{ type: "thinking", thinking: "t", signature: "s" }] },
      },
    });

    const bad = new SessionStore(root, root, "session-state-bad");
    await bad.create(root);
    await bad.append("message", {
      role: "assistant",
      content: "",
      toolCalls: [],
      providerState: { provider: 42, data: {} },
    });
    await expect(bad.recover()).rejects.toThrow("invalid message structure");
  });
});
