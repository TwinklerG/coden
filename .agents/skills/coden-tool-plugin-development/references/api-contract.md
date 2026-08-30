# CodeN Plugin API v1 Contract

Use this reference for every local or npm tool plugin. In the CodeN repository, compare it with `src/plugin/index.ts`. In an external plugin project, prefer the declarations installed at `@twinklerg/coden/plugin`; those declarations represent the target CodeN version.

## Public interfaces

```ts
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
  structuredFilePath?: {
    requested: string;
    path: string;
    scope: "inside" | "outside";
  };
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
```

## Invariants

- Match each tool name against `^[a-zA-Z][a-zA-Z0-9_-]{0,63}$`. A name cannot collide with a built-in or a tool registered by an earlier plugin.
- Set `risk` from actual effects: `read` observes state, `modify` changes expected state, and `dangerous` can cause unusually destructive or irreversible effects. Risk controls confirmation; it does not sandbox the plugin.
- Supply valid JSON Schema. Prefer object schemas with explicit `required`, constrained properties, and `additionalProperties: false`.
- Treat `execute` input as untrusted `unknown` even when CodeN validates it against the schema. Narrow it before use.
- Return `{ content, isError: true }` for expected invalid input or operational failure. Let unexpected programming defects throw.
- Observe `context.signal` during long-running work and pass it to Node.js or Web APIs that accept `AbortSignal`.
- Interpret `context.workspace` as the active workspace; resolve deliberate workspace-relative paths from it.
- Never use `structuredFilePath` in third-party plugins. It is an internal execution field despite being present in the runtime context and may change without becoming a public plugin capability.
- Import public plugin types and constants only from `@twinklerg/coden/plugin`. Do not import CodeN `src/` paths or the unexported `@twinklerg/coden` package root.
- Avoid top-level filesystem, network, subprocess, environment mutation, or secret handling. CodeN imports plugin modules with the user's full process permissions.
