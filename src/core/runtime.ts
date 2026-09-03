import { randomUUID } from "node:crypto";
import type { ContextManager } from "../context/manager.js";
import { toModelRequest } from "../context/manager.js";
import type { HookEngine } from "../hooks/engine.js";
import type { HookEventName, HookInvocationContext } from "../hooks/types.js";
import type { I18n } from "../i18n/i18n.js";
import type { SessionStore } from "../sessions/store.js";
import type { ToolExecutor } from "../tools/executor.js";
import type { ToolRegistry } from "../tools/registry.js";
import { DEFAULT_MAX_STEPS } from "./defaults.js";
import type { EventBus } from "./events.js";
import {
  isProviderMessageState,
  type ProviderMessageState,
  type ThinkingLevel,
} from "./thinking.js";
import {
  type AgentMessage,
  type AssistantMessage,
  CodeNError,
  type ModelEvent,
  type ModelProvider,
  type ToolCall,
  type Usage,
} from "./types.js";

export interface RuntimeOptions {
  model: string;
  maxSteps?: number;
  retries?: number;
  retryBaseMs?: number;
  systemPrompt?: string;
  i18n?: I18n;
  thinkingLevel?: ThinkingLevel;
}
export interface TurnResult {
  answer: string;
  messages: AgentMessage[];
  toolsExecuted: number;
  usage: Usage;
}

export class AgentRuntime {
  readonly messages: AgentMessage[];
  private readonly maxSteps: number;
  private readonly retries: number;
  private readonly retryBaseMs: number;
  private systemPersisted: boolean;
  private currentThinkingLevel: ThinkingLevel;
  constructor(
    private readonly provider: ModelProvider,
    private readonly registry: ToolRegistry,
    private readonly executor: ToolExecutor,
    private readonly context: ContextManager,
    private readonly sessions: SessionStore,
    private readonly events: EventBus,
    private readonly options: RuntimeOptions,
    initialMessages?: AgentMessage[],
    private readonly hooks?: HookEngine,
    private readonly hookContext?: Omit<HookInvocationContext, "turnId" | "signal">,
  ) {
    this.maxSteps = options.maxSteps ?? DEFAULT_MAX_STEPS;
    this.retries = options.retries ?? 3;
    this.retryBaseMs = options.retryBaseMs ?? 250;
    this.currentThinkingLevel = options.thinkingLevel ?? "default";
    this.systemPersisted = Boolean(initialMessages?.length);
    this.messages = initialMessages?.length
      ? [...initialMessages]
      : [
          {
            role: "system",
            content:
              options.systemPrompt ??
              "You are CodeN, a concise coding agent. Inspect before editing, use tools carefully, and verify changes.",
          },
        ];
  }

  private started = false;
  async start(source: "startup" | "resume", signal?: AbortSignal): Promise<void> {
    if (this.started) return;
    this.started = true;
    if (!this.hooks || !this.hookContext) return;
    const result = await this.hooks.run(
      "SessionStart",
      { source },
      { ...this.hookContext, ...(signal ? { signal } : {}) },
    );
    if (result.additionalContext.length) {
      const message: AgentMessage = {
        role: "system",
        content: `[CodeN hook context: SessionStart]\n${result.additionalContext.join("\n\n")}`,
      };
      let insertAt = 0;
      while (this.messages[insertAt]?.role === "system") insertAt++;
      this.messages.splice(insertAt, 0, message);
      if (this.sessions.isCreated) await this.sessions.appendMessage(message);
    }
  }

  get thinkingLevel(): ThinkingLevel {
    return this.currentThinkingLevel;
  }

  updateThinkingLevel(level: ThinkingLevel): void {
    this.currentThinkingLevel = level;
  }

  updateSystemPrompt(content: string): void {
    const index = this.messages.findIndex((message) => message.role === "system");
    const system = { role: "system" as const, content };
    if (index >= 0) this.messages[index] = system;
    else this.messages.unshift(system);
    this.options.systemPrompt = content;
  }

  async reset(): Promise<void> {
    const systems = this.messages.filter((message) => message.role === "system");
    if (systems.length === 0) systems.push({ role: "system", content: "You are CodeN." });
    if (this.sessions.isCreated) await this.sessions.append("session.reset", {});
    this.messages.splice(0, this.messages.length, ...systems);
    this.context.clearSummary();
    this.systemPersisted = false;
  }

  async compact(): Promise<void> {
    const prepared = this.context.forceCompact(this.messages, this.registry.list());
    const summary = this.context.getSummary();
    if (summary) await this.sessions.appendCompaction(summary, this.context.getCompactionRange());
    await this.events.emit("context.compacted", {
      manual: true,
      estimatedTokens: prepared.estimatedTokens,
    });
  }

  async run(userText: string, signal = new AbortController().signal): Promise<TurnResult> {
    const turnId = randomUUID();
    const turnThinkingLevel = this.currentThinkingLevel;
    const start = Date.now();
    let toolsExecuted = 0;
    let stopHookActive = false;
    const usage: Usage = { inputTokens: 0, outputTokens: 0 };
    const newSession = !this.sessions.isCreated;
    let promptContext: string[] = [];
    if (this.hooks && this.hookContext) {
      const submitted = await this.hooks.run(
        "UserPromptSubmit",
        { prompt: userText },
        { ...this.hookContext, turnId, signal },
      );
      if (submitted.blocked)
        return {
          answer: submitted.blockReason ?? "Prompt blocked by hook",
          messages: this.messages,
          toolsExecuted: 0,
          usage,
        };
      promptContext = submitted.additionalContext;
    }
    await this.sessions.create();
    if (newSession) await this.sessions.appendThinkingLevel(turnThinkingLevel);
    await this.events.emit("turn.started", { input: userText }, turnId);
    try {
      if (!this.systemPersisted) {
        for (const system of this.messages.filter((message) => message.role === "system"))
          await this.sessions.appendMessage(system);
        this.systemPersisted = true;
      }
      const hasPriorUser = this.messages.some(
        (message) => message.role === "user" && message.source !== "hook",
      );
      const user: AgentMessage = { role: "user", content: userText };
      this.messages.push(user);
      await this.sessions.appendMessage(user);
      if (promptContext.length) {
        const hookMessage = hookContextMessage("UserPromptSubmit", promptContext.join("\n\n"));
        this.messages.push(hookMessage);
        await this.sessions.appendMessage(hookMessage);
      }
      if (!hasPriorUser) await this.sessions.setTitle(userText);
      for (let step = 0; step < this.maxSteps; step++) {
        let prepared = this.context.prepare(this.messages, this.registry.list());
        if (prepared.compacted) {
          let summary = this.context.getSummary();
          if (summary) {
            const refined = await this.refineSummary(summary, signal, turnId);
            if (refined) {
              const previous = summary;
              summary = refined;
              this.context.setSummary(refined, this.context.getCompactionRange()?.end ?? 0);
              prepared.messages = prepared.messages.map((message) =>
                message.role === "system" && message.content === previous
                  ? { role: "system", content: refined }
                  : message,
              );
            }
            await this.sessions.appendCompaction(summary, this.context.getCompactionRange());
          }
          await this.events.emit(
            "context.compacted",
            { estimatedTokens: prepared.estimatedTokens },
            turnId,
          );
        }
        await this.events.emit(
          "context.prepared",
          { estimatedTokens: prepared.estimatedTokens, budget: this.context.inputBudget() },
          turnId,
        );
        const accumulated = await this.requestWithRetry(
          toModelRequest(
            this.options.model,
            prepared,
            this.registry.list(),
            this.context.budget,
            signal,
            turnThinkingLevel,
          ),
          turnId,
          async () => {
            prepared = this.context.forceCompact(this.messages, this.registry.list());
            const summary = this.context.getSummary();
            if (summary)
              await this.sessions.appendCompaction(summary, this.context.getCompactionRange());
            return toModelRequest(
              this.options.model,
              prepared,
              this.registry.list(),
              this.context.budget,
              signal,
              turnThinkingLevel,
            );
          },
        );
        usage.inputTokens += accumulated.usage.inputTokens;
        usage.outputTokens += accumulated.usage.outputTokens;
        const assistant: AssistantMessage = {
          role: "assistant",
          content: accumulated.text,
          toolCalls: accumulated.toolCalls,
          model: this.options.model,
          usage: accumulated.usage,
          ...(accumulated.providerState ? { providerState: accumulated.providerState } : {}),
        };
        this.messages.push(assistant);
        await this.sessions.appendMessage(assistant);
        if (assistant.toolCalls.length === 0) {
          if (this.hooks && this.hookContext) {
            const stop = await this.hooks.run(
              "Stop",
              {
                answer: assistant.content,
                toolsExecuted,
                stopHookActive,
              },
              { ...this.hookContext, turnId, signal },
            );
            if (stop.blocked) {
              stopHookActive = true;
              const feedback = hookContextMessage("Stop", stop.blockReason ?? "Continue working");
              this.messages.push(feedback);
              await this.sessions.appendMessage(feedback);
              continue;
            }
          }
          await this.events.emit(
            "turn.completed",
            {
              tools: toolsExecuted,
              durationMs: Date.now() - start,
              inputTokens: usage.inputTokens,
              outputTokens: usage.outputTokens,
              contextTokens: prepared.estimatedTokens,
            },
            turnId,
          );
          return { answer: assistant.content, messages: this.messages, toolsExecuted, usage };
        }
        const toolHookContext: string[] = [];
        for (const call of assistant.toolCalls) {
          const result = await this.executor.execute(call, signal, turnId, userText);
          toolHookContext.push(...result.additionalContext);
          toolsExecuted++;
          if (result.inputChanged) {
            const matching = assistant.toolCalls.find((item) => item.callId === call.callId);
            if (matching) matching.input = result.effectiveCall.input;
            await this.sessions.appendToolCallUpdate(call.callId, result.effectiveCall.input);
          }
          const message: AgentMessage = {
            role: "tool",
            callId: result.effectiveCall.callId,
            name: result.effectiveCall.name,
            content: result.content,
            isError: result.isError ?? false,
          };
          this.messages.push(message);
          await this.sessions.appendMessage(message);
          await this.events.emit(
            "tool.result",
            {
              callId: result.effectiveCall.callId,
              name: result.effectiveCall.name,
              content: result.content,
              isError: result.isError ?? false,
            },
            turnId,
          );
        }
        if (toolHookContext.length) {
          const hookMessage = hookContextMessage("PreToolUse", toolHookContext.join("\n\n"));
          this.messages.push(hookMessage);
          await this.sessions.appendMessage(hookMessage);
        }
      }
      throw new CodeNError(
        "runtime",
        "runtime.step_limit",
        `Maximum model steps (${this.maxSteps}) reached`,
      );
    } catch (error) {
      if (!signal.aborted && this.hooks && this.hookContext)
        await this.hooks.run(
          "Notification",
          {
            notificationType: "attention_required",
            title: "CodeN",
            message: error instanceof Error ? error.message : String(error),
          },
          { ...this.hookContext, turnId, signal },
        );
      await this.events.emit(
        "turn.failed",
        {
          code: error instanceof CodeNError ? error.code : "runtime.unknown",
          message: error instanceof Error ? error.message : String(error),
        },
        turnId,
      );
      throw error;
    }
  }

  private async refineSummary(
    deterministicSummary: string,
    signal: AbortSignal,
    turnId: string,
  ): Promise<string | undefined> {
    try {
      await this.events.emit("context.compaction_started", { model: this.options.model }, turnId);
      const result = await accumulateStream(
        this.provider.stream({
          model: this.options.model,
          messages: [
            {
              role: "system",
              content:
                this.options.i18n?.messages.runtime.compactPrompt ??
                "Rewrite the supplied coding-session summary concisely. Preserve goals, constraints, decisions, changed files, tool/test results, unresolved errors, and next steps. Return only the summary.",
            },
            { role: "user", content: deterministicSummary },
          ],
          tools: [],
          maxOutputTokens: Math.min(2048, this.context.budget.reservedOutputTokens),
          signal,
        }),
      );
      if (result.toolCalls.length > 0 || !result.text.trim()) return undefined;
      return `${this.options.i18n?.messages.runtime.compactTitle ?? "Compacted conversation summary:"}\n${result.text.trim()}`;
    } catch (error) {
      await this.events.emit(
        "context.compaction_failed",
        {
          message: error instanceof Error ? error.message : String(error),
          fallback: "deterministic",
        },
        turnId,
      );
      return undefined;
    }
  }

  private async requestWithRetry(
    initialRequest: ReturnType<typeof toModelRequest>,
    turnId: string,
    emergency: () => Promise<ReturnType<typeof toModelRequest>>,
  ): Promise<AccumulatedStreamResult> {
    let request = initialRequest;
    let emergencyUsed = false;
    for (let attempt = 0; ; attempt++) {
      try {
        await this.events.emit("provider.started", { attempt }, turnId);
        const result = await accumulateStream(
          this.provider.stream(request),
          async (text) => {
            await this.events.emit("provider.delta", { text }, turnId);
          },
          async (text) => {
            await this.events.emit("provider.reasoning_delta", { text }, turnId);
          },
          async (event) => {
            if (event.type === "tool_call_start") {
              await this.events.emit(
                "provider.tool_call_start",
                { index: event.index, callId: event.callId, name: event.name },
                turnId,
              );
            } else if (event.type === "tool_call_delta") {
              await this.events.emit(
                "provider.tool_call_delta",
                { index: event.index, argumentsDelta: event.argumentsDelta },
                turnId,
              );
            } else {
              await this.events.emit("provider.tool_call_end", { index: event.index }, turnId);
            }
          },
        );
        await this.events.emit("provider.completed", { usage: result.usage }, turnId);
        return result;
      } catch (error) {
        if (request.signal?.aborted) throw error;
        if (isContextError(error)) {
          if (!emergencyUsed) {
            emergencyUsed = true;
            request = await emergency();
            await this.events.emit("context.compacted", { emergency: true }, turnId);
            continue;
          }
          throw new CodeNError(
            "context",
            "context.exhausted",
            "Context is still over the provider limit after emergency compaction",
            false,
            undefined,
            { cause: error },
          );
        }
        if (attempt >= this.retries || !isRetryable(error)) throw error;
        await this.events.emit(
          "provider.retry",
          { attempt: attempt + 1, message: error instanceof Error ? error.message : String(error) },
          turnId,
        );
        const retryAfter = retryAfterMs(error);
        const backoff = this.retryBaseMs * 2 ** attempt * (0.8 + Math.random() * 0.4);
        await delay(retryAfter ?? Math.min(30_000, backoff), request.signal);
      }
    }
  }
}

function hookContextMessage(event: HookEventName, content: string): AgentMessage {
  return { role: "user", source: "hook", content: `[CodeN hook context: ${event}]\n${content}` };
}

export type ToolCallStreamEvent = Extract<
  ModelEvent,
  { type: "tool_call_start" | "tool_call_delta" | "tool_call_end" }
>;

export interface AccumulatedStreamResult {
  text: string;
  toolCalls: ToolCall[];
  usage: Usage;
  providerState?: ProviderMessageState;
}

export async function accumulateStream(
  stream: AsyncIterable<ModelEvent>,
  onText?: (text: string) => void | Promise<void>,
  onReasoning?: (text: string) => void | Promise<void>,
  onToolCall?: (event: ToolCallStreamEvent) => void | Promise<void>,
): Promise<AccumulatedStreamResult> {
  let text = "";
  let usage: Usage = { inputTokens: 0, outputTokens: 0 };
  let providerState: ProviderMessageState | undefined;
  const builders = new Map<
    number,
    { callId: string; name: string; json: string; ended: boolean }
  >();
  for await (const event of stream) {
    if (event.type === "reasoning_delta") {
      await onReasoning?.(event.text);
    } else if (event.type === "text_delta") {
      text += event.text;
      await onText?.(event.text);
    } else if (event.type === "provider_state") {
      if (!isProviderMessageState(event.state))
        throw new CodeNError(
          "provider",
          "provider.invalid_state",
          "Provider stream returned malformed reasoning state",
        );
      providerState = event.state;
    } else if (event.type === "tool_call_start") {
      builders.set(event.index, {
        callId: event.callId,
        name: event.name,
        json: "",
        ended: false,
      });
      await onToolCall?.(event);
    } else if (event.type === "tool_call_delta") {
      const builder = builders.get(event.index);
      if (!builder)
        throw new CodeNError(
          "provider",
          "provider.invalid_stream",
          "Tool arguments arrived before tool start",
        );
      builder.json += event.argumentsDelta;
      await onToolCall?.(event);
    } else if (event.type === "tool_call_end") {
      const builder = builders.get(event.index);
      if (builder) {
        builder.ended = true;
        await onToolCall?.(event);
      }
    } else if (event.type === "usage")
      usage = {
        inputTokens: Math.max(usage.inputTokens, event.usage.inputTokens),
        outputTokens: Math.max(usage.outputTokens, event.usage.outputTokens),
      };
  }
  const toolCalls = [...builders.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, builder]) => {
      if (!builder.ended)
        throw new CodeNError(
          "provider",
          "provider.incomplete_tool_call",
          `Incomplete tool call: ${builder.name}`,
        );
      try {
        return {
          callId: builder.callId,
          name: builder.name,
          input: JSON.parse(builder.json || "{}"),
        };
      } catch (cause) {
        throw new CodeNError(
          "provider",
          "provider.invalid_tool_json",
          `Invalid JSON for tool ${builder.name}`,
          false,
          undefined,
          { cause },
        );
      }
    });
  return {
    text,
    toolCalls,
    usage,
    ...(providerState ? { providerState } : {}),
  };
}
function isRetryable(error: unknown): boolean {
  if (error instanceof CodeNError) return error.retryable;
  const status = (error as { status?: unknown })?.status;
  return typeof status !== "number" || status === 429 || status >= 500;
}
function retryAfterMs(error: unknown): number | undefined {
  const headers = (error as { headers?: { get?: (name: string) => string | null } })?.headers;
  const raw = headers?.get?.("retry-after");
  if (!raw) return undefined;
  const seconds = Number(raw);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(raw);
  return Number.isNaN(date) ? undefined : Math.max(0, date - Date.now());
}
function isContextError(error: unknown): boolean {
  const status = (error as { status?: unknown })?.status;
  const message = error instanceof Error ? error.message : String(error);
  return status === 413 || /context.{0,20}(?:length|window|limit|too long)/i.test(message);
}
function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(signal.reason);
      },
      { once: true },
    );
  });
}
