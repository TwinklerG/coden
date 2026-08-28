import OpenAI from "openai";
import type { AgentMessage, ModelEvent, ModelProvider, ModelRequest } from "../core/types.js";

export interface OpenAIProviderOptions {
  apiKey: string;
  baseURL?: string;
}

type ReasoningDelta = {
  reasoning_content?: string | null;
};

export class OpenAICompatibleProvider implements ModelProvider {
  private readonly client: OpenAI;
  constructor(options: OpenAIProviderOptions) {
    this.client = new OpenAI({ ...options, maxRetries: 0 });
  }
  async *stream(request: ModelRequest): AsyncIterable<ModelEvent> {
    const response = await this.client.chat.completions.create(
      {
        model: request.model,
        messages: toOpenAIMessages(request.messages),
        ...(request.tools.length
          ? {
              tools: request.tools.map((tool) => ({
                type: "function" as const,
                function: {
                  name: tool.name,
                  description: tool.description,
                  parameters: tool.inputSchema,
                },
              })),
            }
          : {}),
        max_completion_tokens: request.maxOutputTokens,
        stream: true,
        stream_options: { include_usage: true },
      },
      request.signal ? { signal: request.signal } : undefined,
    );
    const started = new Set<number>();
    for await (const chunk of response) {
      const delta = chunk.choices[0]?.delta;
      const reasoning = (delta as (typeof delta & ReasoningDelta) | undefined)?.reasoning_content;
      if (reasoning) yield { type: "reasoning_delta", text: reasoning };
      if (delta?.content) yield { type: "text_delta", text: delta.content };
      for (const call of delta?.tool_calls ?? []) {
        const index = call.index;
        if (!started.has(index)) {
          started.add(index);
          yield {
            type: "tool_call_start",
            index,
            callId: call.id ?? `call_${index}`,
            name: call.function?.name ?? "",
          };
        }
        if (call.function?.arguments)
          yield { type: "tool_call_delta", index, argumentsDelta: call.function.arguments };
      }
      if (chunk.usage)
        yield {
          type: "usage",
          usage: {
            inputTokens: chunk.usage.prompt_tokens,
            outputTokens: chunk.usage.completion_tokens,
          },
        };
    }
    for (const index of started) yield { type: "tool_call_end", index };
    yield { type: "done" };
  }
}

export function toOpenAIMessages(
  messages: AgentMessage[],
): OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
  return messages.map((message) => {
    if (message.role === "system" || message.role === "user")
      return { role: message.role, content: message.content };
    if (message.role === "tool")
      return { role: "tool", tool_call_id: message.callId, content: message.content };
    const assistant: OpenAI.Chat.Completions.ChatCompletionAssistantMessageParam = {
      role: "assistant",
      content: message.content || null,
    };
    if (message.toolCalls.length) {
      assistant.tool_calls = message.toolCalls.map((call) => ({
        id: call.callId,
        type: "function" as const,
        function: { name: call.name, arguments: JSON.stringify(call.input) },
      }));
    }
    return assistant;
  });
}
