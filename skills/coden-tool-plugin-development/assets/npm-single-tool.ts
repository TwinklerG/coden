import type { ToolDefinition } from "@twinklerg/coden/plugin";

type EchoInput = { text: string };

function parseEchoInput(input: unknown): EchoInput | undefined {
  if (!input || typeof input !== "object") return undefined;
  const text = (input as { text?: unknown }).text;
  return typeof text === "string" ? { text } : undefined;
}

const tool: ToolDefinition = {
  name: "example_echo",
  description: "Echo supplied text",
  risk: "read",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["text"],
    properties: { text: { type: "string" } },
  },
  async execute(input, context) {
    if (context.signal.aborted) return { content: "Operation cancelled", isError: true };
    const parsed = parseEchoInput(input);
    if (!parsed)
      return { content: "Expected an object with a text string", isError: true };
    return { content: parsed.text };
  },
};

export default tool;
