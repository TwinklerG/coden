import { spawn } from "node:child_process";
import type { ConfiguredCommandHook, HookInput, HookInvocationContext } from "./types.js";

const INPUT_LIMIT = 1024 * 1024;
const OUTPUT_LIMIT = 10 * 1024;
export interface CommandHookRunResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
  cancelled: boolean;
  outputExceeded: boolean;
  inputExceeded: boolean;
  durationMs: number;
}
export type CommandHookRunner = (
  hook: ConfiguredCommandHook,
  input: HookInput,
  context: HookInvocationContext,
) => Promise<CommandHookRunResult>;
export const runCommandHook: CommandHookRunner = async (hook, input, context) => {
  const start = Date.now();
  const empty = (extra: Partial<CommandHookRunResult> = {}): CommandHookRunResult => ({
    stdout: "",
    stderr: "",
    exitCode: null,
    signal: null,
    timedOut: false,
    cancelled: false,
    outputExceeded: false,
    inputExceeded: false,
    durationMs: Date.now() - start,
    ...extra,
  });
  let json: string;
  try {
    json = JSON.stringify(input);
  } catch {
    return empty({ inputExceeded: true });
  }
  if (Buffer.byteLength(json) > INPUT_LIMIT) return empty({ inputExceeded: true });
  if (context.signal?.aborted) return empty({ cancelled: true });
  return await new Promise((resolve) => {
    const windows = process.platform === "win32";
    const child = spawn(
      windows ? (process.env.ComSpec ?? "cmd.exe") : "/bin/sh",
      windows ? ["/d", "/s", "/c", hook.command] : ["-c", hook.command],
      {
        cwd: context.cwd,
        detached: !windows,
        stdio: ["pipe", "pipe", "pipe"],
        env: {
          ...process.env,
          CODEN_PROJECT_DIR: context.cwd,
          CODEN_SESSION_ID: context.sessionId,
          CODEN_HOOK_EVENT: input.hookEventName,
        },
      },
    );
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let timedOut = false;
    let cancelled = false;
    let outputExceeded = false;
    let settled = false;
    let terminating = false;
    let killTimer: NodeJS.Timeout | undefined;
    const kill = () => {
      if (terminating || !child.pid) return;
      terminating = true;
      try {
        process.kill(windows ? child.pid : -child.pid, "SIGTERM");
      } catch {}
      if (!windows) {
        killTimer = setTimeout(() => {
          try {
            if (child.pid) process.kill(-child.pid, "SIGKILL");
          } catch {}
        }, 500);
        killTimer.unref();
      }
    };
    const collect = (which: "stdout" | "stderr", chunk: Buffer) => {
      const bytes = which === "stdout" ? stdoutBytes : stderrBytes;
      const remaining = Math.max(0, OUTPUT_LIMIT - bytes);
      const retained = chunk.subarray(0, remaining);
      if (which === "stdout") {
        if (retained.length) stdoutChunks.push(retained);
        stdoutBytes += retained.length;
      } else {
        if (retained.length) stderrChunks.push(retained);
        stderrBytes += retained.length;
      }
      if (chunk.byteLength > remaining) {
        outputExceeded = true;
        kill();
      }
    };
    child.stdout.on("data", (chunk: Buffer) => collect("stdout", chunk));
    child.stderr.on("data", (chunk: Buffer) => collect("stderr", chunk));
    const timeout = setTimeout(() => {
      timedOut = true;
      kill();
    }, hook.timeoutMs);
    const abort = () => {
      cancelled = true;
      kill();
    };
    context.signal?.addEventListener("abort", abort, { once: true });
    const finish = (exitCode: number | null, signal: NodeJS.Signals | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (killTimer) clearTimeout(killTimer);
      context.signal?.removeEventListener("abort", abort);
      resolve({
        stdout: Buffer.concat(stdoutChunks, stdoutBytes).toString("utf8"),
        stderr: Buffer.concat(stderrChunks, stderrBytes).toString("utf8"),
        exitCode,
        signal,
        timedOut,
        cancelled,
        outputExceeded,
        inputExceeded: false,
        durationMs: Date.now() - start,
      });
    };
    child.on("error", () => finish(null, null));
    child.on("close", finish);
    child.stdin.on("error", () => {});
    child.stdin.end(`${json}\n`);
  });
};
