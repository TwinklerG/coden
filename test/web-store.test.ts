import { describe, expect, it } from "vitest";
import { EventBus } from "../src/core/events.js";
import type { ToolDefinition } from "../src/core/types.js";
import { WebStore } from "../src/web/store.js";

const tool: ToolDefinition = {
  name: "write",
  description: "write",
  risk: "modify",
  inputSchema: { type: "object" },
  async execute() {
    return { content: "ok" };
  },
};

describe("WebStore", () => {
  it("projects streamed turns and tool details", async () => {
    const events = new EventBus();
    const store = new WebStore("zh");
    const revisions: number[] = [];
    store.subscribe((revision) => revisions.push(revision));
    store.connect(events);

    await events.emit("turn.started", { input: "fix tests" }, "turn-1");
    await events.emit("provider.delta", { text: "first" }, "turn-1");
    await events.emit("provider.delta", { text: " second" }, "turn-1");
    await events.emit(
      "tool.started",
      { name: "write", callId: "call-1", input: { path: "a" }, risk: "modify" },
      "turn-1",
    );
    await events.emit(
      "tool.completed",
      { name: "write", callId: "call-1", durationMs: 12, isError: false },
      "turn-1",
    );
    await events.emit(
      "tool.result",
      { name: "write", callId: "call-1", content: "ok", isError: false },
      "turn-1",
    );
    await events.emit(
      "turn.completed",
      { inputTokens: 10, outputTokens: 4, durationMs: 25 },
      "turn-1",
    );

    expect(store.snapshot()).toMatchObject({ phase: "idle", running: false });
    expect(store.snapshot().blocks).toEqual([
      expect.objectContaining({ kind: "user", text: "fix tests" }),
      expect.objectContaining({ kind: "assistant", markdown: "first second" }),
      expect.objectContaining({
        kind: "tool",
        callId: "call-1",
        status: "succeeded",
        input: { path: "a" },
        output: "ok",
        durationMs: 12,
      }),
    ]);
    expect(revisions).toEqual(revisions.map((_, index) => index + 1));
  });

  it("fails closed for interactions and keeps their transcript block", async () => {
    const store = new WebStore("en");
    const pending = store.openPermission(
      tool,
      { callId: "call-1", name: "write", input: { path: "a" } },
      "dangerous",
    );
    expect(store.snapshot().pendingInteractionId).toBe(pending.id);
    expect(() => store.resolveInteraction(pending.id, "allow_session")).toThrow("dangerous");
    store.resolveInteraction(pending.id, "deny");
    await expect(pending.promise).resolves.toBe("deny");
    expect(store.snapshot().pendingInteractionId).toBeUndefined();
    expect(store.snapshot().blocks.at(-1)).toMatchObject({
      kind: "interaction",
      status: "resolved",
      decision: "deny",
    });
    expect(() => store.resolveInteraction(pending.id, "deny")).toThrow("no longer pending");
  });

  it("projects recovered messages without system and hook context", () => {
    const store = new WebStore("en");
    store.setRecoveredMessages([
      { role: "system", content: "secret" },
      { role: "user", source: "hook", content: "hidden" },
      { role: "user", content: "hello" },
      {
        role: "assistant",
        content: "working",
        toolCalls: [{ callId: "c", name: "write", input: { path: "a" } }],
      },
      { role: "tool", callId: "c", name: "write", content: "done", isError: false },
    ]);
    expect(JSON.stringify(store.snapshot().blocks)).not.toContain("secret");
    expect(JSON.stringify(store.snapshot().blocks)).not.toContain("hidden");
    expect(store.snapshot().blocks.at(-1)).toMatchObject({
      kind: "tool",
      status: "succeeded",
      output: "done",
    });
  });
});
