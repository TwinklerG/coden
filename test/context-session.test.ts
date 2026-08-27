import { appendFile, mkdtemp, readFile, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ContextManager, TokenEstimator } from "../src/context/manager.js";
import { truncateOutput } from "../src/context/truncate.js";
import { EventBus } from "../src/core/events.js";
import type { AgentMessage } from "../src/core/types.js";
import { JSONLTraceWriter } from "../src/observability/trace.js";
import { SessionStore } from "../src/sessions/store.js";
import { builtinTools } from "../src/tools/builtin/index.js";

describe("context and sessions", () => {
  it("estimates, truncates, and compacts old messages", () => {
    expect(new TokenEstimator().estimateText("1234567")).toBe(2);
    const truncated = truncateOutput("x".repeat(1000), 200);
    expect(truncated.length).toBeLessThanOrEqual(200);
    expect(truncated).toContain("omitted");
    const messages: AgentMessage[] = [
      { role: "system", content: "system" },
      ...Array.from(
        { length: 14 },
        (_, i): AgentMessage => ({ role: "user", content: `${i} ${"x".repeat(200)}` }),
      ),
    ];
    const manager = new ContextManager({
      contextWindow: 900,
      reservedOutputTokens: 100,
      safetyMargin: 100,
    });
    const prepared = manager.prepare(messages, builtinTools());
    expect(prepared.compacted).toBe(true);
    expect(prepared.messages.length).toBeLessThan(messages.length);
  });
  it("keeps multi-tool call/result groups intact while compacting", () => {
    const messages: AgentMessage[] = [{ role: "system", content: "system" }];
    for (let turn = 0; turn < 6; turn++) {
      messages.push(
        { role: "user", content: `turn ${turn} ${"x".repeat(200)}` },
        {
          role: "assistant",
          content: "",
          toolCalls: [
            { callId: `${turn}-a`, name: "read", input: { path: "a" } },
            { callId: `${turn}-b`, name: "read", input: { path: "b" } },
          ],
        },
        { role: "tool", callId: `${turn}-a`, name: "read", content: "a", isError: false },
        { role: "tool", callId: `${turn}-b`, name: "read", content: "b", isError: false },
        { role: "assistant", content: `done ${turn}`, toolCalls: [] },
      );
    }
    const prepared = new ContextManager({
      contextWindow: 1200,
      reservedOutputTokens: 100,
      safetyMargin: 100,
    }).prepare(messages, builtinTools());
    const calls = new Set(
      prepared.messages.flatMap((message) =>
        message.role === "assistant" ? message.toolCalls.map((call) => call.callId) : [],
      ),
    );
    const results = new Set(
      prepared.messages.flatMap((message) => (message.role === "tool" ? [message.callId] : [])),
    );
    expect(calls).toEqual(results);
  });

  it("keeps tool call/result groups intact during emergency compaction", () => {
    const messages: AgentMessage[] = [{ role: "system", content: "system" }];
    for (let turn = 0; turn < 8; turn++) {
      messages.push(
        { role: "user", content: `turn ${turn}` },
        {
          role: "assistant",
          content: "",
          toolCalls: [{ callId: `c${turn}`, name: "read", input: { path: "x" } }],
        },
        { role: "tool", callId: `c${turn}`, name: "read", content: "r", isError: false },
      );
    }
    const manager = new ContextManager({
      contextWindow: 500,
      reservedOutputTokens: 100,
      safetyMargin: 100,
    });
    const prepared = manager.forceCompact(messages, builtinTools());
    const calls = new Set(
      prepared.messages.flatMap((message) =>
        message.role === "assistant" ? message.toolCalls.map((call) => call.callId) : [],
      ),
    );
    const results = new Set(
      prepared.messages.flatMap((message) => (message.role === "tool" ? [message.callId] : [])),
    );
    expect(calls).toEqual(results);
    expect(prepared.messages.at(-1)).toMatchObject({ role: "tool" });
    expect(manager.getSummary()).toContain("Emergency compacted");
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
});
