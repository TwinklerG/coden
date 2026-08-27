import Ajv from "ajv";
import type { ToolDefinition } from "../core/types.js";
import { CodeNError } from "../core/types.js";

const ajv = new Ajv({ allErrors: true, strict: false, useDefaults: true });
export class ToolRegistry {
  #tools = new Map<string, ToolDefinition>();
  constructor(tools: ToolDefinition[] = []) {
    for (const tool of tools) this.register(tool);
  }
  register(tool: ToolDefinition): void {
    if (!/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(tool.name))
      throw new CodeNError("plugin", "tool.invalid_name", `Invalid tool name: ${tool.name}`);
    if (this.#tools.has(tool.name))
      throw new CodeNError("plugin", "tool.duplicate", `Duplicate tool: ${tool.name}`);
    try {
      ajv.compile(tool.inputSchema);
    } catch (cause) {
      throw new CodeNError(
        "plugin",
        "tool.invalid_schema",
        `Invalid schema for ${tool.name}`,
        false,
        undefined,
        { cause },
      );
    }
    this.#tools.set(tool.name, tool);
  }
  get(name: string): ToolDefinition | undefined {
    return this.#tools.get(name);
  }
  list(): ToolDefinition[] {
    return [...this.#tools.values()];
  }
  replaceWith(candidate: ToolRegistry): void {
    this.#tools = new Map(candidate.#tools);
  }
  validate(name: string, input: unknown): { valid: boolean; errors?: string } {
    const tool = this.get(name);
    if (!tool) return { valid: false, errors: `Unknown tool: ${name}` };
    const validate = ajv.compile(tool.inputSchema);
    const valid = validate(input);
    return valid ? { valid: true } : { valid: false, errors: ajv.errorsText(validate.errors) };
  }
}
