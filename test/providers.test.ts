import { describe, expect, it } from "vitest";
import { accumulateStream } from "../src/core/runtime.js";
import type { AgentMessage, ModelEvent } from "../src/core/types.js";
import { AnthropicProvider, toAnthropicMessages } from "../src/providers/anthropic.js";
import { OpenAICompatibleProvider, toOpenAIMessages } from "../src/providers/openai.js";

async function* events(items: ModelEvent[]) {
  for (const item of items) yield item;
}
describe("providers", () => {
  const messages: AgentMessage[] = [
    { role: "system", content: "system" },
    { role: "user", content: "task" },
    {
      role: "assistant",
      content: "",
      toolCalls: [
        { callId: "c1", name: "read", input: { path: "a" } },
        { callId: "c2", name: "read", input: { path: "b" } },
      ],
    },
    { role: "tool", callId: "c1", name: "read", content: "body", isError: false },
    { role: "tool", callId: "c2", name: "read", content: "other", isError: false },
  ];
  it("disables hidden SDK retries so runtime tracing owns retry policy", () => {
    const openai = new OpenAICompatibleProvider({ apiKey: "test" }) as unknown as {
      client: { maxRetries: number };
    };
    const anthropic = new AnthropicProvider({ apiKey: "test" }) as unknown as {
      client: { maxRetries: number };
    };
    expect(openai.client.maxRetries).toBe(0);
    expect(anthropic.client.maxRetries).toBe(0);
  });

  it("converts normalized OpenAI messages", () => {
    const converted = toOpenAIMessages(messages);
    expect(converted[2]).toMatchObject({
      role: "assistant",
      tool_calls: [{ id: "c1" }, { id: "c2" }],
    });
    expect(converted[3]).toMatchObject({ role: "tool", tool_call_id: "c1" });
  });
  it("converts normalized Anthropic messages", () => {
    const converted = toAnthropicMessages(messages);
    expect(converted.system).toBe("system");
    expect(converted.messages[1]).toMatchObject({
      role: "assistant",
      content: [
        { type: "tool_use", id: "c1" },
        { type: "tool_use", id: "c2" },
      ],
    });
    expect(converted.messages[2]).toMatchObject({
      role: "user",
      content: [
        { type: "tool_result", tool_use_id: "c1" },
        { type: "tool_result", tool_use_id: "c2" },
      ],
    });
  });
  it("assembles streamed tool arguments", async () => {
    const result = await accumulateStream(
      events([
        { type: "text_delta", text: "checking" },
        { type: "tool_call_start", index: 0, callId: "c1", name: "read" },
        { type: "tool_call_delta", index: 0, argumentsDelta: '{"path":' },
        { type: "tool_call_delta", index: 0, argumentsDelta: '"a"}' },
        { type: "tool_call_end", index: 0 },
        { type: "usage", usage: { inputTokens: 10, outputTokens: 3 } },
        { type: "done" },
      ]),
    );
    expect(result).toEqual({
      text: "checking",
      toolCalls: [{ callId: "c1", name: "read", input: { path: "a" } }],
      usage: { inputTokens: 10, outputTokens: 3 },
    });
  });
  it("rejects interrupted tool calls", async () => {
    await expect(
      accumulateStream(events([{ type: "tool_call_start", index: 0, callId: "c", name: "read" }])),
    ).rejects.toMatchObject({ code: "provider.incomplete_tool_call" });
  });
});
