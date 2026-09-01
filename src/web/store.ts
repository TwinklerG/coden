import { randomUUID } from "node:crypto";
import type { AgentApplicationMetadata } from "../cli/agent-application.js";
import type { EventBus, RuntimeEvent } from "../core/events.js";
import type { AgentMessage, ToolCall, ToolDefinition, ToolRisk } from "../core/types.js";
import type { PermissionDecision } from "../permissions/policy.js";
import type { SessionMeta } from "../sessions/store.js";
import type {
  WebBlock,
  WebInteractionDecision,
  WebPatch,
  WebSessionSummary,
  WebSnapshot,
  WebToolRisk,
} from "./protocol.js";

export type WebStoreListener = (revision: number, patch: WebPatch) => void;

type PendingInteraction = {
  id: string;
  kind: "permission" | "confirm";
  risk?: WebToolRisk;
  settled: boolean;
  cleanup?: () => void;
  resolve: (value: PermissionDecision | boolean) => void;
};

export class WebStore {
  #snapshot: WebSnapshot;
  readonly #listeners = new Set<WebStoreListener>();
  readonly #blockIndexes = new Map<string, number>();
  readonly #toolBlocks = new Map<string, string>();
  #unsubscribeEvents: (() => void) | undefined;
  #pending: PendingInteraction | undefined;
  #activeAssistantId: string | undefined;

  constructor(language: "zh" | "en") {
    this.#snapshot = {
      revision: 0,
      phase: "starting",
      running: false,
      language,
      remote: false,
      sessions: [],
      blocks: [],
      control: {},
      startupWarnings: [],
    };
  }

  snapshot(): WebSnapshot {
    return this.#snapshot;
  }

  subscribe(listener: WebStoreListener): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  connect(events: EventBus): () => void {
    this.#unsubscribeEvents?.();
    this.#unsubscribeEvents = events.on((event) => this.applyRuntimeEvent(event));
    return this.#unsubscribeEvents;
  }

  setApplication(
    metadata: AgentApplicationMetadata,
    sessionId: string,
    startupWarnings: string[],
  ): void {
    this.merge({
      metadata,
      sessionId,
      startupWarnings: startupWarnings.map(cleanText),
      phase: "idle",
      running: false,
    });
  }

  setStarting(): void {
    this.merge({ phase: "starting", running: false });
  }

  setFatal(code: string, message: string): void {
    this.merge({
      phase: "failed",
      running: false,
      fatalError: { code, message: cleanText(message) },
    });
  }

  clearFatal(): void {
    if (this.#snapshot.fatalError === undefined) return;
    this.commit({ op: "merge", value: {}, clear: ["fatalError"] }, (current) => {
      const { fatalError: _fatalError, ...rest } = current;
      return rest;
    });
  }

  setSessions(sessions: SessionMeta[] | WebSessionSummary[]): void {
    this.merge({
      sessions: sessions.map((session) => ({
        id: session.id,
        ...(session.title === undefined ? {} : { title: cleanText(session.title) }),
        messageCount: session.messageCount,
        lastActivity: session.lastActivity,
      })),
    });
  }

  setOwner(ownerClientId: string): void {
    this.merge({ control: { ownerClientId } });
  }

  setRemote(remote: boolean): void {
    this.merge({ remote });
  }

  setRecoveredMessages(messages: AgentMessage[]): void {
    const blocks: WebBlock[] = [];
    const tools = new Map<string, Extract<WebBlock, { kind: "tool" }>>();
    for (const message of messages) {
      if (message.role === "system" || (message.role === "user" && message.source === "hook"))
        continue;
      if (message.role === "user") {
        blocks.push({
          id: `history-${blocks.length}`,
          kind: "user",
          text: cleanText(message.content),
        });
        continue;
      }
      if (message.role === "assistant") {
        if (message.content)
          blocks.push({
            id: `history-${blocks.length}`,
            kind: "assistant",
            markdown: cleanText(message.content),
          });
        for (const call of message.toolCalls) {
          const block: Extract<WebBlock, { kind: "tool" }> = {
            id: `tool-${call.callId}`,
            kind: "tool",
            callId: call.callId,
            name: cleanText(call.name),
            status: "preparing",
            input: jsonSafe(call.input),
          };
          blocks.push(block);
          tools.set(call.callId, block);
        }
        continue;
      }
      const tool = tools.get(message.callId);
      if (tool) {
        tool.status = message.isError ? "failed" : "succeeded";
        tool.output = cleanText(message.content);
      } else {
        blocks.push({
          id: `tool-${message.callId}`,
          kind: "tool",
          callId: message.callId,
          name: cleanText(message.name),
          status: message.isError ? "failed" : "succeeded",
          output: cleanText(message.content),
        });
      }
    }
    this.#reindex(blocks);
    this.commit({ op: "replace_blocks", blocks }, (current) => ({ ...current, blocks }));
  }

  async applyRuntimeEvent(event: RuntimeEvent): Promise<void> {
    const data = event.data ?? {};
    const turnId = event.turnId ?? "unknown";
    switch (event.type) {
      case "turn.started": {
        this.#activeAssistantId = undefined;
        this.append({
          id: `user-${turnId}`,
          kind: "user",
          text: cleanText(stringValue(data.input)),
        });
        this.merge({ phase: "thinking", running: true });
        return;
      }
      case "provider.started":
      case "provider.reasoning_delta":
        this.merge({ phase: "thinking", running: true });
        return;
      case "provider.delta": {
        const text = cleanText(stringValue(data.text));
        if (!this.#activeAssistantId) {
          this.#activeAssistantId = `assistant-${turnId}`;
          this.append({ id: this.#activeAssistantId, kind: "assistant", markdown: text });
        } else {
          const block = this.block(this.#activeAssistantId);
          if (block?.kind === "assistant")
            this.update({ ...block, markdown: `${block.markdown}${text}` });
        }
        this.merge({ phase: "rendering", running: true });
        return;
      }
      case "provider.retry":
        if (this.#activeAssistantId) {
          this.removeBlock(this.#activeAssistantId);
          this.#activeAssistantId = undefined;
        }
        this.merge({ phase: "thinking", running: true });
        return;
      case "provider.tool_call_start": {
        const callId = stringValue(data.callId);
        const id = `tool-${callId}`;
        if (!this.#toolBlocks.has(callId)) {
          this.#toolBlocks.set(callId, id);
          this.append({
            id,
            kind: "tool",
            callId,
            name: cleanText(stringValue(data.name)),
            status: "preparing",
          });
        }
        return;
      }
      case "tool.started": {
        const callId = stringValue(data.callId);
        this.upsertTool(callId, {
          name: cleanText(stringValue(data.name)),
          status: "running",
          ...(data.summary === undefined ? {} : { summary: cleanText(stringValue(data.summary)) }),
          ...(data.input === undefined ? {} : { input: jsonSafe(data.input) }),
          ...(isRisk(data.risk) ? { risk: data.risk } : {}),
        });
        this.merge({ phase: "tool", running: true });
        return;
      }
      case "tool.completed": {
        const callId = stringValue(data.callId);
        this.upsertTool(callId, {
          name: cleanText(stringValue(data.name)),
          status:
            data.cancelled === true ? "cancelled" : data.isError === true ? "failed" : "succeeded",
          ...(typeof data.durationMs === "number" ? { durationMs: data.durationMs } : {}),
        });
        return;
      }
      case "tool.result": {
        const callId = stringValue(data.callId);
        this.upsertTool(callId, {
          name: cleanText(stringValue(data.name)),
          status: data.isError === true ? "failed" : "succeeded",
          output: cleanText(stringValue(data.content)),
        });
        return;
      }
      case "permission.requested":
        this.merge({ phase: "reviewing", running: true });
        return;
      case "context.prepared": {
        const used = numberValue(data.estimatedTokens);
        const budget = numberValue(data.budget);
        if (budget > 0)
          this.merge({ contextPercent: Math.max(0, Math.min(100, (used / budget) * 100)) });
        return;
      }
      case "turn.completed":
        this.#activeAssistantId = undefined;
        this.merge({
          phase: "idle",
          running: false,
          turnUsage: {
            inputTokens: numberValue(data.inputTokens),
            outputTokens: numberValue(data.outputTokens),
            durationMs: numberValue(data.durationMs),
          },
        });
        return;
      case "turn.failed":
        this.#activeAssistantId = undefined;
        this.append({
          id: `error-${turnId}-${this.#snapshot.revision}`,
          kind: "error",
          text: cleanText(stringValue(data.message)),
        });
        this.merge({ phase: "idle", running: false });
        return;
      case "plugin.failed":
      case "plugin.unavailable":
      case "plugin.restart_required":
        this.append({
          id: `info-${this.#snapshot.revision}`,
          kind: "info",
          text: cleanText(stringValue(data.message ?? data.reason)),
        });
        return;
    }
  }

  openPermission(
    tool: ToolDefinition,
    call: ToolCall,
    risk: ToolRisk,
    signal?: AbortSignal,
  ): { id: string; promise: Promise<PermissionDecision> } {
    if (this.#pending) throw new Error("an interaction is already pending");
    const id = randomUUID();
    let resolvePromise!: (decision: PermissionDecision) => void;
    const promise = new Promise<PermissionDecision>((resolve) => {
      resolvePromise = resolve;
    });
    const pending: PendingInteraction = {
      id,
      kind: "permission",
      risk,
      settled: false,
      resolve: (value) => resolvePromise(value as PermissionDecision),
    };
    this.#pending = pending;
    this.append({
      id,
      kind: "interaction",
      interaction: "permission",
      status: "pending",
      toolName: cleanText(tool.name),
      risk,
      input: jsonSafe(call.input),
      allowSession: risk !== "dangerous",
    });
    this.merge({ pendingInteractionId: id, phase: "reviewing", running: true });
    this.bindAbort(pending, signal);
    return { id, promise };
  }

  openConfirm(message: string, signal?: AbortSignal): { id: string; promise: Promise<boolean> } {
    if (this.#pending) throw new Error("an interaction is already pending");
    const id = randomUUID();
    let resolvePromise!: (decision: boolean) => void;
    const promise = new Promise<boolean>((resolve) => {
      resolvePromise = resolve;
    });
    const pending: PendingInteraction = {
      id,
      kind: "confirm",
      settled: false,
      resolve: (value) => resolvePromise(value as boolean),
    };
    this.#pending = pending;
    this.append({
      id,
      kind: "interaction",
      interaction: "confirm",
      status: "pending",
      message: cleanText(message),
      allowSession: false,
    });
    this.merge({ pendingInteractionId: id, phase: "reviewing" });
    this.bindAbort(pending, signal);
    return { id, promise };
  }

  resolveInteraction(id: string, decision: WebInteractionDecision): void {
    const pending = this.#pending;
    if (!pending || pending.id !== id || pending.settled)
      throw new Error("interaction is no longer pending");
    if (pending.kind === "permission") {
      if (!(["allow_once", "allow_session", "deny"] as string[]).includes(decision))
        throw new Error("invalid permission decision");
      if (decision === "allow_session" && pending.risk === "dangerous")
        throw new Error("dangerous tools cannot be allowed for the session");
      this.settle(pending, decision, decision as PermissionDecision);
      return;
    }
    if (decision !== "confirm" && decision !== "reject")
      throw new Error("invalid confirmation decision");
    this.settle(pending, decision, decision === "confirm");
  }

  cancelInteraction(): void {
    const pending = this.#pending;
    if (!pending) return;
    this.settle(pending, "reject", pending.kind === "permission" ? "deny" : false, true);
  }

  close(): void {
    this.cancelInteraction();
    this.#unsubscribeEvents?.();
    this.#unsubscribeEvents = undefined;
    this.#listeners.clear();
  }

  private bindAbort(pending: PendingInteraction, signal?: AbortSignal): void {
    if (!signal) return;
    const abort = () => this.cancelInteraction();
    pending.cleanup = () => signal.removeEventListener("abort", abort);
    if (signal.aborted) abort();
    else signal.addEventListener("abort", abort, { once: true });
  }

  private settle(
    pending: PendingInteraction,
    decision: WebInteractionDecision,
    value: PermissionDecision | boolean,
    cancelled = false,
  ): void {
    pending.settled = true;
    pending.cleanup?.();
    const block = this.block(pending.id);
    if (block?.kind === "interaction")
      this.update({
        ...block,
        status: cancelled ? "cancelled" : "resolved",
        decision,
      });
    this.#pending = undefined;
    this.commit(
      {
        op: "merge",
        value: { phase: this.#snapshot.running ? "thinking" : "idle" },
        clear: ["pendingInteractionId"],
      },
      (current) => {
        const { pendingInteractionId: _pending, ...rest } = current;
        return { ...rest, phase: current.running ? "thinking" : "idle" };
      },
    );
    pending.resolve(value);
  }

  private append(block: WebBlock): void {
    const blocks = [...this.#snapshot.blocks, block];
    this.#blockIndexes.set(block.id, blocks.length - 1);
    if (block.kind === "tool") this.#toolBlocks.set(block.callId, block.id);
    this.commit({ op: "append_blocks", blocks: [block] }, (current) => ({ ...current, blocks }));
  }

  private update(block: WebBlock): void {
    const index = this.#blockIndexes.get(block.id);
    if (index === undefined) throw new Error(`unknown block: ${block.id}`);
    const blocks = [...this.#snapshot.blocks];
    blocks[index] = block;
    this.commit({ op: "update_block", id: block.id, block }, (current) => ({ ...current, blocks }));
  }

  private removeBlock(id: string): void {
    const blocks = this.#snapshot.blocks.filter((block) => block.id !== id);
    this.#reindex(blocks);
    this.commit({ op: "replace_blocks", blocks }, (current) => ({ ...current, blocks }));
  }

  private block(id: string): WebBlock | undefined {
    const index = this.#blockIndexes.get(id);
    return index === undefined ? undefined : this.#snapshot.blocks[index];
  }

  private upsertTool(
    callId: string,
    value: Omit<Partial<Extract<WebBlock, { kind: "tool" }>>, "id" | "kind" | "callId"> & {
      name: string;
      status: Extract<WebBlock, { kind: "tool" }>["status"];
    },
  ): void {
    const id = this.#toolBlocks.get(callId) ?? `tool-${callId}`;
    const current = this.block(id);
    if (current?.kind === "tool") this.update({ ...current, ...value });
    else this.append({ id, kind: "tool", callId, ...value });
  }

  private merge(value: Extract<WebPatch, { op: "merge" }>["value"]): void {
    this.commit({ op: "merge", value }, (current) => ({ ...current, ...value }));
  }

  private commit(patch: WebPatch, update: (current: WebSnapshot) => WebSnapshot): void {
    const revision = this.#snapshot.revision + 1;
    this.#snapshot = { ...update(this.#snapshot), revision };
    for (const listener of this.#listeners) listener(revision, patch);
  }

  #reindex(blocks: WebBlock[]): void {
    this.#blockIndexes.clear();
    this.#toolBlocks.clear();
    blocks.forEach((block, index) => {
      this.#blockIndexes.set(block.id, index);
      if (block.kind === "tool") this.#toolBlocks.set(block.callId, block.id);
    });
  }
}

function cleanText(value: string): string {
  return [...value]
    .filter((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code === 9 || code === 10 || code === 13 || (code >= 32 && code !== 127);
    })
    .join("");
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function numberValue(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function isRisk(value: unknown): value is WebToolRisk {
  return value === "read" || value === "modify" || value === "dangerous";
}

function jsonSafe(value: unknown): unknown {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return String(value);
  }
}
