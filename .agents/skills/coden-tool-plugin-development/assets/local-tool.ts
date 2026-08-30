import type { ToolDefinition } from "@twinklerg/coden/plugin";

type LineCountInput = { text: string };

function parseInput(input: unknown): LineCountInput | undefined {
  if (!input || typeof input !== "object") return undefined;
  const text = (input as { text?: unknown }).text;
  return typeof text === "string" ? { text } : undefined;
}

const tool: ToolDefinition = {
  name: "line_count",
  description: "Count lines in supplied text",
  risk: "read",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["text"],
    properties: { text: { type: "string" } },
  },
  async execute(input, context) {
    if (context.signal.aborted) return { content: "Operation cancelled", isError: true };
    const parsed = parseInput(input);
    if (!parsed)
      return { content: "Expected an object with a text string", isError: true };
    return { content: String(parsed.text.split("\n").length) };
  },
};

export default tool;
