import Ajv from "ajv";
import { CodeNError, type ToolDefinition } from "../core/types.js";

const ajv = new Ajv({ allErrors: true, strict: false, useDefaults: true });

export type ToolSource =
  | { kind: "builtin" }
  | { kind: "local"; path?: string }
  | { kind: "npm"; pluginName: string; pluginVersion: string; path?: string };

export interface RegisteredTool {
  definition: ToolDefinition;
  source: ToolSource;
}

export class ToolRegistry {
  #tools = new Map<string, RegisteredTool>();

  constructor(tools: ToolDefinition[] = []) {
    for (const tool of tools) this.register(tool, { kind: "builtin" });
  }

  register(tool: ToolDefinition, source: ToolSource = { kind: "local" }): void {
    if (!/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(tool.name))
      throw new CodeNError("plugin", "tool.invalid_name", `Invalid tool name: ${tool.name}`);
    const existing = this.#tools.get(tool.name);
    if (existing)
      throw new CodeNError(
        "plugin",
        "tool.duplicate",
        `Duplicate tool: ${tool.name} from ${formatSource(existing.source)} and ${formatSource(source)}`,
      );
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
    this.#tools.set(tool.name, { definition: tool, source });
  }

  get(name: string): ToolDefinition | undefined {
    return this.#tools.get(name)?.definition;
  }

  list(): ToolDefinition[] {
    return [...this.#tools.values()].map((entry) => entry.definition);
  }

  source(name: string): ToolSource | undefined {
    return this.#tools.get(name)?.source;
  }

  entries(): RegisteredTool[] {
    return [...this.#tools.values()].map((entry) => ({
      definition: entry.definition,
      source: entry.source,
    }));
  }

  clone(): ToolRegistry {
    const registry = new ToolRegistry();
    registry.#tools = new Map(this.#tools);
    return registry;
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

function formatSource(source: ToolSource): string {
  switch (source.kind) {
    case "builtin":
      return "builtin";
    case "local":
      return source.path ? `local:${source.path}` : "local";
    case "npm":
      return source.path
        ? `${source.pluginName}@${source.pluginVersion}:${source.path}`
        : `${source.pluginName}@${source.pluginVersion}`;
  }
}
