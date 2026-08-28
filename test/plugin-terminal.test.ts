import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Writable } from "node:stream";
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

    expect(err.value).toContain("thought for 3.2s");
    expect(out.value).toBe("Answer");
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
