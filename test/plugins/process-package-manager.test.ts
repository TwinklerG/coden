import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { BunPackageManager } from "../../src/plugins/bun-package-manager.js";
import { runProcess } from "../../src/process/runner.js";

it("captures bounded stdout and stderr", async () => {
  const result = await runProcess(
    process.execPath,
    ["-e", "process.stdout.write('a'.repeat(4000)); process.stderr.write('problem')"],
    { cwd: process.cwd(), timeoutMs: 5_000, maxOutputChars: 1_000 },
  );
  expect(result.exitCode).toBe(0);
  expect(result.stdout.length).toBeLessThanOrEqual(1_100);
  expect(result.stdout).toContain("omitted");
  expect(result.stderr).toBe("problem");
});

it("terminates a timed-out process", async () => {
  const result = await runProcess(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
    cwd: process.cwd(),
    timeoutMs: 100,
    maxOutputChars: 1_000,
  });
  expect(result.timedOut).toBe(true);
  expect(result.ok).toBe(false);
});

it.skipIf(process.platform === "win32")(
  "kills TERM-resistant descendants after the leader exits",
  async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "coden-runner-"));
    const marker = path.join(workspace, "marker");
    const result = await runProcess(
      "bash",
      [
        "-lc",
        "trap 'exit 0' TERM; sh -c 'trap \"\" TERM; sleep 0.25; echo survived > marker' </dev/null >/dev/null 2>&1 & while :; do sleep 1; done",
      ],
      { cwd: workspace, timeoutMs: 100, maxOutputChars: 1_000 },
    );
    expect(result.timedOut).toBe(true);
    expect(result.ok).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 400));
    await expect(readFile(marker, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  },
);

describe("BunPackageManager", () => {
  it("pins npmjs and disables scripts by default", async () => {
    const calls: Array<{ command: string; args: string[] }> = [];
    const manager = new BunPackageManager(async (command, args) => {
      calls.push({ command, args });
      return {
        ok: true,
        stdout: "",
        stderr: "",
        exitCode: 0,
        signal: null,
        timedOut: false,
        cancelled: false,
      };
    });

    await manager.install({ cwd: "/tmp/runtime", frozenLockfile: false, allowScripts: false });
    expect(calls).toEqual([
      {
        command: "bun",
        args: ["install", "--registry", "https://registry.npmjs.org", "--ignore-scripts"],
      },
    ]);
  });

  it("adds frozen lockfile without implicitly allowing scripts", async () => {
    const calls: string[][] = [];
    const manager = new BunPackageManager(async (_command, args) => {
      calls.push(args);
      return {
        ok: true,
        stdout: "",
        stderr: "",
        exitCode: 0,
        signal: null,
        timedOut: false,
        cancelled: false,
      };
    });
    await manager.install({ cwd: "/tmp/runtime", frozenLockfile: true, allowScripts: false });
    expect(calls[0]).toContain("--frozen-lockfile");
    expect(calls[0]).toContain("--ignore-scripts");
  });
});
