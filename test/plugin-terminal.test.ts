import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Writable } from "node:stream";
import { stripVTControlCharacters } from "node:util";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EventBus } from "../src/core/events.js";
import { TerminalRenderer } from "../src/observability/terminal.js";
import { builtinTools } from "../src/tools/builtin/index.js";
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

function visibleTerminal(value: string): string {
  return stripVTControlCharacters(value);
}

afterEach(() => {
  vi.useRealTimers();
});

describe("plugins and terminal", () => {
  it("loads good plugins, isolates failures, and reloads changed modules", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "coden-plugin-"));
    const directory = path.join(root, "plugins");
    await mkdir(directory);
    const good = path.join(directory, "hello.ts");
    await writeFile(
      good,
      `export default { name: "hello", description: "hello", risk: "read", inputSchema: { type: "object" }, async execute() { return { content: "v1" }; } };\n`,
    );
    await writeFile(path.join(directory, "bad.ts"), `export default 42;\n`);
    const events = new EventBus();
    const seen: string[] = [];
    events.on((event) => {
      seen.push(`${event.type}:${JSON.stringify(event.data ?? {})}`);
    });
    const loader = new PluginLoader(builtinTools(), events, true, undefined, async (specifier) => {
      if (specifier.includes("bad.ts")) return { default: 42 };
      const source = await readFile(new URL(specifier), "utf8");
      return {
        default: {
          name: "hello",
          description: "hello",
          risk: "read",
          inputSchema: { type: "object" },
          async execute() {
            return { content: source.includes("v2") ? "v2" : "v1" };
          },
        },
      };
    });
    const active = new ToolRegistry(builtinTools());
    const first = await loader.load([{ path: directory, project: true }]);
    active.replaceWith(first.registry);
    expect(active.get("hello")).toBeDefined();
    expect(first.failed).toHaveLength(1);
    expect(seen.some((value) => value.startsWith("plugin.loaded:"))).toBe(true);
    expect(seen.some((value) => value.startsWith("plugin.failed:"))).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 5));
    await writeFile(
      good,
      `export default { name: "hello", description: "hello", risk: "read", inputSchema: { type: "object" }, async execute() { return { content: "v2" }; } };\n`,
    );
    const second = await loader.load([{ path: directory, project: true }]);
    active.replaceWith(second.registry);
    const reloadedTool = active.get("hello");
    expect(reloadedTool).toBeDefined();
    const result = await reloadedTool?.execute(
      {},
      { workspace: root, signal: new AbortController().signal },
    );
    expect(result?.content).toBe("v2");
  });
  it("extends an installed registry and preserves source metadata", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "coden-plugin-"));
    const directory = path.join(root, "plugins");
    await mkdir(directory);
    await writeFile(
      path.join(directory, "local.ts"),
      `export default { name: "local_extension", description: "local", risk: "read", inputSchema: { type: "object" }, async execute() { return { content: "ok" }; } };\n`,
    );
    const events = new EventBus();
    const base = new ToolRegistry(builtinTools());
    const installed = {
      name: "installed_extension",
      description: "installed",
      risk: "read" as const,
      inputSchema: { type: "object" },
      async execute() {
        return { content: "installed" };
      },
    };
    base.register(installed, {
      kind: "npm",
      pluginName: "@acme/installed",
      pluginVersion: "1.0.0",
    });
    const loaded = await new PluginLoader(builtinTools(), events, true, undefined, async () => ({
      default: {
        name: "local_extension",
        description: "local",
        risk: "read",
        inputSchema: { type: "object" },
        async execute() {
          return { content: "ok" };
        },
      },
    })).load([{ path: directory, project: true }], base);
    expect(loaded.registry.get("installed_extension")).toBe(installed);
    const localSource = loaded.registry.source("local_extension");
    expect(localSource).toMatchObject({ kind: "local" });
    expect(localSource && "path" in localSource ? localSource.path : undefined).toContain(
      path.join("plugins", "local.ts"),
    );
  });

  it("fails closed when project trust callback is absent", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "coden-plugin-"));
    const directory = path.join(root, "plugins");
    await mkdir(directory);
    await writeFile(
      path.join(directory, "hello.ts"),
      `export default { name: "hello", description: "hello", risk: "read", inputSchema: { type: "object" }, async execute() { return { content: "ok" }; } };\n`,
    );
    const loader = new PluginLoader(builtinTools(), new EventBus(), false);
    const result = await loader.load([{ path: directory, project: true }]);
    expect(result.registry.list()).toHaveLength(4);
    expect(result.loaded).toEqual([]);
  });

  it("refuses untrusted project plugin directory", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "coden-plugin-"));
    await mkdir(path.join(root, "plugins"));
    const loader = new PluginLoader(builtinTools(), new EventBus(), false, async () => false);
    const result = await loader.load([{ path: path.join(root, "plugins"), project: true }]);
    expect(result.registry.list()).toHaveLength(4);
  });
  it("folds temporary TTY reasoning when formal content starts", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-28T00:00:00.000Z"));
    const out = new Sink();
    const err = new Sink();
    Object.assign(err, { columns: 40 });
    const events = new EventBus();
    const renderer = new TerminalRenderer(events, { stdout: out, stderr: err, tty: true });

    await events.emit("provider.started");
    await events.emit("provider.reasoning_delta", { text: "reviewing\n  project files" });
    expect(err.value).toContain("reviewing project files");
    const beforeLongDelta = err.value.length;
    await events.emit("provider.reasoning_delta", {
      text: " while checking a deliberately long additional detail",
    });
    const latestRender = err.value.slice(beforeLongDelta);
    expect(latestRender).toContain("…");
    expect(latestRender).not.toContain("\n  ");

    vi.advanceTimersByTime(3_200);
    await events.emit("provider.delta", { text: "Answer" });
    expect(out.value).toBe("");
    await events.emit("provider.completed", {});

    expect(err.value).toContain("thought for 3.2s");
    expect(out.value).toBe("Answer");
    renderer.dispose();
  });

  it("renders streamed tool arguments as a bounded TTY activity line", async () => {
    vi.useFakeTimers();
    const out = new Sink();
    const err = new Sink();
    Object.assign(err, { columns: 38 });
    const events = new EventBus();
    const renderer = new TerminalRenderer(events, { stdout: out, stderr: err, tty: true });

    await events.emit("provider.started");
    await events.emit("provider.tool_call_start", {
      index: 0,
      callId: "w",
      name: "write",
    });
    expect(err.value).toContain("preparing write…");

    const beforeDelta = err.value.length;
    await events.emit("provider.tool_call_delta", {
      index: 0,
      argumentsDelta: '{"path":"src/a.ts",\n"content":"a deliberately long payload"}',
    });
    const latestRender = err.value.slice(beforeDelta);
    expect(latestRender).toContain("preparing write…");
    expect(latestRender).toContain("…");
    expect(latestRender).not.toContain('\n"content');
    expect(out.value).toBe("");

    renderer.dispose();
  });

  it("clears tool argument previews across terminal lifecycle boundaries", async () => {
    vi.useFakeTimers();
    const out = new Sink();
    const err = new Sink();
    const events = new EventBus();
    const renderer = new TerminalRenderer(events, { stdout: out, stderr: err, tty: true });

    await events.emit("provider.started");
    await events.emit("provider.tool_call_start", { index: 0, callId: "w", name: "write" });
    await events.emit("provider.tool_call_delta", {
      index: 0,
      argumentsDelta: '{"content":"secret-end"}',
    });
    await events.emit("provider.tool_call_end", { index: 0 });
    const afterEnd = err.value.length;
    vi.advanceTimersByTime(100);
    expect(err.value.slice(afterEnd)).not.toContain("secret-end");

    await events.emit("provider.tool_call_start", { index: 1, callId: "e", name: "edit" });
    await events.emit("provider.tool_call_delta", {
      index: 1,
      argumentsDelta: '{"newText":"secret-text"}',
    });
    await events.emit("provider.delta", { text: "answer" });
    const afterText = err.value.length;
    vi.advanceTimersByTime(100);
    expect(err.value.slice(afterText)).not.toContain("secret-text");

    await events.emit("provider.started");
    await events.emit("provider.tool_call_start", { index: 2, callId: "b", name: "bash" });
    await events.emit("provider.tool_call_delta", {
      index: 2,
      argumentsDelta: '{"command":"secret-retry"}',
    });
    await events.emit("provider.retry", { attempt: 1 });
    const afterRetry = err.value.length;
    vi.advanceTimersByTime(100);
    expect(err.value.slice(afterRetry)).not.toContain("secret-retry");

    await events.emit("provider.started");
    await events.emit("provider.tool_call_start", { index: 3, callId: "r", name: "read" });
    await events.emit("provider.tool_call_delta", {
      index: 3,
      argumentsDelta: '{"path":"secret-tool-start"}',
    });
    await events.emit("tool.started", { name: "read" });
    const afterToolStart = err.value.length;
    vi.advanceTimersByTime(100);
    expect(err.value.slice(afterToolStart)).not.toContain("secret-tool-start");

    await events.emit("provider.started");
    await events.emit("provider.tool_call_start", { index: 4, callId: "r2", name: "read" });
    await events.emit("provider.tool_call_delta", {
      index: 4,
      argumentsDelta: '{"path":"secret-dispose"}',
    });
    renderer.dispose();
    const afterDispose = err.value.length;
    vi.advanceTimersByTime(100);
    expect(err.value.slice(afterDispose)).not.toContain("secret-dispose");
  });

  it("never renders streamed tool arguments in non-TTY mode", async () => {
    const out = new Sink();
    const err = new Sink();
    const events = new EventBus();
    const renderer = new TerminalRenderer(events, { stdout: out, stderr: err, tty: false });

    await events.emit("provider.started");
    await events.emit("provider.tool_call_start", { index: 0, callId: "w", name: "write" });
    await events.emit("provider.tool_call_delta", {
      index: 0,
      argumentsDelta: '{"content":"must-not-leak"}',
    });
    await events.emit("provider.tool_call_end", { index: 0 });
    await events.emit("provider.completed", {});

    expect(out.value).toBe("");
    expect(err.value).not.toContain("write");
    expect(err.value).not.toContain("must-not-leak");
    renderer.dispose();
  });

  it("ignores reasoning after formal TTY content starts", async () => {
    const out = new Sink();
    const err = new Sink();
    const events = new EventBus();
    const renderer = new TerminalRenderer(events, { stdout: out, stderr: err, tty: true });

    await events.emit("provider.started");
    await events.emit("provider.reasoning_delta", { text: "first thought" });
    await events.emit("provider.delta", { text: "answer" });
    const afterContent = err.value;
    await events.emit("provider.reasoning_delta", { text: "must not appear" });

    expect(err.value).toBe(afterContent);
    expect(err.value).not.toContain("must not appear");
    renderer.dispose();
  });

  it("clears failed-attempt reasoning without folding it", async () => {
    vi.useFakeTimers();
    const out = new Sink();
    const err = new Sink();
    const events = new EventBus();
    const renderer = new TerminalRenderer(events, { stdout: out, stderr: err, tty: true });

    await events.emit("provider.started");
    await events.emit("provider.reasoning_delta", { text: "discard me" });
    await events.emit("provider.retry", { attempt: 1 });
    const afterRetry = err.value;
    vi.advanceTimersByTime(200);

    expect(err.value).toBe(afterRetry);
    expect(err.value).not.toContain("thought for");
    renderer.dispose();
  });

  it("does not expose reasoning in non-TTY output", async () => {
    const out = new Sink();
    const err = new Sink();
    const events = new EventBus();
    const renderer = new TerminalRenderer(events, { stdout: out, stderr: err, tty: false });

    await events.emit("provider.started");
    await events.emit("provider.reasoning_delta", { text: "hidden chain of thought" });
    await events.emit("provider.delta", { text: "public answer" });
    await events.emit("provider.completed", {});

    expect(out.value).toBe("public answer");
    expect(err.value).not.toContain("hidden chain of thought");
    expect(err.value).not.toContain("thought for");
    renderer.dispose();
  });

  it("cleans active reasoning on tool start and dispose", async () => {
    vi.useFakeTimers();
    const out = new Sink();
    const err = new Sink();
    const events = new EventBus();
    const renderer = new TerminalRenderer(events, { stdout: out, stderr: err, tty: true });

    await events.emit("provider.started");
    await events.emit("provider.reasoning_delta", { text: "calling a tool" });
    await events.emit("tool.started", { name: "read" });
    const afterToolStart = err.value;
    vi.advanceTimersByTime(200);
    expect(err.value).toBe(afterToolStart);
    expect(err.value).not.toContain("thought for");

    await events.emit("provider.started");
    await events.emit("provider.reasoning_delta", { text: "active at dispose" });
    renderer.dispose();
    const afterDispose = err.value;
    vi.advanceTimersByTime(200);
    expect(err.value).toBe(afterDispose);
  });

  it("stops the spinner before permission prompting", async () => {
    const out = new Sink();
    const err = new Sink();
    const events = new EventBus();
    const renderer = new TerminalRenderer(events, { stdout: out, stderr: err, tty: true });
    await events.emit("provider.started");
    await events.emit("provider.completed");
    const afterStop = err.value;
    await new Promise((resolve) => setTimeout(resolve, 120));
    renderer.dispose();
    expect(err.value).toBe(afterStop);
  });

  it("cleans up TTY state on failure", async () => {
    const out = new Sink();
    const err = new Sink();
    const events = new EventBus();
    const renderer = new TerminalRenderer(events, { stdout: out, stderr: err, tty: true });
    await events.emit("provider.started");
    await events.emit("turn.failed", { message: "cancelled" });
    renderer.dispose();
    expect(err.value).toContain("failed: cancelled");
  });

  it("loads and hot-reloads a real TypeScript plugin through the Bun runtime", () => {
    const repo = process.cwd();
    const result = spawnSync(
      "bun",
      [
        path.join(repo, "test", "e2e", "plugin-reload.ts"),
        path.join(repo, "test", "fixtures", "plugin-hello-v1.ts"),
        path.join(repo, "test", "fixtures", "plugin-hello-v2.ts"),
      ],
      { encoding: "utf8", timeout: 30_000 },
    );
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      first: "v1",
      second: "v2",
      loaded: ["hello"],
    });
  });

  it("renders plugin diagnostics without noisy default success output", async () => {
    const out = new Sink();
    const err = new Sink();
    const events = new EventBus();
    const renderer = new TerminalRenderer(events, { stdout: out, stderr: err, tty: false });

    await events.emit("plugin.loaded", {
      source: "npm",
      scope: "project",
      packageName: "@fixtures/ok",
      version: "1.0.0",
      tools: ["fixture_ok"],
    });
    await events.emit("plugin.failed", {
      source: "npm",
      scope: "project",
      packageName: "@fixtures/bad",
      version: "1.0.0",
      message: "plugin.export_invalid; run coden plugin sync to repair the runtime",
    });
    await events.emit("plugin.unavailable", {
      source: "npm",
      scope: "project",
      path: "/work/.coden",
      reason: "workspace is not trusted",
    });
    await events.emit("plugin.restart_required", {
      source: "npm",
      packageName: "@fixtures/changed",
      diskVersion: "2.0.0",
      reason: "npm plugin metadata changed; restart CodeN to load it",
    });
    renderer.dispose();

    expect(out.value).toBe("");
    expect(err.value).not.toContain("plugin loaded: project @fixtures/ok");
    expect(err.value).toContain(
      "[coden] plugin failed: project @fixtures/bad@1.0.0 — plugin.export_invalid; run coden plugin sync to repair the runtime",
    );
    expect(err.value).toContain(
      "[coden] plugin unavailable: project /work/.coden — workspace is not trusted",
    );
    expect(err.value).toContain(
      "[coden] plugin restart required: @fixtures/changed@2.0.0 — npm plugin metadata changed; restart CodeN to load it",
    );
  });

  it("renders plugin load success only in verbose mode", async () => {
    const out = new Sink();
    const err = new Sink();
    const events = new EventBus();
    const renderer = new TerminalRenderer(events, {
      stdout: out,
      stderr: err,
      tty: false,
      verbose: true,
    });

    await events.emit("plugin.loaded", {
      source: "npm",
      scope: "global",
      packageName: "@fixtures/ok",
      version: "1.0.0",
    });
    renderer.dispose();

    expect(out.value).toBe("");
    expect(err.value).toContain("[coden] plugin loaded: global @fixtures/ok@1.0.0");
  });

  it("previews a raw incomplete Markdown line and commits it when complete", async () => {
    const out = new Sink();
    const err = new Sink();
    Object.assign(err, { columns: 80 });
    const events = new EventBus();
    const renderer = new TerminalRenderer(events, { stdout: out, stderr: err, tty: true });

    await events.emit("provider.started");
    await events.emit("provider.delta", { text: "**bo" });
    expect(out.value).toBe("");
    expect(visibleTerminal(err.value)).toContain("**bo");

    await events.emit("provider.delta", { text: "ld**\n" });
    expect(visibleTerminal(out.value)).toContain("bold\n");
    expect(visibleTerminal(err.value)).toContain("rendering…");

    await events.emit("provider.completed", {});
    renderer.dispose();
  });

  it("previews the newest fenced-code line within terminal width", async () => {
    const out = new Sink();
    const err = new Sink();
    Object.assign(err, { columns: 18 });
    const events = new EventBus();
    const renderer = new TerminalRenderer(events, { stdout: out, stderr: err, tty: true });

    await events.emit("provider.started");
    await events.emit("provider.delta", { text: "```ts\nfirst completed code line\n" });
    expect(out.value).toBe("");
    expect(visibleTerminal(err.value)).toContain("…leted code line");

    await events.emit("provider.delta", { text: "second partial" });
    expect(visibleTerminal(err.value)).toContain("second partial");

    await events.emit("provider.delta", { text: "\n```\n" });
    expect(visibleTerminal(out.value)).toContain("first completed code line\nsecond partial");
    renderer.dispose();
  });

  it("does not revive assistant previews after lifecycle cleanup", async () => {
    vi.useFakeTimers();
    const out = new Sink();
    const err = new Sink();
    const events = new EventBus();
    const renderer = new TerminalRenderer(events, { stdout: out, stderr: err, tty: true });

    await events.emit("provider.started");
    await events.emit("provider.delta", { text: "stale retry text" });
    await events.emit("provider.retry", { attempt: 1 });
    const retryBoundary = err.value.length;
    await events.emit("provider.started");
    vi.advanceTimersByTime(80);
    expect(visibleTerminal(err.value.slice(retryBoundary))).not.toContain("stale retry text");

    await events.emit("provider.delta", { text: "stale failure text" });
    await events.emit("turn.failed", { message: "failed" });
    const failureBoundary = err.value.length;
    await events.emit("provider.started");
    vi.advanceTimersByTime(80);
    expect(visibleTerminal(err.value.slice(failureBoundary))).not.toContain("stale failure text");

    await events.emit("provider.delta", { text: "stale tool text" });
    await events.emit("tool.started", { name: "read", summary: "path: a.ts" });
    const toolBoundary = err.value.length;
    await events.emit("provider.started");
    vi.advanceTimersByTime(80);
    expect(visibleTerminal(err.value.slice(toolBoundary))).not.toContain("stale tool text");

    await events.emit("provider.started");
    await events.emit("provider.delta", { text: "stale disposed text" });
    renderer.dispose();
    const disposeBoundary = err.value.length;
    vi.advanceTimersByTime(80);
    expect(visibleTerminal(err.value.slice(disposeBoundary))).not.toContain("stale disposed text");
  });

  it("renders assistant Markdown by complete lines in TTY mode", async () => {
    const out = new Sink();
    const err = new Sink();
    const events = new EventBus();
    const renderer = new TerminalRenderer(events, { stdout: out, stderr: err, tty: true });

    await events.emit("provider.started");
    await events.emit("provider.delta", { text: "**bo" });
    expect(out.value).toBe("");
    await events.emit("provider.delta", { text: "ld**\n`code`" });
    expect(out.value).toContain("bold\n");
    expect(out.value).not.toContain("**");
    await events.emit("provider.completed", {});
    expect(out.value).toContain("code");
    expect(out.value).not.toContain("`code`");
    renderer.dispose();
  });

  it("drops uncommitted TTY Markdown when a provider attempt retries", async () => {
    const out = new Sink();
    const err = new Sink();
    const events = new EventBus();
    const renderer = new TerminalRenderer(events, { stdout: out, stderr: err, tty: true });

    await events.emit("provider.started");
    await events.emit("provider.delta", { text: "discard **me" });
    await events.emit("provider.retry", { attempt: 1 });
    await events.emit("provider.started");
    await events.emit("provider.delta", { text: "keep **this**" });
    await events.emit("provider.completed", {});

    expect(out.value).toContain("keep this");
    expect(out.value).not.toContain("discard");
    renderer.dispose();
  });

  it("preserves raw Markdown in non-TTY and print modes", async () => {
    for (const options of [{ tty: false }, { tty: true, printMode: true }]) {
      const out = new Sink();
      const err = new Sink();
      const events = new EventBus();
      const renderer = new TerminalRenderer(events, { stdout: out, stderr: err, ...options });
      await events.emit("provider.started");
      await events.emit("provider.delta", { text: "**raw**\n" });
      await events.emit("provider.completed", {});
      expect(out.value).toBe("**raw**\n");
      renderer.dispose();
    }
  });

  it("renders concise tool lifecycle symbols and summaries only in TTY mode", async () => {
    const out = new Sink();
    const err = new Sink();
    Object.assign(err, { columns: 80 });
    const events = new EventBus();
    const renderer = new TerminalRenderer(events, { stdout: out, stderr: err, tty: true });

    await events.emit("tool.started", {
      name: "custom_search",
      summary: "query: terminal markdown",
    });
    await events.emit("tool.completed", {
      name: "custom_search",
      isError: false,
      durationMs: 12,
    });
    await events.emit("tool.completed", { name: "deploy", isError: true, durationMs: 438 });

    expect(err.value).toContain("◇ custom_search  query: terminal markdown");
    expect(err.value).toContain("✓ custom_search  12ms");
    expect(err.value).toContain("✗ deploy  438ms");
    renderer.dispose();
  });

  it("preserves generic non-TTY tool lifecycle messages", async () => {
    const out = new Sink();
    const err = new Sink();
    const events = new EventBus();
    const renderer = new TerminalRenderer(events, { stdout: out, stderr: err, tty: false });

    await events.emit("tool.started", { name: "read", summary: "path: secret.txt" });
    await events.emit("tool.completed", { name: "read", isError: false, durationMs: 2 });

    expect(err.value).toContain("[coden] tool read started");
    expect(err.value).toContain("[coden] tool read completed (2ms)");
    expect(err.value).not.toContain("secret.txt");
    renderer.dispose();
  });

  it("renders stable non-TTY output", async () => {
    const out = new Sink();
    const err = new Sink();
    const events = new EventBus();
    const renderer = new TerminalRenderer(events, { stdout: out, stderr: err, tty: false });
    await events.emit("provider.delta", { text: "hello" });
    await events.emit("provider.completed", {});
    await events.emit("tool.completed", { name: "read", isError: false, durationMs: 2 });
    await events.emit("turn.completed", {
      tools: 1,
      durationMs: 3,
      inputTokens: 4,
      outputTokens: 5,
    });
    renderer.dispose();
    expect(out.value).toBe("hello\n");
    expect(err.value).toContain("[coden] tool read completed");
    expect(err.value).toContain("done: 1 tools");
  });

  it("discards partial non-TTY output when a retry follows", async () => {
    const out = new Sink();
    const err = new Sink();
    const events = new EventBus();
    const renderer = new TerminalRenderer(events, { stdout: out, stderr: err, tty: false });
    await events.emit("provider.delta", { text: "partial " });
    await events.emit("provider.retry", { attempt: 1 });
    await events.emit("provider.delta", { text: "full answer" });
    await events.emit("provider.completed", {});
    await events.emit("turn.completed", { tools: 0, durationMs: 1 });
    renderer.dispose();
    expect(out.value).toBe("full answer\n");
  });
});
