import { constants } from "node:fs";
import { mkdir, open } from "node:fs/promises";
import path from "node:path";
import type { ToolDefinition } from "../../core/types.js";
import { I18n } from "../../i18n/i18n.js";
import { resolveWorkspacePath, revalidateStructuredFilePath } from "../../permissions/workspace.js";

export function createWriteTool(i18n: I18n = new I18n("en")): ToolDefinition {
  return {
    name: "write",
    description: i18n.messages.tools.write,
    risk: "modify",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["path", "content"],
      properties: { path: { type: "string" }, content: { type: "string" } },
    },
    async execute(input, context) {
      const { path: requested, content } = input as { path: string; content: string };
      let target = context.structuredFilePath
        ? await revalidateStructuredFilePath(
            context.workspace,
            context.structuredFilePath,
            requested,
          )
        : await resolveWorkspacePath(context.workspace, requested);
      await mkdir(path.dirname(target), { recursive: true });
      target = context.structuredFilePath
        ? await revalidateStructuredFilePath(
            context.workspace,
            context.structuredFilePath,
            requested,
          )
        : await resolveWorkspacePath(context.workspace, requested);
      const handle = await open(
        target,
        constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | constants.O_NOFOLLOW,
        0o600,
      );
      try {
        await handle.writeFile(content, "utf8");
      } finally {
        await handle.close();
      }
      return { content: i18n.messages.tools.wrote(Buffer.byteLength(content), requested) };
    },
  };
}

export const writeTool = createWriteTool();
