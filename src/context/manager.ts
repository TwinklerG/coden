import type { ThinkingLevel } from "../core/thinking.js";
import type { AgentMessage, ModelRequest, ToolDefinition } from "../core/types.js";

export interface ContextBudget {
  contextWindow: number;
  reservedOutputTokens: number;
  safetyMargin: number;
}
export interface PreparedContext {
  messages: AgentMessage[];
  estimatedTokens: number;
  compactionPlan?: CompactionPlan;
}
export interface CompactionRange {
  start: number;
  end: number;
}
export type CompactionTrigger = "automatic" | "manual" | "emergency";
export type CompactionValidationFailure = "empty_summary" | "inflated_summary" | "over_budget";
export interface CompactionPlan {
  trigger: CompactionTrigger;
  messagesToCompact: AgentMessage[];
  retainedMessages: AgentMessage[];
  sourceRange: CompactionRange;
  replacedTokens: number;
}
export type CompactionCommitResult =
  | { ok: true; prepared: PreparedContext }
  | { ok: false; reason: CompactionValidationFailure };

interface MessageUnit {
  messages: AgentMessage[];
  start: number;
  end: number;
}

export class TokenEstimator {
  estimateText(text: string): number {
    return Math.ceil(text.length / 3.5);
  }
  estimateMessages(messages: AgentMessage[]): number {
    return messages.reduce(
      (sum, message) => sum + 6 + this.estimateText(JSON.stringify(message)),
      0,
    );
  }
  estimateTools(tools: ToolDefinition[]): number {
    return this.estimateText(JSON.stringify(tools.map(({ execute: _, ...tool }) => tool)));
  }
}

export class ContextManager {
  readonly estimator = new TokenEstimator();
  private summary: AgentMessage | undefined;
  private compactionRange: CompactionRange | undefined;
  private compactedThrough = 0;
  constructor(
    readonly budget: ContextBudget,
    private readonly threshold = 0.8,
  ) {}

  inputBudget(): number {
    return this.budget.contextWindow - this.budget.reservedOutputTokens - this.budget.safetyMargin;
  }

  prepare(messages: AgentMessage[], tools: ToolDefinition[]): PreparedContext {
    const { systems, remainder, offset } = splitLeadingSystems(messages);
    const units = buildMessageUnits(remainder, offset);
    const activeUnits = this.summary
      ? units.filter((unit) => unit.end > this.compactedThrough)
      : units;
    const projected = this.project(
      systems,
      activeUnits.flatMap((unit) => unit.messages),
    );
    const estimatedTokens =
      this.estimator.estimateMessages(projected) + this.estimator.estimateTools(tools);
    const plan =
      estimatedTokens > this.inputBudget() * this.threshold
        ? this.planCompaction(messages, "automatic")
        : undefined;
    return {
      messages: projected,
      estimatedTokens,
      ...(plan ? { compactionPlan: plan } : {}),
    };
  }

  planCompaction(messages: AgentMessage[], trigger: CompactionTrigger): CompactionPlan | undefined {
    const { remainder, offset } = splitLeadingSystems(messages);
    const units = buildMessageUnits(remainder, offset);
    const unsummarized = this.summary
      ? units.filter((unit) => unit.end > this.compactedThrough)
      : units;
    if (unsummarized.length <= 2) return undefined;
    const old = unsummarized.slice(0, -2);
    const retained = unsummarized.slice(-2);
    const messagesToCompact = [
      ...(this.summary ? [this.summary] : []),
      ...old.flatMap((unit) => unit.messages),
    ];
    const sourceRange = {
      start: this.compactionRange?.start ?? old[0]?.start ?? offset,
      end: old.at(-1)?.end ?? offset,
    };
    return {
      trigger,
      messagesToCompact,
      retainedMessages: retained.flatMap((unit) => unit.messages),
      sourceRange,
      replacedTokens: this.estimator.estimateMessages(messagesToCompact),
    };
  }

  commitCompaction(
    plan: CompactionPlan,
    summary: string,
    systems: AgentMessage[],
    tools: ToolDefinition[],
  ): CompactionCommitResult {
    if (!summary.trim()) return { ok: false, reason: "empty_summary" };
    const summaryTokens = this.estimator.estimateMessages([{ role: "system", content: summary }]);
    if (summaryTokens >= plan.replacedTokens) return { ok: false, reason: "inflated_summary" };
    const messages = [
      ...systems,
      { role: "system" as const, content: summary },
      ...plan.retainedMessages,
    ];
    const estimatedTokens =
      this.estimator.estimateMessages(messages) + this.estimator.estimateTools(tools);
    if (estimatedTokens > this.inputBudget()) return { ok: false, reason: "over_budget" };

    this.summary = { role: "system", content: summary };
    this.compactionRange = plan.sourceRange;
    this.compactedThrough = plan.sourceRange.end;
    return { ok: true, prepared: { messages, estimatedTokens } };
  }

  setSummary(content: string, range?: CompactionRange): void {
    this.summary = { role: "system", content };
    this.compactionRange = range;
    this.compactedThrough = range?.end ?? 0;
  }
  getSummary(): string | undefined {
    return this.summary?.content;
  }
  getCompactionRange(): CompactionRange | undefined {
    return this.compactionRange;
  }
  clearSummary(): void {
    this.summary = undefined;
    this.compactionRange = undefined;
    this.compactedThrough = 0;
  }

  private project(systems: AgentMessage[], retained: AgentMessage[]): AgentMessage[] {
    return [...systems, ...(this.summary ? [this.summary] : []), ...retained];
  }
}

function splitLeadingSystems(messages: AgentMessage[]): {
  systems: AgentMessage[];
  remainder: AgentMessage[];
  offset: number;
} {
  let offset = 0;
  while (messages[offset]?.role === "system") offset++;
  return {
    systems:
      offset > 0 ? messages.slice(0, offset) : [{ role: "system", content: "You are CodeN." }],
    remainder: messages.slice(offset),
    offset,
  };
}

function buildMessageUnits(messages: AgentMessage[], offset = 0): MessageUnit[] {
  const units: MessageUnit[] = [];
  let current: MessageUnit | undefined;
  for (let index = 0; index < messages.length; index++) {
    const message = messages[index];
    if (!message) continue;
    const sourceIndex = index + offset;
    const beginsInteraction = message.role === "user" && message.source !== "hook";
    if (beginsInteraction || !current) {
      if (current) units.push(current);
      current = { messages: [message], start: sourceIndex, end: sourceIndex };
    } else {
      current.messages.push(message);
      current.end = sourceIndex;
    }
  }
  if (current) units.push(current);
  return units;
}

export function toModelRequest(
  model: string,
  prepared: PreparedContext,
  tools: ToolDefinition[],
  budget: ContextBudget,
  signal?: AbortSignal,
  thinkingLevel?: ThinkingLevel,
): ModelRequest {
  const request: ModelRequest = {
    model,
    messages: prepared.messages,
    tools,
    maxOutputTokens: budget.reservedOutputTokens,
  };
  if (signal) request.signal = signal;
  if (thinkingLevel !== undefined) request.thinkingLevel = thinkingLevel;
  return request;
}
