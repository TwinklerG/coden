import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { mkdtemp, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { classifyReplInput, collectFallbackInput } from "../src/cli/agent-command.js";
import { SessionStore, workspaceHash } from "../src/sessions/store.js";
import { CODEN_VERSION } from "../src/version.js";

const cli = path.join(process.cwd(), "src", "cli", "index.ts");
const baseEnv = {
  ...process.env,
  CODEN_OPENAI_API_KEY: "",
  CODEN_ANTHROPIC_API_KEY: "",
  CODEN_PROVIDER: "",
  CODEN_MODEL: "",
  CODEN_MAX_STEPS: "",
  CODEN_THINKING_LEVEL: "",
  XDG_CONFIG_HOME: path.join(os.tmpdir(), `coden-cli-config-${process.pid}`),
};

describe("REPL input helpers", () => {
  it("classifies commands without trimming messages", () => {
    expect(classifyReplInput("  /help  ")).toEqual({ type: "command", command: "/help" });
    expect(classifyReplInput("/skills")).toEqual({ type: "command", command: "/skills" });
    expect(classifyReplInput("/help\nmore")).toEqual({ type: "message", text: "/help\nmore" });
    expect(classifyReplInput("  code\n    indented\n")).toEqual({
      type: "message",
      text: "  code\n    indented\n",
    });
    expect(classifyReplInput(" \n\t ")).toEqual({ type: "empty" });
  });

  it("collects fallback continuation input", async () => {
    const lines = ["first\\", "second"];
    await expect(
      collectFallbackInput(async (prompt) => {
        expect(prompt).toBe(lines.length === 2 ? "> " : "  ");
        return lines.shift();
      }),
    ).resolves.toEqual({ type: "submit", text: "first\nsecond" });
  });

  it("handles fallback EOF and literal trailing backslashes", async () => {
    await expect(collectFallbackInput(async () => undefined)).resolves.toEqual({ type: "eof" });

    const eofAfterContinuation = ["first\\", undefined];
    await expect(collectFallbackInput(async () => eofAfterContinuation.shift())).resolves.toEqual({
      type: "eof",
    });

    const literalSlash = ["path\\\\"];
    await expect(collectFallbackInput(async () => literalSlash.shift())).resolves.toEqual({
      type: "submit",
      text: "path\\",
    });
  });
});

describe("CLI exit codes", () => {
  it("advertises and validates TUI/CLI modes", () => {
    const help = spawnSync("bun", [cli, "--help"], {
      encoding: "utf8",
      env: baseEnv,
      timeout: 30_000,
    });
    expect(help.status).toBe(0);
    expect(help.stdout).toContain("--tui");
    expect(help.stdout).toContain("--cli");
    expect(help.stdout).toContain("--thinking <level>");

    const conflict = spawnSync("bun", [cli, "--tui", "--cli"], {
      encoding: "utf8",
      env: baseEnv,
      timeout: 30_000,
    });
    expect(conflict.status).toBe(2);
    expect(conflict.stderr).toContain("不能");
  });

  it("rejects an invalid --thinking value before execution", () => {
    const invalid = spawnSync("bun", [cli, "--thinking", "extreme", "task"], {
      encoding: "utf8",
      env: baseEnv,
      timeout: 30_000,
    });
    expect(invalid.status).toBe(1);
    expect(invalid.stderr).toContain("default, off, minimal, low, medium, or high");
  });

  it("warns and falls back when explicit TUI has no TTY", () => {
    const result = spawnSync("bun", [cli, "--tui", "task"], {
      encoding: "utf8",
      env: baseEnv,
      timeout: 30_000,
    });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("已降级为 CLI");
    expect(result.stderr).toContain("CODEN_OPENAI_API_KEY");
  });

  it("exits 2 for configuration errors (missing API key)", () => {
    const result = spawnSync("bun", [cli, "-p", "--provider", "openai", "task"], {
      encoding: "utf8",
      env: baseEnv,
      timeout: 30_000,
    });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("CODEN_OPENAI_API_KEY");
  });

  it("rejects --smart-approve together with --auto", () => {
    const result = spawnSync("bun", [cli, "--smart-approve", "--auto", "task"], {
      encoding: "utf8",
      env: baseEnv,
      timeout: 30_000,
    });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("不能同时使用");
  });

  it("rejects --allow-outside-workspace without --auto", () => {
    const result = spawnSync("bun", [cli, "--allow-outside-workspace", "task"], {
      encoding: "utf8",
      env: baseEnv,
      timeout: 30_000,
    });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("必须与 --auto 一起使用");
  });

  it("preserves positional prompt parsing", () => {
    const result = spawnSync("bun", [cli, "fix tests"], {
      encoding: "utf8",
      env: baseEnv,
      timeout: 30_000,
    });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("CODEN_OPENAI_API_KEY");
    expect(result.stderr).not.toContain("unknown command");
  });

  it("exits 1 for execution/session failures", () => {
    const result = spawnSync("bun", [cli, "-p", "--resume", "missing-session", "task"], {
      encoding: "utf8",
      env: { ...baseEnv, CODEN_OPENAI_API_KEY: "test-key" },
      timeout: 30_000,
    });
    expect(result.status).toBe(1);
  });
});

describe("CLI session list and resume", () => {
  // config.dataDir = $XDG_DATA_HOME/coden (userDataDir() adds "/coden")，必须与 CLI 读取一致。
  // macOS 上 /var 是 /private/var 的符号链接：CLI 的 process.cwd() 返回规范化路径，
  // 所以用 realpathSync 统一，避免 workspaceHash 不匹配。
  async function makeSession(workspace: string, xdgHome: string, id: string) {
    const store = new SessionStore(path.join(xdgHome, "coden"), workspace, id);
    await store.create(workspace);
    await store.setTitle("hello world");
    await store.appendMessage({ role: "user", content: "hello world" });
  }
  async function makeWorkspace() {
    return realpathSync(await mkdtemp(path.join(os.tmpdir(), "coden-ws-")));
  }
  it("shows model, approval mode, and thinking level in the startup banner", async () => {
    const workspace = await makeWorkspace();
    const xdgHome = await mkdtemp(path.join(os.tmpdir(), "coden-xdg-"));
    const result = spawnSync("bun", [cli], {
      cwd: workspace,
      encoding: "utf8",
      input: "/quit\n",
      env: { ...baseEnv, CODEN_OPENAI_API_KEY: "test-key", XDG_DATA_HOME: xdgHome },
      timeout: 30_000,
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain(`版本：${CODEN_VERSION}`);
    expect(result.stdout).toContain(`工作区哈希：${workspaceHash(workspace)}`);
    expect(result.stdout).toContain("模型：gpt-5-mini");
    expect(result.stdout).toContain("审批模式：manual");
    expect(result.stdout).toContain("思考等级：default");
    expect(result.stdout).toContain("会话ID：");
    expect(result.stdout).not.toContain("CodeN 会话");
    expect(result.stdout).not.toContain("输入 /help 查看命令");
  });
  it("lists sessions with --resume and no id", async () => {
    const workspace = await makeWorkspace();
    const xdgHome = await mkdtemp(path.join(os.tmpdir(), "coden-xdg-"));
    await makeSession(workspace, xdgHome, "my-session");
    const result = spawnSync("bun", [cli, "--resume"], {
      cwd: workspace,
      encoding: "utf8",
      env: { ...baseEnv, CODEN_OPENAI_API_KEY: "", XDG_DATA_HOME: xdgHome },
      timeout: 30_000,
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("my-session");
    expect(result.stdout).toContain("hello world");
  });
  it("does not persist a session that exits before its first request", async () => {
    const workspace = await makeWorkspace();
    const xdgHome = await mkdtemp(path.join(os.tmpdir(), "coden-xdg-"));
    const result = spawnSync("bun", [cli], {
      cwd: workspace,
      encoding: "utf8",
      input: "/new\n/quit\n",
      env: { ...baseEnv, CODEN_OPENAI_API_KEY: "test-key", XDG_DATA_HOME: xdgHome },
      timeout: 30_000,
    });

    expect(result.status).toBe(0);
    const directory = path.join(xdgHome, "coden", "sessions", workspaceHash(workspace));
    await expect(readdir(directory)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("exits cleanly on empty stdin", async () => {
    const workspace = await makeWorkspace();
    const xdgHome = await mkdtemp(path.join(os.tmpdir(), "coden-xdg-"));
    const result = spawnSync("bun", [cli], {
      cwd: workspace,
      encoding: "utf8",
      input: "",
      env: { ...baseEnv, CODEN_OPENAI_API_KEY: "test-key", XDG_DATA_HOME: xdgHome },
      timeout: 30_000,
    });

    expect(result.status).toBe(0);
  });

  it("shows a resume banner when resuming a session", async () => {
    const workspace = await makeWorkspace();
    const xdgHome = await mkdtemp(path.join(os.tmpdir(), "coden-xdg-"));
    await makeSession(workspace, xdgHome, "my-session");
    const result = spawnSync("bun", [cli, "--resume", "my-session"], {
      cwd: workspace,
      encoding: "utf8",
      input: "/quit\n",
      env: { ...baseEnv, CODEN_OPENAI_API_KEY: "test-key", XDG_DATA_HOME: xdgHome },
      timeout: 30_000,
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain(`版本：${CODEN_VERSION}`);
    expect(result.stdout).toContain(`工作区哈希：${workspaceHash(workspace)}`);
    expect(result.stdout).toContain("已恢复会话 my-session");
    expect(result.stdout).toContain("> hello world");
  });
});
