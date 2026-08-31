import Anthropic from "@anthropic-ai/sdk";
import type {
  Tool as AnthropicTool,
  ContentBlockParam,
  MessageParam,
} from "@anthropic-ai/sdk/resources/messages";
import type { ProviderMessageState } from "../core/thinking.js";
import type { AgentMessage, ModelEvent, ModelProvider, ModelRequest } from "../core/types.js";
import { toAnthropicThinkingConfig } from "./thinking.js";

export interface AnthropicProviderOptions {
  apiKey: string;
  baseURL?: string;
}

type AnthropicThinkingBlock =
  | { type: "thinking"; thinking: string; signature: string }
  | { type: "redacted_thinking"; data: string };

interface AnthropicProviderStateData {
  thinkingBlocks: AnthropicThinkingBlock[];
}

export class AnthropicProvider implements ModelProvider {
  private readonly client: Anthropic;
  constructor(options: AnthropicProviderOptions) {
    this.client = new Anthropic({ ...options, maxRetries: 0 });
  }
  async *stream(request: ModelRequest): AsyncIterable<ModelEvent> {
    const { system, messages } = toAnthropicMessages(request.messages);
    const thinking = toAnthropicThinkingConfig(
      request.thinkingLevel ?? "default",
      request.maxOutputTokens,
    );
    const stream = this.client.messages.stream(
      {
        model: request.model,
        system,
        messages,
        max_tokens: request.maxOutputTokens,
        ...(thinking ? { thinking } : {}),
        ...(request.tools.length
          ? {
              tools: request.tools.map(
                (tool): AnthropicTool => ({
                  name: tool.name,
                  description: tool.description,
                  input_schema: tool.inputSchema as AnthropicTool.InputSchema,
                }),
              ),
            }
          : {}),
      },
      request.signal ? { signal: request.signal } : undefined,
    );
    const inputByIndex = new Map<number, string>();
    const thinkingBlocks = new Map<number, AnthropicThinkingBlock>();
    let finishReason: string | undefined;
    for await (const event of stream) {
      if (event.type === "content_block_start") {
        if (event.content_block.type === "thinking") {
          thinkingBlocks.set(event.index, {
            type: "thinking",
            thinking: event.content_block.thinking,
            signature: event.content_block.signature,
          });
        } else if (event.content_block.type === "redacted_thinking") {
          thinkingBlocks.set(event.index, {
            type: "redacted_thinking",
            data: event.content_block.data,
          });
        } else if (event.content_block.type === "tool_use") {
          inputByIndex.set(event.index, "");
          yield {
            type: "tool_call_start",
            index: event.index,
            callId: event.content_block.id,
            name: event.content_block.name,
          };
        }
      } else if (event.type === "content_block_delta") {
        if (event.delta.type === "thinking_delta") {
          const block = thinkingBlocks.get(event.index);
          if (block?.type === "thinking") block.thinking += event.delta.thinking;
          yield { type: "reasoning_delta", text: event.delta.thinking };
        } else if (event.delta.type === "signature_delta") {
          const block = thinkingBlocks.get(event.index);
          if (block?.type === "thinking") block.signature += event.delta.signature;
        } else if (event.delta.type === "text_delta") {
          yield { type: "text_delta", text: event.delta.text };
        } else if (event.delta.type === "input_json_delta") {
          inputByIndex.set(
            event.index,
            (inputByIndex.get(event.index) ?? "") + event.delta.partial_json,
          );
          yield {
            type: "tool_call_delta",
            index: event.index,
            argumentsDelta: event.delta.partial_json,
          };
        }
      } else if (event.type === "content_block_stop" && inputByIndex.has(event.index)) {
        yield { type: "tool_call_end", index: event.index };
      } else if (event.type === "message_start") {
        yield {
          type: "usage",
          usage: {
            inputTokens: event.message.usage.input_tokens,
            outputTokens: event.message.usage.output_tokens,
          },
        };
      } else if (event.type === "message_delta") {
        finishReason = event.delta.stop_reason ?? undefined;
        yield { type: "usage", usage: { inputTokens: 0, outputTokens: event.usage.output_tokens } };
      }
    }
    if (thinkingBlocks.size > 0) {
      yield {
        type: "provider_state",
        state: {
          provider: "anthropic",
          data: {
            thinkingBlocks: [...thinkingBlocks.entries()]
              .sort(([a], [b]) => a - b)
              .map(([, block]) => block),
          },
        },
      };
    }
    yield { type: "done", ...(finishReason ? { finishReason } : {}) };
  }
}

export function toAnthropicMessages(messages: AgentMessage[]): {
  system: string;
  messages: MessageParam[];
} {
  const system = messages
    .filter((message) => message.role === "system")
    .map((message) => message.content)
    .join("\n\n");
  const converted: MessageParam[] = [];
  for (const message of messages) {
    if (message.role === "system") continue;
    if (message.role === "user") converted.push({ role: "user", content: message.content });
    else if (message.role === "assistant") {
      const state = message.providerState ? decodeAnthropicState(message.providerState) : undefined;
      const content: ContentBlockParam[] = [
        ...(state
          ? state.thinkingBlocks.map(
              (block): ContentBlockParam =>
                block.type === "thinking"
                  ? { type: "thinking", thinking: block.thinking, signature: block.signature }
                  : { type: "redacted_thinking", data: block.data },
            )
          : []),
        ...(message.content ? [{ type: "text" as const, text: message.content }] : []),
        ...message.toolCalls.map(
          (call): ContentBlockParam => ({
            type: "tool_use",
            id: call.callId,
            name: call.name,
            input: call.input,
          }),
        ),
      ];
      converted.push({ role: "assistant", content });
    } else {
      const block = {
        type: "tool_result" as const,
        tool_use_id: message.callId,
        content: message.content,
        is_error: message.isError,
      };
      const previous = converted.at(-1);
      if (previous?.role === "user" && Array.isArray(previous.content)) {
        previous.content = [...previous.content, block];
      } else {
        converted.push({ role: "user", content: [block] });
      }
    }
  }
  return { system, messages: converted };
}

function decodeAnthropicState(state: ProviderMessageState): AnthropicProviderStateData | undefined {
  if (state.provider !== "anthropic") return undefined;
  const data = state.data as { thinkingBlocks?: unknown };
  if (!data || typeof data !== "object" || Array.isArray(data))
    throw new Error("invalid anthropic provider state");
  if (!Array.isArray(data.thinkingBlocks)) throw new Error("invalid anthropic thinking blocks");
  const thinkingBlocks = data.thinkingBlocks.map((block): AnthropicThinkingBlock => {
    if (!block || typeof block !== "object" || Array.isArray(block))
      throw new Error("invalid anthropic thinking block");
    const value = block as Record<string, unknown>;
    if (value.type === "thinking") {
      if (typeof value.thinking !== "string" || typeof value.signature !== "string")
        throw new Error("invalid anthropic thinking block");
      return { type: "thinking", thinking: value.thinking, signature: value.signature };
    }
    if (value.type === "redacted_thinking") {
      if (typeof value.data !== "string")
        throw new Error("invalid anthropic redacted thinking block");
      return { type: "redacted_thinking", data: value.data };
    }
    throw new Error("invalid anthropic thinking block");
  });
  return { thinkingBlocks };
}
