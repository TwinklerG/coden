import { describe, expect, it } from "vitest";
import { accumulateStream } from "../src/core/runtime.js";
import type { ToolDefinition } from "../src/core/types.js";
import { AnthropicProvider } from "../src/providers/anthropic.js";
import { OpenAICompatibleProvider } from "../src/providers/openai.js";

// Real API smoke tests (design §15.3). These never run in CI or offline
// development: they require CODEN_LIVE_TEST=1 plus the provider API key.
const live = process.env.CODEN_LIVE_TEST === "1";
const echoTool: ToolDefinition = {
  name: "echo",
  description: "Echo the provided text back verbatim.",
  risk: "read",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["text"],
    properties: { text: { type: "string" } },
  },
  async execute() {
    return { content: "not used by smoke tests" };
  },
};

describe.skipIf(!live)("live provider smoke tests", () => {
  it.skipIf(!process.env.CODEN_OPENAI_API_KEY)(
    "openai: streams text and completes a tool call",
    { timeout: 120_000 },
    async () => {
      const provider = new OpenAICompatibleProvider({
        apiKey: process.env.CODEN_OPENAI_API_KEY as string,
        ...(process.env.CODEN_OPENAI_BASE_URL
          ? { baseURL: process.env.CODEN_OPENAI_BASE_URL }
          : {}),
      });
      const model = process.env.CODEN_LIVE_OPENAI_MODEL ?? "gpt-5-mini";
      const text = await accumulateStream(
        provider.stream({
          model,
          messages: [{ role: "user", content: "Reply with exactly: coden-ok" }],
          tools: [],
          maxOutputTokens: 2048,
        }),
      );
      expect(text.toolCalls).toHaveLength(0);
      expect(text.text.toLowerCase()).toContain("coden-ok");
      expect(text.usage.inputTokens).toBeGreaterThan(0);
      const call = await accumulateStream(
        provider.stream({
          model,
          messages: [
            {
              role: "user",
              content: "Call the echo tool with the text coden-live. Do not answer directly.",
            },
          ],
          tools: [echoTool],
          maxOutputTokens: 2048,
        }),
      );
      expect(call.toolCalls.some((toolCall) => toolCall.name === "echo")).toBe(true);
    },
  );

  it.skipIf(!process.env.CODEN_ANTHROPIC_API_KEY)(
    "anthropic: streams text and completes a tool call",
    { timeout: 120_000 },
    async () => {
      const provider = new AnthropicProvider({
        apiKey: process.env.CODEN_ANTHROPIC_API_KEY as string,
      });
      const model = process.env.CODEN_LIVE_ANTHROPIC_MODEL ?? "claude-haiku-4-5";
      const text = await accumulateStream(
        provider.stream({
          model,
          messages: [{ role: "user", content: "Reply with exactly: coden-ok" }],
          tools: [],
          maxOutputTokens: 2048,
        }),
      );
      expect(text.toolCalls).toHaveLength(0);
      expect(text.text.toLowerCase()).toContain("coden-ok");
      expect(text.usage.inputTokens).toBeGreaterThan(0);
      const call = await accumulateStream(
        provider.stream({
          model,
          messages: [
            {
              role: "user",
              content: "Call the echo tool with the text coden-live. Do not answer directly.",
            },
          ],
          tools: [echoTool],
          maxOutputTokens: 2048,
        }),
      );
      expect(call.toolCalls.some((toolCall) => toolCall.name === "echo")).toBe(true);
    },
  );
});
