import { describe, expect, it } from "vitest";
import { EventBus } from "../src/core/events.js";
import type { ToolDefinition } from "../src/core/types.js";
import { I18n } from "../src/i18n/i18n.js";
import { TuiStore } from "../src/tui/store.js";

const edit: ToolDefinition = {
  name: "edit",
  description: "edit",
  risk: "modify",
  inputSchema: { type: "object", properties: { path: { type: "string" } } },
  async execute() {
    return { content: "ok" };
  },
};

describe("TuiStore", () => {
  it("replaces thinking in place with real streamed assistant deltas", async () => {
    const events = new EventBus();
    const store = new TuiStore(new I18n("en"));
    store.connect(events);

    await events.emit("turn.started", { input: "hello" }, "turn");
    expect(store.getSnapshot().blocks.map((block) => block.kind)).toEqual(["user", "activity"]);

    await events.emit("provider.started", {}, "turn");
    await events.emit("provider.reasoning_delta", { text: " checking\nfiles " }, "turn");
    expect(store.getSnapshot().blocks[1]).toMatchObject({
      kind: "activity",
      phase: "thinking",
      text: "checking files",
    });

    await events.emit("provider.delta", { text: "final " }, "turn");
    expect(store.getSnapshot().blocks[1]).toMatchObject({
      kind: "assistant",
      markdown: "final ",
    });
    expect(store.getSnapshot().blocks).toHaveLength(2);

    await events.emit("provider.delta", { text: "answer" }, "turn");
    expect(store.getSnapshot().blocks[1]).toMatchObject({
      kind: "assistant",
      markdown: "final answer",
    });

    await events.emit("provider.completed", {}, "turn");
    await events.emit("turn.completed", { inputTokens: 3, outputTokens: 4, durationMs: 5 }, "turn");
    expect(store.getSnapshot()).toMatchObject({
      phase: "idle",
      running: false,
      turnUsage: { inputTokens: 3, outputTokens: 4, durationMs: 5 },
    });
    expect(store.getSnapshot().blocks.some((block) => block.kind === "activity")).toBe(false);
  });

  it("discards a failed provider attempt before retry", async () => {
    const events = new EventBus();
    const store = new TuiStore();
    store.connect(events);
    await events.emit("turn.started", { input: "hello" }, "turn");
    await events.emit("provider.started", {}, "turn");
    await events.emit("provider.delta", { text: "partial" }, "turn");
    await events.emit("provider.retry", { attempt: 1 }, "turn");
    await events.emit("provider.started", {}, "turn");
    await events.emit("provider.delta", { text: "final" }, "turn");
    expect(store.getSnapshot().blocks.filter((block) => block.kind === "assistant")).toEqual([
      expect.objectContaining({ markdown: "final" }),
    ]);
  });

  it("tracks tools, review activity, context, and failures", async () => {
    const events = new EventBus();
    const store = new TuiStore();
    store.connect(events);
    await events.emit("context.prepared", { estimatedTokens: 150, budget: 100 });
    await events.emit("permission.review_started", { name: "edit" });
    expect(store.getSnapshot()).toMatchObject({ contextPercent: 100, phase: "reviewing" });
    await events.emit("tool.started", { name: "edit", summary: "src/a.ts" });
    await events.emit("tool.completed", { name: "edit", durationMs: 12, isError: false });
    expect(store.getSnapshot().blocks.map((block) => ("text" in block ? block.text : ""))).toEqual([
      "◇ edit  src/a.ts",
      "✓ edit  12ms",
    ]);
    await events.emit("turn.failed", { message: "cancelled" });
    expect(store.getSnapshot()).toMatchObject({ phase: "failed", running: false });
  });

  it("settles permission and confirmation interactions exactly once", async () => {
    const store = new TuiStore();
    const permission = store.requestPermission(
      edit,
      { callId: "1", name: "edit", input: { path: "src/a.ts" } },
      "modify",
    );
    expect(store.getSnapshot().pendingInteraction).toMatchObject({
      kind: "permission",
      allowSession: true,
    });
    expect(store.getSnapshot().blocks.at(-1)).toMatchObject({
      kind: "interaction",
      status: "pending",
      lines: expect.arrayContaining(["path: src/a.ts"]),
    });
    store.resolveInteraction("s");
    store.resolveInteraction("n");
    await expect(permission).resolves.toBe("allow_session");
    expect(store.getSnapshot().pendingInteraction).toBeUndefined();
    expect(store.getSnapshot().blocks.at(-1)).toMatchObject({
      kind: "interaction",
      status: "resolved",
      answer: "s",
    });

    const confirm = store.requestConfirm("Trust?\u001b[2J");
    expect(store.getSnapshot().pendingInteraction).toMatchObject({ kind: "confirm" });
    expect(store.getSnapshot().blocks.at(-1)).toMatchObject({
      kind: "interaction",
      interaction: "confirm",
      message: "Trust?",
    });
    store.close();
    await expect(confirm).resolves.toBe(false);
    expect(store.getSnapshot().blocks.at(-1)).toMatchObject({
      kind: "interaction",
      status: "cancelled",
    });
  });

  it("rejects invalid session approval for dangerous permissions", async () => {
    const store = new TuiStore();
    const permission = store.requestPermission(
      edit,
      { callId: "1", name: "edit", input: { path: "src/a.ts" } },
      "dangerous",
    );
    store.resolveInteraction("s");
    expect(store.getSnapshot().pendingInteraction).toBeDefined();
    store.resolveInteraction("n");
    await expect(permission).resolves.toBe("deny");
  });

  it("cancels on abort and safely rejects overlapping interactions", async () => {
    const store = new TuiStore();
    const abort = new AbortController();
    const first = store.requestConfirm("First?", abort.signal);
    const second = store.requestConfirm("Second?");
    await expect(second).resolves.toBe(false);
    expect(store.getSnapshot().blocks.at(-1)).toMatchObject({ kind: "error" });
    abort.abort();
    await expect(first).resolves.toBe(false);
    expect(
      store
        .getSnapshot()
        .blocks.find((block) => block.kind === "interaction" && block.interaction === "confirm"),
    ).toMatchObject({ status: "cancelled" });
  });

  it("keeps one transient block across repeated starts and tool preparation", async () => {
    const events = new EventBus();
    const store = new TuiStore();
    store.connect(events);

    await events.emit("turn.started", { input: "hello" }, "turn");
    await events.emit("provider.started", {}, "turn");
    await events.emit("provider.started", {}, "turn");
    expect(store.getSnapshot().blocks.filter((block) => block.kind === "activity")).toHaveLength(1);

    await events.emit("provider.tool_call_start", { index: 0, name: "read" }, "turn");
    await events.emit(
      "provider.tool_call_delta",
      { index: 0, argumentsDelta: '{"path":"src/a.ts"}' },
      "turn",
    );
    expect(store.getSnapshot().blocks.at(-1)).toMatchObject({ kind: "activity", phase: "tool" });

    await events.emit("tool.started", { name: "read", summary: "src/a.ts" }, "turn");
    expect(store.getSnapshot().blocks.some((block) => block.kind === "activity")).toBe(false);

    await events.emit("permission.review_started", { name: "edit" }, "turn");
    expect(store.getSnapshot().blocks.at(-1)).toMatchObject({
      kind: "activity",
      phase: "reviewing",
    });
    await events.emit("permission.review_completed", { name: "edit" }, "turn");
    expect(store.getSnapshot().blocks.some((block) => block.kind === "activity")).toBe(false);
  });

  it.each([
    ["provider.completed", {}],
    ["provider.retry", { attempt: 1 }],
    ["turn.completed", {}],
    ["turn.failed", { message: "cancelled" }],
  ] as const)("cleans transient activity on %s", async (type, data) => {
    const events = new EventBus();
    const store = new TuiStore();
    store.connect(events);

    await events.emit("provider.started", {}, "turn");
    await events.emit(type, data, "turn");
    expect(store.getSnapshot().blocks.some((block) => block.kind === "activity")).toBe(false);
  });

  it("cleans transient activity on controller state changes and close", async () => {
    const events = new EventBus();
    const store = new TuiStore();
    store.connect(events);

    await events.emit("provider.started", {}, "turn");
    store.setSubmitting();
    expect(store.getSnapshot().blocks.some((block) => block.kind === "activity")).toBe(false);

    await events.emit("provider.started", {}, "turn");
    store.setIdle();
    expect(store.getSnapshot().blocks.some((block) => block.kind === "activity")).toBe(false);

    await events.emit("provider.started", {}, "turn");
    store.setFatal(new Error("fatal"));
    expect(store.getSnapshot().blocks.some((block) => block.kind === "activity")).toBe(false);

    await events.emit("provider.started", {}, "turn");
    store.close();
    expect(store.getSnapshot().blocks.some((block) => block.kind === "activity")).toBe(false);
  });

  it("refreshes thinking metadata immutably on thinking.changed", async () => {
    const events = new EventBus();
    const store = new TuiStore();
    store.setMetadata({
      provider: "openai",
      model: "test",
      workspace: "/workspace",
      workspaceId: "workspace-id",
      approvalMode: "auto",
      sessionId: "session-123",
      thinkingLevel: "default",
      thinkingDisplay: "default",
    });
    store.connect(events);
    const before = store.getSnapshot();

    await events.emit("thinking.changed", {
      level: "off",
      effectiveLevel: "minimal",
      displayLevel: "off→minimal",
    });

    const after = store.getSnapshot();
    expect(after).not.toBe(before);
    expect(after.metadata).toMatchObject({
      provider: "openai",
      model: "test",
      workspace: "/workspace",
      workspaceId: "workspace-id",
      approvalMode: "auto",
      sessionId: "session-123",
      thinkingLevel: "off",
      thinkingDisplay: "off→minimal",
    });
  });

  it("ignores malformed thinking.changed events", async () => {
    const events = new EventBus();
    const store = new TuiStore();
    const metadata = {
      provider: "openai" as const,
      model: "test",
      workspace: "/workspace",
      workspaceId: "workspace-id",
      approvalMode: "auto" as const,
      sessionId: "session-123",
      thinkingLevel: "default" as const,
      thinkingDisplay: "default",
    };
    store.setMetadata(metadata);
    store.connect(events);
    await events.emit("thinking.changed", { level: "extreme", displayLevel: "extreme" });
    expect(store.getSnapshot().metadata).toEqual(metadata);
  });
});
