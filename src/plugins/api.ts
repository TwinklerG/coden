import { CodeNError } from "../core/types.js";
import {
  CODEN_PLUGIN_API_VERSION,
  type CodeNPlugin,
  type ToolDefinition,
} from "../plugin/index.js";

export type {
  CodeNPlugin,
  JsonSchema,
  PluginModuleExport,
  ToolContext,
  ToolDefinition,
  ToolResult,
  ToolRisk,
} from "../plugin/index.js";
export { CODEN_PLUGIN_API_VERSION } from "../plugin/index.js";

export function normalizePluginExport(value: unknown, packageName: string): ToolDefinition[] {
  if (isToolDefinitionShape(value)) return [value];
  if (!value || typeof value !== "object")
    throw new CodeNError(
      "plugin",
      "plugin.export_invalid",
      "plugin.export_invalid: default export must be a tool or CodeNPlugin",
    );

  const plugin = value as Partial<CodeNPlugin> & { apiVersion?: unknown; tools?: unknown };
  if (plugin.apiVersion !== CODEN_PLUGIN_API_VERSION)
    throw new CodeNError(
      "plugin",
      "plugin.api_unsupported",
      `plugin.api_unsupported: ${String(plugin.apiVersion)}`,
    );
  if (plugin.name !== packageName)
    throw new CodeNError(
      "plugin",
      "plugin.name_mismatch",
      `plugin.name_mismatch: expected ${packageName}, received ${String(plugin.name)}`,
    );
  if (!Array.isArray(plugin.tools) || plugin.tools.length === 0)
    throw new CodeNError(
      "plugin",
      "plugin.export_invalid",
      "plugin.export_invalid: tools must be a non-empty array",
    );
  if (!plugin.tools.every(isToolDefinitionShape))
    throw new CodeNError(
      "plugin",
      "plugin.export_invalid",
      "plugin.export_invalid: every tool must match ToolDefinition",
    );
  return plugin.tools;
}

function isToolDefinitionShape(value: unknown): value is ToolDefinition {
  if (!value || typeof value !== "object") return false;
  const tool = value as Partial<ToolDefinition>;
  return (
    typeof tool.name === "string" &&
    typeof tool.description === "string" &&
    (tool.risk === "read" || tool.risk === "modify" || tool.risk === "dangerous") &&
    !!tool.inputSchema &&
    typeof tool.execute === "function"
  );
}
