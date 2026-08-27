import { constants } from "node:fs";
import { open } from "node:fs/promises";
import type { ToolDefinition } from "../../core/types.js";
import { resolveWorkspacePath } from "../../permissions/workspace.js";

class BoundedText {
  private text = "";
  private omitted = 0;
  constructor(private readonly limit: number) {}
  add(value: string): void {
    const available = Math.max(0, this.limit - this.text.length);
    this.text += value.slice(0, available);
    this.omitted += Math.max(0, value.length - available);
  }
  value(): string {
    return this.omitted > 0
      ? `${this.text}\n... [${this.omitted} selected characters omitted]`
      : this.text;
  }
}

export const readTool: ToolDefinition = {
  name: "read",
  description: "Read a UTF-8 text file by 1-based line offset and limit.",
  risk: "read",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["path"],
    properties: {
      path: { type: "string" },
      offset: { type: "integer", minimum: 1, default: 1 },
      limit: { type: "integer", minimum: 1, maximum: 2000, default: 500 },
    },
  },
  async execute(input, context) {
    const {
      path,
      offset = 1,
      limit = 500,
    } = input as { path: string; offset?: number; limit?: number };
    const target = await resolveWorkspacePath(context.workspace, path);
    const output = new BoundedText(50_000);
    let lineNumber = 1;
    let selectedLines = 0;
    let selectedStarted = false;
    const selected = () => lineNumber >= offset && lineNumber < offset + limit;
    const consume = (segment: string) => {
      if (!selected()) return;
      if (!selectedStarted) {
        if (selectedLines > 0) output.add("\n");
        selectedLines++;
        selectedStarted = true;
      }
      output.add(segment);
    };
    const handle = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const stream = handle.createReadStream({
        encoding: "utf8",
        autoClose: false,
        highWaterMark: 64 * 1024,
        signal: context.signal,
      });
      for await (const raw of stream) {
        const chunk = String(raw);
        let start = 0;
        for (
          let newline = chunk.indexOf("\n", start);
          newline >= 0;
          newline = chunk.indexOf("\n", start)
        ) {
          consume(chunk.slice(start, newline));
          lineNumber++;
          selectedStarted = false;
          start = newline + 1;
        }
        consume(chunk.slice(start));
      }
    } finally {
      await handle.close();
    }
    consume("");
    const totalLines = lineNumber;
    const omittedLines = Math.max(0, totalLines - (offset - 1 + selectedLines));
    return {
      content: output.value() + (omittedLines > 0 ? `\n... [${omittedLines} lines omitted]` : ""),
      metadata: { totalLines, offset, limit },
    };
  },
};
