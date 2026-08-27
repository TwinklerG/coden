import { constants } from "node:fs";
import { mkdir, open } from "node:fs/promises";
import path from "node:path";
import type { ToolDefinition } from "../../core/types.js";
import { resolveWorkspacePath } from "../../permissions/workspace.js";

export const writeTool: ToolDefinition = {
  name: "write",
  description: "Create or overwrite a UTF-8 file inside the workspace.",
  risk: "modify",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["path", "content"],
    properties: { path: { type: "string" }, content: { type: "string" } },
  },
  async execute(input, context) {
    const { path: requested, content } = input as { path: string; content: string };
    let target = await resolveWorkspacePath(context.workspace, requested);
    await mkdir(path.dirname(target), { recursive: true });
    target = await resolveWorkspacePath(context.workspace, requested);
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
    return { content: `Wrote ${Buffer.byteLength(content)} bytes to ${requested}` };
  },
};
