import { truncateOutput } from "../context/truncate.js";
import { CodeNError } from "../core/types.js";
import { runProcess, type ProcessRunResult, type ProcessRunner } from "../process/runner.js";
import type { PackageInstallRequest, PackageManager } from "./package-manager.js";

function boundedInstallMessage(result: ProcessRunResult): string {
  const status = result.timedOut
    ? "bun install timed out"
    : result.cancelled
      ? "bun install cancelled"
      : `bun install exited with code ${result.exitCode ?? "null"}${result.signal ? ` (signal ${result.signal})` : ""}`;
  return truncateOutput(
    [status, result.stderr ? `stderr:\n${result.stderr}` : "stderr:\n<empty>"].join("\n"),
    4_000,
  );
}

export class BunPackageManager implements PackageManager {
  constructor(private readonly runner: ProcessRunner = runProcess) {}

  async install(request: PackageInstallRequest): Promise<void> {
    const args = ["install", "--registry", "https://registry.npmjs.org"];
    if (request.frozenLockfile) args.push("--frozen-lockfile");
    if (!request.allowScripts) args.push("--ignore-scripts");
    const result = await this.runner("bun", args, {
      cwd: request.cwd,
      env: process.env,
      ...(request.signal ? { signal: request.signal } : {}),
      timeoutMs: 120_000,
      maxOutputChars: 30_000,
    });
    if (!result.ok)
      throw new CodeNError("plugin", "plugin.install_failed", boundedInstallMessage(result));
  }
}
