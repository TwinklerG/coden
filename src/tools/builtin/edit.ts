import { constants } from "node:fs";
import { open } from "node:fs/promises";
import type { ToolDefinition } from "../../core/types.js";
import { I18n } from "../../i18n/i18n.js";
import { resolveWorkspacePath, revalidateStructuredFilePath } from "../../permissions/workspace.js";

export function createEditTool(i18n: I18n = new I18n("en")): ToolDefinition {
  return {
    name: "edit",
    description: i18n.messages.tools.edit,
    risk: "modify",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["path", "oldText", "newText"],
      properties: {
        path: { type: "string" },
        oldText: { type: "string", minLength: 1 },
        newText: { type: "string" },
      },
    },
    async execute(input, context) {
      const {
        path: requested,
        oldText,
        newText,
      } = input as { path: string; oldText: string; newText: string };
      const target = context.structuredFilePath
        ? await revalidateStructuredFilePath(
            context.workspace,
            context.structuredFilePath,
            requested,
          )
        : await resolveWorkspacePath(context.workspace, requested);
      const handle = await open(target, constants.O_RDWR | constants.O_NOFOLLOW);
      try {
        const content = await handle.readFile("utf8");
        const first = content.indexOf(oldText);
        if (first < 0) return { content: i18n.messages.tools.noMatch, isError: true };
        if (content.indexOf(oldText, first + 1) >= 0)
          return { content: i18n.messages.tools.multipleMatches, isError: true };
        const updated = `${content.slice(0, first)}${newText}${content.slice(first + oldText.length)}`;
        await handle.truncate(0);
        await handle.write(updated, 0, "utf8");
      } finally {
        await handle.close();
      }
      return { content: i18n.messages.tools.edited(requested) };
    },
  };
}

export const editTool = createEditTool();
