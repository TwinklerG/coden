export type JsonSchema = Record<string, unknown>;
export type ToolRisk = "read" | "modify" | "dangerous";

export interface Usage {
  inputTokens: number;
  outputTokens: number;
}

export interface ToolCall {
  callId: string;
  name: string;
  input: unknown;
}

export interface SystemMessage {
  role: "system";
  content: string;
}
export interface UserMessage {
  role: "user";
  content: string;
}
export interface AssistantMessage {
  role: "assistant";
  content: string;
  toolCalls: ToolCall[];
  model?: string;
  usage?: Usage;
}
export interface ToolResultMessage {
  role: "tool";
  callId: string;
  name: string;
  content: string;
  isError: boolean;
}
export type AgentMessage = SystemMessage | UserMessage | AssistantMessage | ToolResultMessage;

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

export interface ModelRequest {
  model: string;
  messages: AgentMessage[];
  tools: ToolDefinition[];
  maxOutputTokens: number;
  signal?: AbortSignal;
}

export type ModelEvent =
  | { type: "text_delta"; text: string }
  | { type: "tool_call_start"; index: number; callId: string; name: string }
  | { type: "tool_call_delta"; index: number; argumentsDelta: string }
  | { type: "tool_call_end"; index: number }
  | { type: "usage"; usage: Usage }
  | { type: "done" };

export interface ModelProvider {
  stream(request: ModelRequest): AsyncIterable<ModelEvent>;
}

export type ErrorCategory =
  | "provider"
  | "context"
  | "tool"
  | "permission"
  | "plugin"
  | "session"
  | "runtime";
export class CodeNError extends Error {
  constructor(
    readonly category: ErrorCategory,
    readonly code: string,
    message: string,
    readonly retryable = false,
    readonly details?: Record<string, unknown>,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "CodeNError";
  }
}
