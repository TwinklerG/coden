import { truncateOutput } from "../../context/truncate.js";
import type { ToolDefinition, ToolResult } from "../../core/types.js";
import { runProcess } from "../../process/runner.js";

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
  async execute(input, context) {
    const {
      command,
      timeout = 30000,
      maxOutput = 30000,
    } = input as { command: string; timeout?: number; maxOutput?: number };
    const result = await runProcess("bash", ["-lc", command], {
      cwd: context.workspace,
      env: process.env,
      signal: context.signal,
      timeoutMs: timeout,
      maxOutputChars: maxOutput,
    });
    const combined = [
      result.stdout && `stdout:\n${result.stdout}`,
      result.stderr && `stderr:\n${result.stderr}`,
    ]
      .filter(Boolean)
      .join("\n");
    if (result.exitCode === null && !result.timedOut && !result.cancelled && result.signal === null)
      return { content: `bash.spawn_error: ${result.stderr || "unknown error"}`, isError: true };
    const status = result.timedOut
      ? `Timed out after ${timeout}ms`
      : result.cancelled
        ? "Cancelled"
        : `Exit code: ${result.exitCode ?? "null"}${result.signal ? ` (signal ${result.signal})` : ""}`;
    return {
      content: truncateOutput(`${status}\n${combined}`.trimEnd(), maxOutput),
      isError: result.timedOut || result.cancelled || result.exitCode !== 0,
      metadata: {
        exitCode: result.exitCode,
        signal: result.signal,
        timedOut: result.timedOut,
        cancelled: result.cancelled,
      },
    };
  },
};
