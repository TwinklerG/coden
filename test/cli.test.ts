import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { mkdtemp, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
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
};

describe("CLI exit codes", () => {
  it("exits 2 for configuration errors (missing API key)", () => {
    const result = spawnSync("bun", [cli, "-p", "--provider", "openai", "task"], {
      encoding: "utf8",
      env: baseEnv,
      timeout: 30_000,
    });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("CODEN_OPENAI_API_KEY");
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
    expect(result.stdout).toContain(`Version: ${CODEN_VERSION}`);
    expect(result.stdout).toContain(`Workspace hash: ${workspaceHash(workspace)}`);
    expect(result.stdout).toContain("Resumed session my-session");
    expect(result.stdout).toContain("> hello world");
  });
});
