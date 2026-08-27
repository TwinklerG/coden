import Anthropic from "@anthropic-ai/sdk";
import type { Tool as AnthropicTool, MessageParam } from "@anthropic-ai/sdk/resources/messages";
import type { AgentMessage, ModelEvent, ModelProvider, ModelRequest } from "../core/types.js";

export interface AnthropicProviderOptions {
  apiKey: string;
  baseURL?: string;
}
export class AnthropicProvider implements ModelProvider {
  private readonly client: Anthropic;
  constructor(options: AnthropicProviderOptions) {
    this.client = new Anthropic({ ...options, maxRetries: 0 });
  }
  async *stream(request: ModelRequest): AsyncIterable<ModelEvent> {
    const { system, messages } = toAnthropicMessages(request.messages);
    const stream = this.client.messages.stream(
      {
        model: request.model,
        system,
        messages,
        max_tokens: request.maxOutputTokens,
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
    for await (const event of stream) {
      if (event.type === "content_block_start" && event.content_block.type === "tool_use") {
        inputByIndex.set(event.index, "");
        yield {
          type: "tool_call_start",
          index: event.index,
          callId: event.content_block.id,
          name: event.content_block.name,
        };
      } else if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
        yield { type: "text_delta", text: event.delta.text };
      } else if (event.type === "content_block_delta" && event.delta.type === "input_json_delta") {
        inputByIndex.set(
          event.index,
          (inputByIndex.get(event.index) ?? "") + event.delta.partial_json,
        );
        yield {
          type: "tool_call_delta",
          index: event.index,
          argumentsDelta: event.delta.partial_json,
        };
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
        yield { type: "usage", usage: { inputTokens: 0, outputTokens: event.usage.output_tokens } };
      }
    }
    yield { type: "done" };
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
    else if (message.role === "assistant")
      converted.push({
        role: "assistant",
        content: [
          ...(message.content ? [{ type: "text" as const, text: message.content }] : []),
          ...message.toolCalls.map((call) => ({
            type: "tool_use" as const,
            id: call.callId,
            name: call.name,
            input: call.input,
          })),
        ],
      });
    else {
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
