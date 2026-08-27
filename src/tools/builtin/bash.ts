import { spawn } from "node:child_process";
import { truncateOutput } from "../../context/truncate.js";
import type { ToolDefinition, ToolResult } from "../../core/types.js";

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

export const bashTool: ToolDefinition = {
  name: "bash",
  description: "Run a bash command in the workspace with timeout and bounded output.",
  risk: "modify",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["command"],
    properties: {
      command: { type: "string", minLength: 1 },
      timeout: { type: "integer", minimum: 100, maximum: 60000, default: 30000 },
      maxOutput: { type: "integer", minimum: 1000, maximum: 100000, default: 30000 },
    },
  },
  execute(input, context) {
    const {
      command,
      timeout = 30000,
      maxOutput = 30000,
    } = input as { command: string; timeout?: number; maxOutput?: number };
    return new Promise<ToolResult>((resolve) => {
      const grouped = process.platform !== "win32";
      const child = spawn("bash", ["-lc", command], {
        cwd: context.workspace,
        env: process.env,
        stdio: ["ignore", "pipe", "pipe"],
        detached: grouped,
      });
      const stdout = new BoundedCollector(maxOutput);
      const stderr = new BoundedCollector(maxOutput);
      let timedOut = false;
      let cancelled = false;
      let escalation: NodeJS.Timeout | undefined;
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => {
        stdout.add(chunk);
      });
      child.stderr.on("data", (chunk: string) => {
        stderr.add(chunk);
      });
      const terminate = (signal: NodeJS.Signals) => {
        if (grouped && child.pid) {
          try {
            process.kill(-child.pid, signal);
            return;
          } catch {
            // The group may already have exited; fall back to the direct child.
          }
        }
        child.kill(signal);
      };
      const scheduleKill = () => {
        if (escalation) return;
        escalation = setTimeout(() => terminate("SIGKILL"), 500);
        escalation.unref();
      };
      const cancel = () => {
        cancelled = true;
        terminate("SIGTERM");
        scheduleKill();
      };
      if (context.signal.aborted) cancel();
      else context.signal.addEventListener("abort", cancel, { once: true });
      const timer = setTimeout(() => {
        timedOut = true;
        terminate("SIGTERM");
        scheduleKill();
      }, timeout);
      child.on("error", (error) => {
        clearTimeout(timer);
        if (escalation) clearTimeout(escalation);
        context.signal.removeEventListener("abort", cancel);
        resolve({ content: `bash.spawn_error: ${error.message}`, isError: true });
      });
      child.on("close", (code, signal) => {
        clearTimeout(timer);
        if ((timedOut || cancelled) && grouped) terminate("SIGKILL");
        if (escalation) clearTimeout(escalation);
        context.signal.removeEventListener("abort", cancel);
        const stdoutText = stdout.value();
        const stderrText = stderr.value();
        const combined = [
          stdoutText && `stdout:\n${stdoutText}`,
          stderrText && `stderr:\n${stderrText}`,
        ]
          .filter(Boolean)
          .join("\n");
        const status = timedOut
          ? `Timed out after ${timeout}ms`
          : cancelled
            ? "Cancelled"
            : `Exit code: ${code ?? "null"}${signal ? ` (signal ${signal})` : ""}`;
        resolve({
          content: truncateOutput(`${status}\n${combined}`.trimEnd(), maxOutput),
          isError: timedOut || cancelled || code !== 0,
          metadata: { exitCode: code, signal, timedOut, cancelled },
        });
      });
    });
  },
};
