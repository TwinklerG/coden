import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Writable } from "node:stream";
import { describe, expect, it } from "vitest";
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
