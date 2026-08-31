import type { ThinkingConfigParam } from "@anthropic-ai/sdk/resources/messages";
import type { ProviderName } from "../config/config.js";
import type { ThinkingLevel } from "../core/thinking.js";

export interface ThinkingStatus {
  level: ThinkingLevel;
  effectiveLevel: ThinkingLevel;
  displayLevel: string;
  budgetTokens?: number;
}

export function toOpenAIReasoningEffort(
  level: ThinkingLevel,
): "minimal" | "low" | "medium" | "high" | undefined {
  switch (level) {
    case "default":
      return undefined;
    case "off":
    case "minimal":
      return "minimal";
    case "low":
      return "low";
    case "medium":
      return "medium";
    case "high":
      return "high";
  }
}

export function toAnthropicThinkingConfig(
  level: ThinkingLevel,
  maxOutputTokens: number,
): ThinkingConfigParam | undefined {
  switch (level) {
    case "default":
      return undefined;
    case "off":
      return { type: "disabled" };
    case "minimal":
      return enabledBudget(1024, maxOutputTokens);
    case "low":
      return enabledBudget(budgetFor(0.25, maxOutputTokens), maxOutputTokens);
    case "medium":
      return enabledBudget(budgetFor(0.5, maxOutputTokens), maxOutputTokens);
    case "high":
      return enabledBudget(budgetFor(0.75, maxOutputTokens), maxOutputTokens);
  }
}

export function resolveThinkingStatus(
  provider: ProviderName,
  level: ThinkingLevel,
  maxOutputTokens: number,
): ThinkingStatus {
  const effectiveLevel = provider === "openai" && level === "off" ? "minimal" : level;
  const displayLevel = provider === "openai" && level === "off" ? "off→minimal" : level;
  const anthropic =
    provider === "anthropic" ? toAnthropicThinkingConfig(level, maxOutputTokens) : undefined;
  const budgetTokens = anthropic?.type === "enabled" ? anthropic.budget_tokens : undefined;
  return {
    level,
    effectiveLevel,
    displayLevel,
    ...(budgetTokens !== undefined ? { budgetTokens } : {}),
  };
}

function budgetFor(ratio: number, maxOutputTokens: number): number {
  return Math.min(maxOutputTokens - 1, Math.max(1024, Math.floor(maxOutputTokens * ratio)));
}

function enabledBudget(budget: number, maxOutputTokens: number): ThinkingConfigParam {
  if (maxOutputTokens <= 1024)
    throw new Error("Anthropic enabled thinking requires maxOutputTokens greater than 1024");
  return { type: "enabled", budget_tokens: budget };
}
