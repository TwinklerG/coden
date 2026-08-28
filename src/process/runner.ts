import { spawn } from "node:child_process";

class BoundedCollector {
  private readonly headLimit: number;
  private readonly tailLimit: number;
  private head = "";
  private tail = "";
  private total = 0;

  constructor(maxChars: number) {
    this.headLimit = Math.ceil(maxChars * 0.6);
    this.tailLimit = Math.floor(maxChars * 0.4);
  }

  add(chunk: string): void {
    this.total += chunk.length;
    const needed = Math.max(0, this.headLimit - this.head.length);
    this.head += chunk.slice(0, needed);
    const remainder = chunk.slice(needed);
    if (remainder) this.tail = `${this.tail}${remainder}`.slice(-this.tailLimit);
  }

  value(): string {
    const omitted = this.total - this.head.length - this.tail.length;
    return omitted > 0
      ? `${this.head}\n... [${omitted} characters omitted while capturing] ...\n${this.tail}`
      : `${this.head}${this.tail}`;
  }
}

export interface ProcessRunOptions {
  cwd: string;
  env?: NodeJS.ProcessEnv;
  signal?: AbortSignal;
  timeoutMs: number;
  maxOutputChars: number;
}

export interface ProcessRunResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
  cancelled: boolean;
}

export type ProcessRunner = (
  command: string,
  args: string[],
  options: ProcessRunOptions,
) => Promise<ProcessRunResult>;

export const runProcess: ProcessRunner = (command, args, options) =>
  new Promise((resolve) => {
    const grouped = process.platform !== "win32";
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ["ignore", "pipe", "pipe"],
      detached: grouped,
    });
    const stdout = new BoundedCollector(options.maxOutputChars);
    const stderr = new BoundedCollector(options.maxOutputChars);
    let timedOut = false;
    let cancelled = false;
    let settled = false;
    let escalation: NodeJS.Timeout | undefined;
    let timer: NodeJS.Timeout;

    const terminate = (signal: NodeJS.Signals) => {
      if (grouped && child.pid) {
        try {
          process.kill(-child.pid, signal);
          return;
        } catch {
          // The process group may already have exited; kill the child directly.
        }
      }
      child.kill(signal);
    };
    const finish = (exitCode: number | null, signal: NodeJS.Signals | null) => {
      if (settled) return;
      if ((timedOut || cancelled) && grouped && child.pid) {
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch {
          // The leader or group may already be gone; resolving below is still safe.
        }
      }
      settled = true;
      clearTimeout(timer);
      if (escalation) clearTimeout(escalation);
      options.signal?.removeEventListener("abort", cancel);
      resolve({
        ok: !timedOut && !cancelled && exitCode === 0,
        stdout: stdout.value(),
        stderr: stderr.value(),
        exitCode,
        signal,
        timedOut,
        cancelled,
      });
    };
    const escalate = () => {
      if (escalation) return;
      escalation = setTimeout(() => terminate("SIGKILL"), 500);
      escalation.unref();
    };
    const cancel = () => {
      if (cancelled) return;
      cancelled = true;
      terminate("SIGTERM");
      escalate();
    };

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => stdout.add(chunk));
    child.stderr.on("data", (chunk: string) => stderr.add(chunk));
    child.once("error", (error) => {
      stderr.add(error.message);
      finish(null, null);
    });
    child.once("close", finish);
    if (options.signal?.aborted) cancel();
    else options.signal?.addEventListener("abort", cancel, { once: true });
    timer = setTimeout(() => {
      timedOut = true;
      terminate("SIGTERM");
      escalate();
    }, options.timeoutMs);
  });
