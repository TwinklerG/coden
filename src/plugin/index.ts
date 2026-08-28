export type JsonSchema = Record<string, unknown>;

export type ToolRisk = "read" | "modify" | "dangerous";

export interface ToolResult {
  content: string;
  isError?: boolean;
  metadata?: Record<string, unknown>;
}

export interface ToolContext {
  workspace: string;
  signal: AbortSignal;
}

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: JsonSchema;
  risk: ToolRisk;
  execute(input: unknown, context: ToolContext): Promise<ToolResult>;
}

export const CODEN_PLUGIN_API_VERSION = 1 as const;

export interface CodeNPlugin {
  apiVersion: typeof CODEN_PLUGIN_API_VERSION;
  name: string;
  tools: ToolDefinition[];
}

export type PluginModuleExport = ToolDefinition | CodeNPlugin;
