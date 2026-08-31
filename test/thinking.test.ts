import { describe, expect, it } from "vitest";
import { resolveInitialThinkingLevel } from "../src/cli/agent-application.js";
import { THINKING_LEVELS } from "../src/core/thinking.js";
import {
  resolveThinkingStatus,
  toAnthropicThinkingConfig,
  toOpenAIReasoningEffort,
} from "../src/providers/thinking.js";

describe("thinking levels", () => {
  it("exposes the six canonical values", () => {
    expect(THINKING_LEVELS).toEqual(["default", "off", "minimal", "low", "medium", "high"]);
  });

  it.each([
    ["default", undefined],
    ["off", "minimal"],
    ["minimal", "minimal"],
    ["low", "low"],
    ["medium", "medium"],
    ["high", "high"],
  ] as const)("maps OpenAI %s", (level, expected) => {
    expect(toOpenAIReasoningEffort(level)).toBe(expected);
  });

  it("maps Anthropic levels inside maxOutputTokens", () => {
    expect(toAnthropicThinkingConfig("default", 8192)).toBeUndefined();
    expect(toAnthropicThinkingConfig("off", 8192)).toEqual({ type: "disabled" });
    expect(toAnthropicThinkingConfig("minimal", 8192)).toEqual({
      type: "enabled",
      budget_tokens: 1024,
    });
    expect(toAnthropicThinkingConfig("low", 8192)).toEqual({
      type: "enabled",
      budget_tokens: 2048,
    });
    expect(toAnthropicThinkingConfig("medium", 8192)).toEqual({
      type: "enabled",
      budget_tokens: 4096,
    });
    expect(toAnthropicThinkingConfig("high", 8192)).toEqual({
      type: "enabled",
      budget_tokens: 6144,
    });
  });

  it("clamps proportional Anthropic budgets at both edges", () => {
    expect(toAnthropicThinkingConfig("low", 1025)).toEqual({
      type: "enabled",
      budget_tokens: 1024,
    });
    expect(toAnthropicThinkingConfig("high", 2000)).toEqual({
      type: "enabled",
      budget_tokens: 1500,
    });
  });

  it("rejects an impossible Anthropic enabled budget", () => {
    expect(() => toAnthropicThinkingConfig("minimal", 1024)).toThrow(
      "requires maxOutputTokens greater than 1024",
    );
    expect(() => toAnthropicThinkingConfig("low", 1024)).toThrow(
      "requires maxOutputTokens greater than 1024",
    );
  });

  it("describes OpenAI off honestly", () => {
    expect(resolveThinkingStatus("openai", "off", 8192)).toMatchObject({
      level: "off",
      effectiveLevel: "minimal",
      displayLevel: "off→minimal",
    });
  });

  it("reports the Anthropic budget only for enabled levels", () => {
    expect(resolveThinkingStatus("anthropic", "medium", 8192)).toMatchObject({
      level: "medium",
      effectiveLevel: "medium",
      displayLevel: "medium",
      budgetTokens: 4096,
    });
    expect(resolveThinkingStatus("anthropic", "off", 8192)).toEqual({
      level: "off",
      effectiveLevel: "off",
      displayLevel: "off",
    });
    expect(resolveThinkingStatus("anthropic", "default", 8192)).toEqual({
      level: "default",
      effectiveLevel: "default",
      displayLevel: "default",
    });
  });

  it("resolves launch thinking precedence", () => {
    expect(resolveInitialThinkingLevel(undefined, "low", "high")).toBe("low");
    expect(resolveInitialThinkingLevel("off", "low", "high")).toBe("off");
    expect(resolveInitialThinkingLevel(undefined, undefined, "medium")).toBe("medium");
  });
});
