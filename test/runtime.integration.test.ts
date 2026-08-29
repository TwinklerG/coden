import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Writable } from "node:stream";
import { describe, expect, it } from "vitest";
import { composeRuntimePackageRegistry, loadInstalledScope } from "../src/cli/agent-command.js";
import { TrustStore } from "../src/config/trust.js";
import { ContextManager } from "../src/context/manager.js";
import { EventBus } from "../src/core/events.js";
import { AgentRuntime } from "../src/core/runtime.js";
import type { ModelEvent, ModelProvider, ModelRequest, ToolDefinition } from "../src/core/types.js";
import { TerminalRenderer } from "../src/observability/terminal.js";
import { PermissionPolicy } from "../src/permissions/policy.js";
import { InstalledPluginLoader } from "../src/plugins/installed-loader.js";
import { serializePluginManifest } from "../src/plugins/manifest.js";
import { resolvePluginPaths } from "../src/plugins/paths.js";
import { ScriptedProvider, scriptedText, scriptedTool } from "../src/providers/scripted.js";
import { SessionStore } from "../src/sessions/store.js";
import { builtinTools } from "../src/tools/builtin/index.js";
import { ToolExecutor } from "../src/tools/executor.js";
import { PluginLoader } from "../src/tools/plugin-loader.js";
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
function runtimePackage(
  packageName: string,
  ...toolNames: string[]
): {
  packageName: string;
  version: string;
  entryPath: string;
  tools: ToolDefinition[];
} {
  return {
    packageName,
    version: "1.0.0",
    entryPath: `/runtime/${packageName.replaceAll("/", "-")}.js`,
    tools: toolNames.map((name) => ({
      name,
      description: name,
      risk: "read" as const,
      inputSchema: { type: "object" },
      async execute() {
        return { content: name };
      },
    })),
  };
}

describe("AgentRuntime integration", () => {
  it("trusts workspace subjects by their real path", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "coden-trust-"));
    const data = await mkdtemp(path.join(os.tmpdir(), "coden-trust-data-"));
    const store = new TrustStore(path.join(data, "trusted.json"));
    await store.trustWorkspace(workspace);
    expect(await store.isWorkspaceTrusted(workspace)).toBe(true);
  });
  it("passes global and trusted project npm tools to the provider", async () => {
    const provider = new ScriptedProvider([scriptedText("ready")]);
    const h = await harness(provider);
    const composed = await composeRuntimePackageRegistry(
      builtinTools(),
      [runtimePackage("@fixtures/global", "global_tool")],
      [runtimePackage("@fixtures/project", "project_tool")],
      h.events,
    );
    h.registry.replaceWith(composed.registry);
    await h.runtime.run("use fixtures");
    const names = provider.requests[0]?.tools.map((tool) => tool.name) ?? [];
    expect(names).toEqual(expect.arrayContaining(["global_tool", "project_tool"]));
  });

  it("keeps global tools when an untrusted project is unavailable", async () => {
    const provider = new ScriptedProvider([scriptedText("global only")]);
    const h = await harness(provider);
    await h.events.emit("plugin.unavailable", {
      source: "npm",
      scope: "project",
      reason: "workspace is not trusted",
    });
    const composed = await composeRuntimePackageRegistry(
      builtinTools(),
      [runtimePackage("@fixtures/global", "global_tool")],
      [],
      h.events,
    );
    h.registry.replaceWith(composed.registry);
    await h.runtime.run("list tools");
    expect(provider.requests[0]?.tools.map((tool) => tool.name)).toContain("global_tool");
    expect(h.observed).toContain("plugin.unavailable");
  });

  it("shadows a global package with the trusted project package", async () => {
    const h = await harness(new ScriptedProvider([scriptedText("project package")]));
    const composed = await composeRuntimePackageRegistry(
      builtinTools(),
      [runtimePackage("@fixtures/same", "global_tool")],
      [runtimePackage("@fixtures/same", "project_tool")],
      h.events,
    );
    expect(composed.registry.get("global_tool")).toBeUndefined();
    h.registry.replaceWith(composed.registry);
    await h.runtime.run("use project package");
    expect(h.registry.get("global_tool")).toBeUndefined();
    expect(h.registry.get("project_tool")).toBeDefined();
  });

  it("isolates a conflicting later npm package and emits its sources", async () => {
    const h = await harness(new ScriptedProvider([scriptedText("continue")]));
    const failures: string[] = [];
    h.events.on((event) => {
      if (event.type === "plugin.failed") failures.push(String(event.data?.message));
    });
    const composed = await composeRuntimePackageRegistry(
      builtinTools(),
      [runtimePackage("@fixtures/first", "shared_tool")],
      [runtimePackage("@fixtures/later", "shared_tool", "later_tool")],
      h.events,
    );
    h.registry.replaceWith(composed.registry);
    await h.runtime.run("continue");
    expect(h.registry.get("shared_tool")).toBeDefined();
    expect(h.registry.get("later_tool")).toBeUndefined();
    expect(h.observed).toContain("plugin.failed");
    expect(failures.join(" ")).toMatch(/@fixtures\/first@1\.0\.0.*@fixtures\/later@1\.0\.0/s);
  });

  it("reports a missing npm runtime with a sync repair diagnostic", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "coden-missing-runtime-"));
    const paths = resolvePluginPaths(workspace, "project", path.join(workspace, "data"));
    await mkdir(path.dirname(paths.manifestPath), { recursive: true });
    await writeFile(
      paths.manifestPath,
      serializePluginManifest({
        schemaVersion: 1,
        plugins: { "@fixtures/missing": { source: "npm", requested: "latest" } },
      }),
    );
    const events = new EventBus();
    const messages: string[] = [];
    events.on((event) => {
      if (event.type === "plugin.failed") messages.push(String(event.data?.message));
    });
    const result = await loadInstalledScope(new InstalledPluginLoader(), paths, events, "project");
    expect(result.loaded).toEqual([]);
    expect(messages.join(" ")).toContain("coden plugin sync");
  });

  it("reloads local TypeScript tools while retaining npm tools", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "coden-reload-"));
    const directory = path.join(root, "plugins");
    await mkdir(directory);
    const file = path.join(directory, "local.ts");
    await writeFile(file, "v1");
    const base = new ToolRegistry(builtinTools());
    const npmTool = runtimePackage("@fixtures/cached", "cached_npm").tools[0];
    if (!npmTool) throw new Error("npm fixture tool missing");
    base.register(npmTool, {
      kind: "npm",
      pluginName: "@fixtures/cached",
      pluginVersion: "1.0.0",
    });
    const loader = new PluginLoader(
      builtinTools(),
      new EventBus(),
      true,
      undefined,
      async (specifier) => {
        const source = await readFile(new URL(specifier), "utf8");
        return {
          default: {
            name: "local_reload",
            description: "reload",
            risk: "read" as const,
            inputSchema: { type: "object" },
            async execute() {
              return { content: source };
            },
          },
        };
      },
    );
    const first = await loader.load([{ path: directory, project: true }], base);
    const firstTool = first.registry.get("local_reload");
    expect(first.registry.get("cached_npm")).toBeDefined();
    expect(firstTool).toBeDefined();
    expect(
      (await firstTool?.execute({}, { workspace: root, signal: new AbortController().signal }))
        ?.content,
    ).toBe("v1");
    await writeFile(file, "v2");
    const second = await loader.load([{ path: directory, project: true }], base);
    const secondTool = second.registry.get("local_reload");
    expect(second.registry.get("cached_npm")).toBeDefined();
    expect(
      (await secondTool?.execute({}, { workspace: root, signal: new AbortController().signal }))
        ?.content,
    ).toBe("v2");
  });

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
  it("forwards reasoning events without adding them to the answer", async () => {
    const provider = new ScriptedProvider([
      [
        { type: "reasoning_delta", text: "private analysis" },
        { type: "text_delta", text: "public answer" },
        { type: "reasoning_delta", text: "late analysis" },
        { type: "done" },
      ],
    ]);
    const h = await harness(provider);
    const reasoning: string[] = [];
    h.events.on((event) => {
      if (event.type === "provider.reasoning_delta") reasoning.push(String(event.data?.text ?? ""));
    });

    const result = await h.runtime.run("hello");

    expect(reasoning).toEqual(["private analysis", "late analysis"]);
    expect(result.answer).toBe("public answer");
  });

  it("forwards streamed tool-call lifecycle events with one turn ID", async () => {
    const provider = new ScriptedProvider([
      scriptedTool("w", "write", { path: "a.txt", content: "hello" }),
      scriptedText("done"),
    ]);
    const h = await harness(provider);
    const lifecycle: Array<{
      type: string;
      turnId?: string;
      data?: Record<string, unknown>;
    }> = [];
    h.events.on((event) => {
      if (event.type.startsWith("provider.tool_call_")) lifecycle.push(event);
    });

    await h.runtime.run("write a file");

    expect(lifecycle.map(({ type, data }) => ({ type, data }))).toEqual([
      {
        type: "provider.tool_call_start",
        data: { index: 0, callId: "w", name: "write" },
      },
      {
        type: "provider.tool_call_delta",
        data: { index: 0, argumentsDelta: '{"path":"a.txt","content":"hello"}' },
      },
      { type: "provider.tool_call_end", data: { index: 0 } },
    ]);
    expect(lifecycle[0]?.turnId).toBeTruthy();
    expect(new Set(lifecycle.map((event) => event.turnId)).size).toBe(1);
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
