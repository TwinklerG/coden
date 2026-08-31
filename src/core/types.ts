import type { ToolDefinition } from "../plugin/index.js";
import type { ProviderMessageState, ThinkingLevel } from "./thinking.js";

export type {
  JsonSchema,
  ToolContext,
  ToolDefinition,
  ToolResult,
  ToolRisk,
} from "../plugin/index.js";
export type {
  JsonValue,
  ProviderMessageState,
  ThinkingLevel,
} from "./thinking.js";

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
  source?: "hook";
}
export interface AssistantMessage {
  role: "assistant";
  content: string;
  toolCalls: ToolCall[];
  model?: string;
  usage?: Usage;
  providerState?: ProviderMessageState;
}
export interface ToolResultMessage {
  role: "tool";
  callId: string;
  name: string;
  content: string;
  isError: boolean;
}
export type AgentMessage = SystemMessage | UserMessage | AssistantMessage | ToolResultMessage;

export interface ModelRequest {
  model: string;
  messages: AgentMessage[];
  tools: ToolDefinition[];
  maxOutputTokens: number;
  thinkingLevel?: ThinkingLevel;
  signal?: AbortSignal;
}

export type ModelEvent =
  | { type: "reasoning_delta"; text: string }
  | { type: "text_delta"; text: string }
  | { type: "tool_call_start"; index: number; callId: string; name: string }
  | { type: "tool_call_delta"; index: number; argumentsDelta: string }
  | { type: "tool_call_end"; index: number }
  | { type: "usage"; usage: Usage }
  | { type: "provider_state"; state: ProviderMessageState }
  | { type: "done"; finishReason?: string };

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
