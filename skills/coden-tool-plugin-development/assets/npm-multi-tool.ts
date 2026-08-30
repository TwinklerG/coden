import type { CodeNPlugin, ToolDefinition } from "@twinklerg/coden/plugin";

type KeyInput = { key: string };
type WriteInput = { key: string; value: string };

const values = new Map<string, string>();

function parseKey(input: unknown): KeyInput | undefined {
  if (!input || typeof input !== "object") return undefined;
  const key = (input as { key?: unknown }).key;
  return typeof key === "string" && key.length > 0 ? { key } : undefined;
}

function parseWrite(input: unknown): WriteInput | undefined {
  const parsed = parseKey(input);
  const value =
    input && typeof input === "object" ? (input as { value?: unknown }).value : undefined;
  return parsed && typeof value === "string" ? { key: parsed.key, value } : undefined;
}

const readTool: ToolDefinition = {
  name: "example_read",
  description: "Read a value from the plugin's in-memory example store",
  risk: "read",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["key"],
    properties: { key: { type: "string", minLength: 1 } },
  },
  async execute(input, context) {
    if (context.signal.aborted) return { content: "Operation cancelled", isError: true };
    const parsed = parseKey(input);
    if (!parsed) return { content: "Expected an object with a key string", isError: true };
    const value = values.get(parsed.key);
    return value === undefined
      ? { content: `No value found for ${parsed.key}`, isError: true }
      : { content: value };
  },
};

const writeTool: ToolDefinition = {
  name: "example_write",
  description: "Write a value to the plugin's in-memory example store",
  risk: "modify",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["key", "value"],
    properties: {
      key: { type: "string", minLength: 1 },
      value: { type: "string" },
    },
  },
  async execute(input, context) {
    if (context.signal.aborted) return { content: "Operation cancelled", isError: true };
    const parsed = parseWrite(input);
    if (!parsed) return { content: "Expected key and value strings", isError: true };
    values.set(parsed.key, parsed.value);
    return { content: `Stored ${parsed.key}` };
  },
};

const plugin: CodeNPlugin = {
  apiVersion: 1,
  name: "@scope/coden-plugin-example",
  tools: [readTool, writeTool],
};

export default plugin;
