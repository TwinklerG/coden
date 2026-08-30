import { truncateOutput } from "../../context/truncate.js";
import type { ToolDefinition } from "../../core/types.js";
import { I18n } from "../../i18n/i18n.js";
import { runProcess } from "../../process/runner.js";

export function createBashTool(i18n: I18n = new I18n("en")): ToolDefinition {
  return {
    name: "bash",
    description: i18n.messages.tools.bash,
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
      if (
        result.exitCode === null &&
        !result.timedOut &&
        !result.cancelled &&
        result.signal === null
      )
        return {
          content: `bash.spawn_error: ${result.stderr || i18n.messages.tools.unknownError}`,
          isError: true,
        };
      const status = result.timedOut
        ? i18n.messages.tools.timeout(timeout)
        : result.cancelled
          ? i18n.messages.tools.cancelled
          : i18n.messages.tools.exitCode(result.exitCode, result.signal ?? undefined);
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
}

export const bashTool = createBashTool();
