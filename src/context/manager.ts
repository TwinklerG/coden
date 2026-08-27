import type { AgentMessage, ModelRequest, ToolDefinition } from "../core/types.js";

export interface ContextBudget {
  contextWindow: number;
  reservedOutputTokens: number;
  safetyMargin: number;
}
export interface PreparedContext {
  messages: AgentMessage[];
  estimatedTokens: number;
  compacted: boolean;
}
export interface CompactionRange {
  start: number;
  end: number;
}

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
    const system = messages[0] ?? { role: "system", content: "You are CodeN." };
    const units = buildMessageUnits(messages.slice(1));
    const toolTokens = this.estimator.estimateTools(tools);
    const limit = this.inputBudget();
    let retained = this.summary
      ? units.filter((unit) => unit.end > this.compactedThrough)
      : [...units];
    const recentCount = Math.min(3, retained.length);
    let projected = this.project(system, retained);
    let estimated = this.estimator.estimateMessages(projected) + toolTokens;
    let compacted = false;

    if (estimated > limit * this.threshold && retained.length > recentCount) {
      const old = retained.slice(0, -recentCount);
      retained = retained.slice(-recentCount);
      const oldMessages = [
        ...(this.summary ? [this.summary] : []),
        ...old.flatMap((unit) => unit.messages),
      ];
      this.compactionRange = { start: old[0]?.start ?? 1, end: old.at(-1)?.end ?? 1 };
      this.compactedThrough = this.compactionRange.end;
      this.summary = {
        role: "system",
        content: `Compacted conversation summary:\n${summarizeDeterministically(oldMessages)}`,
      };
      projected = this.project(system, retained);
      estimated = this.estimator.estimateMessages(projected) + toolTokens;
      compacted = true;
    }

    while (estimated > limit && retained.length > 1) {
      retained = retained.slice(1);
      projected = this.project(system, retained);
      estimated = this.estimator.estimateMessages(projected) + toolTokens;
      compacted = true;
    }
    return { messages: projected, estimatedTokens: estimated, compacted };
  }

  forceCompact(messages: AgentMessage[], tools: ToolDefinition[]): PreparedContext {
    const system = messages[0] ?? { role: "system", content: "You are CodeN." };
    const units = buildMessageUnits(messages.slice(1));
    const unsummarized = this.summary
      ? units.filter((unit) => unit.end > this.compactedThrough)
      : units;
    const retained = unsummarized.slice(-1);
    const old = unsummarized.slice(0, -1);
    const oldMessages = [
      ...(this.summary ? [this.summary] : []),
      ...old.flatMap((unit) => unit.messages),
    ];
    if (old.length) {
      this.compactionRange = { start: old[0]?.start ?? 1, end: old.at(-1)?.end ?? 1 };
      this.compactedThrough = this.compactionRange.end;
    }
    this.summary = {
      role: "system",
      content: `Emergency compacted summary:\n${summarizeDeterministically(oldMessages)}`,
    };
    const projected = this.project(system, retained);
    const estimated =
      this.estimator.estimateMessages(projected) + this.estimator.estimateTools(tools);
    return { messages: projected, estimatedTokens: estimated, compacted: true };
  }

  setSummary(content: string, compactedThrough = 0): void {
    this.summary = { role: "system", content };
    this.compactedThrough = compactedThrough;
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

  private project(system: AgentMessage, units: MessageUnit[]): AgentMessage[] {
    return [
      system,
      ...(this.summary ? [this.summary] : []),
      ...units.flatMap((unit) => unit.messages),
    ];
  }
}

function buildMessageUnits(messages: AgentMessage[]): MessageUnit[] {
  const units: MessageUnit[] = [];
  let current: MessageUnit | undefined;
  for (let index = 0; index < messages.length; index++) {
    const message = messages[index];
    if (!message) continue;
    const sourceIndex = index + 1;
    if (message.role === "user" || !current) {
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

function summarizeDeterministically(messages: AgentMessage[]): string {
  const lines = messages.map((message) => {
    if (message.role === "tool")
      return `Tool ${message.name} (${message.isError ? "error" : "ok"}): ${message.content.slice(0, 300)}`;
    return `${message.role}: ${message.content.slice(0, 500)}`;
  });
  return lines.join("\n").slice(0, 6000);
}

export function toModelRequest(
  model: string,
  prepared: PreparedContext,
  tools: ToolDefinition[],
  budget: ContextBudget,
  signal?: AbortSignal,
): ModelRequest {
  const request: ModelRequest = {
    model,
    messages: prepared.messages,
    tools,
    maxOutputTokens: budget.reservedOutputTokens,
  };
  if (signal) request.signal = signal;
  return request;
}
