import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Writable } from "node:stream";
import { describe, expect, it } from "vitest";
import { ContextManager } from "../src/context/manager.js";
import { EventBus } from "../src/core/events.js";
import { AgentRuntime } from "../src/core/runtime.js";
import type { ModelEvent, ModelProvider, ModelRequest } from "../src/core/types.js";
import { TerminalRenderer } from "../src/observability/terminal.js";
import { PermissionPolicy } from "../src/permissions/policy.js";
import { ScriptedProvider, scriptedText, scriptedTool } from "../src/providers/scripted.js";
import { SessionStore } from "../src/sessions/store.js";
import { builtinTools } from "../src/tools/builtin/index.js";
import { ToolExecutor } from "../src/tools/executor.js";
import { ToolRegistry } from "../src/tools/registry.js";

class Sink extends Writable {
  value = "";
  _write(
    chunk: Buffer | string,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ) {
    this.value += chunk.toString();
    callback();
  }
}

class StreamFailThenSucceed implements ModelProvider {
  attempts = 0;
  async *stream(_request: ModelRequest): AsyncIterable<ModelEvent> {
    this.attempts++;
    if (this.attempts === 1) {
      yield { type: "text_delta", text: "partial" };
      throw Object.assign(new Error("stream interrupted"), { status: 500 });
    }
    yield { type: "text_delta", text: "final answer" };
    yield { type: "done" };
  }
}

async function harness(
  provider: ModelProvider,
  auto = true,
  prompt = async () => "deny" as const,
  maxSteps = 20,
  contextWindow = 10_000,
) {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "coden-runtime-"));
  const data = await mkdtemp(path.join(os.tmpdir(), "coden-data-"));
  const events = new EventBus();
  const observed: string[] = [];
  events.on((event) => {
    observed.push(event.type);
  });
  const registry = new ToolRegistry(builtinTools());
  const session = new SessionStore(data, workspace, "test-session");
  await session.create(workspace);
  const executor = new ToolExecutor(
    registry,
    new PermissionPolicy(auto, prompt),
    events,
    workspace,
  );
  const runtime = new AgentRuntime(
    provider,
    registry,
    executor,
    new ContextManager({ contextWindow, reservedOutputTokens: 200, safetyMargin: 100 }),
    session,
    events,
    { model: "scripted", retries: 2, retryBaseMs: 1, maxSteps },
  );
  return { workspace, events, observed, registry, session, runtime };
}
describe("AgentRuntime integration", () => {
  it("runs read -> edit -> bash -> final answer", async () => {
    const provider = new ScriptedProvider([
      scriptedTool("r", "read", { path: "file.txt" }),
      scriptedTool("e", "edit", { path: "file.txt", oldText: "bad", newText: "good" }),
      scriptedTool("b", "bash", { command: "grep -q good file.txt" }),
      scriptedText("Fixed and verified."),
    ]);
    const h = await harness(provider);
    await writeFile(path.join(h.workspace, "file.txt"), "bad\n", "utf8");
    const result = await h.runtime.run("fix file");
    expect(result.answer).toBe("Fixed and verified.");
    expect(result.toolsExecuted).toBe(3);
    expect(await readFile(path.join(h.workspace, "file.txt"), "utf8")).toBe("good\n");
    expect(provider.requests[3]?.messages.at(-1)).toMatchObject({
      role: "tool",
      name: "bash",
      isError: false,
    });
    expect(h.observed).toContain("turn.completed");
  });
  it("feeds permission denial to the model", async () => {
    const provider = new ScriptedProvider([
      scriptedTool("e", "edit", { path: "a", oldText: "x", newText: "y" }),
      (request) => {
        expect(request.messages.at(-1)).toMatchObject({ role: "tool", isError: true });
        return scriptedText("Permission denied; no change made.");
      },
    ]);
    const h = await harness(provider, false);
    const result = await h.runtime.run("edit");
    expect(result.answer).toContain("Permission denied");
  });
  it("retries temporary provider errors", async () => {
    const provider = new ScriptedProvider([
      Object.assign(new Error("rate limited"), { status: 429 }),
      scriptedText("recovered"),
    ]);
    const h = await harness(provider);
    expect((await h.runtime.run("hello")).answer).toBe("recovered");
    expect(h.observed).toContain("provider.retry");
  });
  it("retries a stream that fails mid-flight without leaking partial output", async () => {
    const provider = new StreamFailThenSucceed();
    const h = await harness(provider);
    const out = new Sink();
    const err = new Sink();
    const renderer = new TerminalRenderer(h.events, { stdout: out, stderr: err, tty: false });
    expect((await h.runtime.run("hello")).answer).toBe("final answer");
    renderer.dispose();
    expect(provider.attempts).toBe(2);
    expect(h.observed).toContain("provider.retry");
    expect(out.value).toBe("final answer\n");
  });
  it("uses the current model for proactive compaction", async () => {
    const provider = new ScriptedProvider([
      scriptedText("one"),
      scriptedText("two"),
      scriptedText("three"),
      scriptedText("Goals and decisions preserved."),
      scriptedText("four"),
    ]);
    const h = await harness(provider, true, async () => "deny", 20, 900);
    await h.runtime.run("first");
    await h.runtime.run("second");
    await h.runtime.run("third");
    expect((await h.runtime.run("fourth")).answer).toBe("four");
    expect(h.observed).toContain("context.compaction_started");
    expect(provider.requests.at(-2)?.tools).toEqual([]);
  });

  it("emergency-compacts once before reporting context exhaustion", async () => {
    const provider = new ScriptedProvider([
      Object.assign(new Error("context length exceeded"), { status: 400 }),
      Object.assign(new Error("context length exceeded"), { status: 400 }),
    ]);
    const h = await harness(provider);
    await expect(h.runtime.run("large task")).rejects.toMatchObject({
      code: "context.exhausted",
    });
    expect(h.observed.filter((type) => type === "context.compacted")).toHaveLength(1);
  });

  it("fails deterministically at the model step limit", async () => {
    const provider = new ScriptedProvider([scriptedTool("r", "read", { path: "file.txt" })]);
    const h = await harness(provider, true, async () => "deny", 1);
    await writeFile(path.join(h.workspace, "file.txt"), "body", "utf8");
    await expect(h.runtime.run("loop forever")).rejects.toMatchObject({
      code: "runtime.step_limit",
    });
    expect(h.observed.at(-1)).toBe("turn.failed");
  });

  it("starts a recoverable new logical conversation", async () => {
    const h = await harness(
      new ScriptedProvider([scriptedText("old answer"), scriptedText("new answer")]),
    );
    await h.runtime.run("old task");
    await h.runtime.reset();
    await h.runtime.run("new task");
    const recovered = await h.session.recover();
    expect(
      recovered.messages.some(
        (message) => message.role === "user" && message.content === "old task",
      ),
    ).toBe(false);
    expect(
      recovered.messages.some(
        (message) => message.role === "user" && message.content === "new task",
      ),
    ).toBe(true);
  });

  it("persists and resumes a completed session", async () => {
    const h = await harness(new ScriptedProvider([scriptedText("first")]));
    await h.runtime.run("one");
    const recovered = await h.session.recover();
    expect(recovered.messages[0]?.role).toBe("system");
    const provider = new ScriptedProvider([
      (request) => {
        expect(
          request.messages.some(
            (message) => message.role === "assistant" && message.content === "first",
          ),
        ).toBe(true);
        return scriptedText("second");
      },
    ]);
    const events = new EventBus();
    const executor = new ToolExecutor(h.registry, new PermissionPolicy(true), events, h.workspace);
    const resumed = new AgentRuntime(
      provider,
      h.registry,
      executor,
      new ContextManager({ contextWindow: 10000, reservedOutputTokens: 1000, safetyMargin: 500 }),
      h.session,
      events,
      { model: "scripted" },
      recovered.messages,
    );
    expect((await resumed.run("two")).answer).toBe("second");
  });

  it("persists a session title only once from the first user message", async () => {
    const h = await harness(new ScriptedProvider([scriptedText("hello"), scriptedText("again")]));
    await h.runtime.run("first question");
    await h.runtime.run("second question");

    const list = await h.session.list();
    expect(list[0]?.title).toBe("first question");
    // 第二条消息不会覆盖已有标题
    const text = await readFile(h.session.sessionPath, "utf8");
    expect(text.match(/"type":"session\.title"/g)).toHaveLength(1);
  });
});
