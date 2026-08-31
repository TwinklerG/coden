import type { AgentApplicationMetadata } from "../cli/agent-application.js";
import type { EventBus, RuntimeEvent } from "../core/events.js";
import type { AgentMessage, ToolCall, ToolDefinition, ToolRisk } from "../core/types.js";
import { I18n } from "../i18n/i18n.js";
import { sanitizeTerminalText } from "../observability/terminal-text.js";
import { formatToolInput } from "../observability/tool-input.js";
import type { PermissionDecision } from "../permissions/policy.js";
import { messagesToTranscript } from "./transcript.js";
import type {
  TranscriptBlock,
  TranscriptInteractionBlock,
  TuiInteractionAnswer,
  TuiInteractionStatus,
  TuiPhase,
  TuiSnapshot,
} from "./types.js";

type Listener = () => void;
type SnapshotPatch = { [Key in keyof TuiSnapshot]?: TuiSnapshot[Key] | undefined };
type PendingInteraction = {
  id: string;
  kind: "permission" | "confirm";
  allowSession: boolean;
  fallback: PermissionDecision | boolean;
  resolve(decision: PermissionDecision | boolean): void;
  cleanup?: () => void;
};

const INITIAL: TuiSnapshot = {
  blocks: [],
  phase: "starting",
  running: false,
  followOutput: true,
};

export class TuiStore {
  readonly #listeners = new Set<Listener>();
  readonly #i18n: I18n;
  #snapshot: TuiSnapshot = INITIAL;
  #nextId = 1;
  #activeAssistant: string | undefined;
  #activeActivity: string | undefined;
  #toolPreview: { name: string; argumentsText: string } | undefined;
  #pendingInteraction: PendingInteraction | undefined;
  #closed = false;

  constructor(i18n: I18n = new I18n("en")) {
    this.#i18n = i18n;
  }

  readonly subscribe = (listener: Listener): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  readonly getSnapshot = (): TuiSnapshot => this.#snapshot;

  connect(events: EventBus): () => void {
    return events.on((event) => this.apply(event));
  }

  setMetadata(metadata: AgentApplicationMetadata): void {
    this.update({ metadata });
  }

  setRecoveredMessages(messages: readonly AgentMessage[]): void {
    this.#activeActivity = undefined;
    this.#activeAssistant = undefined;
    this.#toolPreview = undefined;
    this.update({ blocks: messagesToTranscript(messages) });
  }

  addInfo(text: string): void {
    this.addBlock({ id: this.id("info"), kind: "info", text });
  }

  addError(text: string): void {
    this.addBlock({ id: this.id("error"), kind: "error", text });
  }

  setIdle(): void {
    this.clearActivity();
    this.update({ phase: "idle", running: false });
  }

  setSubmitting(): void {
    this.clearActivity();
    this.update({ phase: "submitting", running: true });
  }

  setFatal(error: unknown): void {
    this.cancelPendingInteraction();
    this.clearActivity();
    const message = error instanceof Error ? error.message : String(error);
    this.addError(message);
    this.update({ phase: "failed", running: false, fatalError: message });
  }

  setFollowOutput(followOutput: boolean): void {
    this.update({ followOutput });
  }

  requestPermission(
    tool: ToolDefinition,
    call: ToolCall,
    risk: ToolRisk,
    signal?: AbortSignal,
  ): Promise<PermissionDecision> {
    const display = formatToolInput(
      { name: tool.name, risk, inputSchema: tool.inputSchema, input: call.input },
      { maxLines: Infinity, maxValueChars: Infinity, maxDepth: Infinity },
    );
    const block: TranscriptInteractionBlock = {
      id: this.id("interaction"),
      kind: "interaction",
      interaction: "permission",
      toolName: sanitizeTerminalText(tool.name),
      risk,
      lines: display.lines,
      allowSession: risk !== "dangerous",
      status: "pending",
    };
    return this.openPermission(block, signal);
  }

  requestConfirm(message: string, signal?: AbortSignal): Promise<boolean> {
    const block: TranscriptInteractionBlock = {
      id: this.id("interaction"),
      kind: "interaction",
      interaction: "confirm",
      message: sanitizeTerminalText(message),
      status: "pending",
    };
    return this.openConfirm(block, signal);
  }

  resolveInteraction(answer: TuiInteractionAnswer): void {
    const pending = this.#pendingInteraction;
    if (!pending) return;
    if (answer === "s" && (pending.kind !== "permission" || !pending.allowSession)) return;

    if (pending.kind === "permission") {
      const decision = answer === "y" ? "allow_once" : answer === "s" ? "allow_session" : "deny";
      this.settleInteraction(pending.id, "resolved", answer, decision);
    } else if (answer !== "s") {
      this.settleInteraction(pending.id, "resolved", answer, answer === "y");
    }
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.cancelPendingInteraction();
    this.clearActivity();
    this.update({ pendingInteraction: undefined, running: false });
    this.#listeners.clear();
  }

  apply(event: RuntimeEvent): void {
    const data = event.data ?? {};
    switch (event.type) {
      case "turn.started":
        this.#activeAssistant = undefined;
        this.#toolPreview = undefined;
        this.clearActivity();
        this.addBlock({
          id: event.turnId ? `user-${event.turnId}` : this.id("user"),
          kind: "user",
          text: String(data.input ?? ""),
        });
        this.showActivity("thinking", "");
        this.update({ running: true });
        break;
      case "provider.started":
        this.#activeAssistant = undefined;
        this.#toolPreview = undefined;
        this.showActivity("thinking", "");
        break;
      case "provider.reasoning_delta": {
        const next = `${this.activityText()}${String(data.text ?? "")}`.replace(/\s+/g, " ").trim();
        this.showActivity("thinking", next);
        break;
      }
      case "provider.delta":
        this.appendAssistant(String(data.text ?? ""), event.turnId);
        break;
      case "provider.tool_call_start":
        this.#toolPreview = {
          name: sanitizeTerminalText(String(data.name ?? "tool")),
          argumentsText: "",
        };
        this.showActivity("tool", this.#i18n.messages.terminal.preparing(this.#toolPreview.name));
        break;
      case "provider.tool_call_delta":
        if (this.#toolPreview) {
          this.#toolPreview.argumentsText += String(data.argumentsDelta ?? "");
          this.showActivity(
            "tool",
            `${this.#i18n.messages.terminal.preparing(this.#toolPreview.name)} ${this.#toolPreview.argumentsText.replace(/\s+/g, " ").trim()}`,
          );
        }
        break;
      case "provider.tool_call_end":
        this.#toolPreview = undefined;
        this.clearActivity();
        break;
      case "provider.completed":
        this.#activeAssistant = undefined;
        this.clearActivity();
        break;
      case "provider.retry":
        this.discardActiveAssistant();
        this.clearActivity();
        this.update({ phase: "thinking" });
        break;
      case "tool.started": {
        const name = sanitizeTerminalText(String(data.name ?? "tool"));
        const summary = sanitizeTerminalText(String(data.summary ?? ""));
        this.clearActivity();
        this.addBlock({
          id: this.id("tool"),
          kind: "tool",
          text: `◇ ${name}${summary ? `  ${summary}` : ""}`,
          failed: false,
        });
        this.update({ phase: "tool" });
        break;
      }
      case "tool.completed": {
        const failed = Boolean(data.isError);
        this.addBlock({
          id: this.id("tool"),
          kind: "tool",
          text: `${failed ? "✗" : "✓"} ${sanitizeTerminalText(String(data.name ?? "tool"))}  ${String(data.durationMs ?? "?")}ms`,
          failed,
        });
        break;
      }
      case "permission.review_started":
        this.showActivity(
          "reviewing",
          this.#i18n.messages.terminal.reviewing(sanitizeTerminalText(String(data.name ?? "tool"))),
        );
        break;
      case "permission.review_completed":
      case "permission.review_failed":
        this.clearActivity();
        this.update({ phase: "tool" });
        break;
      case "context.prepared": {
        const estimated = Number(data.estimatedTokens ?? 0);
        const budget = Number(data.budget ?? 0);
        const contextPercent =
          budget > 0 ? Math.max(0, Math.min(100, (estimated / budget) * 100)) : 0;
        this.update({ contextPercent });
        break;
      }
      case "turn.completed":
        this.clearActivity();
        this.update({
          phase: "idle",
          running: false,
          turnUsage: {
            inputTokens: Number(data.inputTokens ?? 0),
            outputTokens: Number(data.outputTokens ?? 0),
            durationMs: Number(data.durationMs ?? 0),
          },
        });
        break;
      case "turn.failed":
        this.clearActivity();
        this.addError(String(data.message ?? "failed"));
        this.update({ phase: "failed", running: false });
        break;
      case "plugin.failed":
        this.addError(`plugin: ${String(data.message ?? data.path ?? "failed")}`);
        break;
      case "plugin.unavailable":
      case "plugin.restart_required":
        this.addInfo(
          `plugin: ${String(data.reason ?? data.message ?? data.path ?? "unavailable")}`,
        );
        break;
    }
  }

  private showActivity(phase: TuiPhase, text: string): void {
    const blocks = [...this.#snapshot.blocks];
    if (this.#activeActivity) {
      const index = blocks.findIndex((block) => block.id === this.#activeActivity);
      if (index >= 0) {
        blocks[index] = { id: this.#activeActivity, kind: "activity", phase, text };
        this.update({ blocks, phase });
        return;
      }
    }

    const id = this.id("activity");
    this.#activeActivity = id;
    this.update({ blocks: [...blocks, { id, kind: "activity", phase, text }], phase });
  }

  private activityText(): string {
    if (!this.#activeActivity) return "";
    const block = this.#snapshot.blocks.find((candidate) => candidate.id === this.#activeActivity);
    return block?.kind === "activity" ? block.text : "";
  }

  private clearActivity(): void {
    if (!this.#activeActivity) return;
    const id = this.#activeActivity;
    this.#activeActivity = undefined;
    this.update({ blocks: this.#snapshot.blocks.filter((block) => block.id !== id) });
  }

  private appendAssistant(text: string, turnId: string | undefined): void {
    if (!text) return;
    const id =
      this.#activeAssistant ??
      (turnId ? `assistant-${turnId}-${this.#nextId++}` : this.id("assistant"));
    const blocks = [...this.#snapshot.blocks];

    if (!this.#activeAssistant && this.#activeActivity) {
      const activityIndex = blocks.findIndex((block) => block.id === this.#activeActivity);
      this.#activeActivity = undefined;
      this.#activeAssistant = id;
      if (activityIndex >= 0) {
        blocks[activityIndex] = { id, kind: "assistant", markdown: text };
        this.update({ blocks, phase: "rendering" });
        return;
      }
    }

    this.#activeAssistant = id;
    const index = blocks.findIndex((block) => block.id === id);
    if (index >= 0) {
      const current = blocks[index];
      if (current?.kind === "assistant")
        blocks[index] = { ...current, markdown: `${current.markdown}${text}` };
    } else blocks.push({ id, kind: "assistant", markdown: text });
    this.update({ blocks, phase: "rendering" });
  }

  private discardActiveAssistant(): void {
    if (!this.#activeAssistant) return;
    const id = this.#activeAssistant;
    this.#activeAssistant = undefined;
    this.update({ blocks: this.#snapshot.blocks.filter((block) => block.id !== id) });
  }

  private addBlock(block: TranscriptBlock): void {
    this.update({ blocks: [...this.#snapshot.blocks, block] });
  }

  private id(prefix: string): string {
    return `${prefix}-${this.#nextId++}`;
  }

  private openPermission(
    block: Extract<TranscriptInteractionBlock, { interaction: "permission" }>,
    signal?: AbortSignal,
  ): Promise<PermissionDecision> {
    if (!this.canOpenInteraction(signal)) return Promise.resolve("deny");
    return new Promise<PermissionDecision>((resolve) => {
      const abort = () => this.settleInteraction(block.id, "cancelled", undefined, "deny");
      signal?.addEventListener("abort", abort, { once: true });
      const cleanup = signal ? () => signal.removeEventListener("abort", abort) : undefined;
      this.#pendingInteraction = {
        id: block.id,
        kind: "permission",
        allowSession: block.allowSession,
        fallback: "deny",
        resolve: (decision) => resolve(decision as PermissionDecision),
        ...(cleanup ? { cleanup } : {}),
      };
      this.update({
        blocks: [...this.#snapshot.blocks, block],
        pendingInteraction: {
          id: block.id,
          kind: "permission",
          allowSession: block.allowSession,
        },
      });
    });
  }

  private openConfirm(
    block: Extract<TranscriptInteractionBlock, { interaction: "confirm" }>,
    signal?: AbortSignal,
  ): Promise<boolean> {
    if (!this.canOpenInteraction(signal)) return Promise.resolve(false);
    return new Promise<boolean>((resolve) => {
      const abort = () => this.settleInteraction(block.id, "cancelled", undefined, false);
      signal?.addEventListener("abort", abort, { once: true });
      const cleanup = signal ? () => signal.removeEventListener("abort", abort) : undefined;
      this.#pendingInteraction = {
        id: block.id,
        kind: "confirm",
        allowSession: false,
        fallback: false,
        resolve: (decision) => resolve(Boolean(decision)),
        ...(cleanup ? { cleanup } : {}),
      };
      this.update({
        blocks: [...this.#snapshot.blocks, block],
        pendingInteraction: { id: block.id, kind: "confirm", allowSession: false },
      });
    });
  }

  private canOpenInteraction(signal?: AbortSignal): boolean {
    if (this.#closed || signal?.aborted) return false;
    if (!this.#pendingInteraction) return true;
    this.addError("interaction: another confirmation is already pending");
    return false;
  }

  private settleInteraction(
    id: string,
    status: TuiInteractionStatus,
    answer: TuiInteractionAnswer | undefined,
    decision: PermissionDecision | boolean,
  ): void {
    const pending = this.#pendingInteraction;
    if (!pending || pending.id !== id) return;
    this.#pendingInteraction = undefined;
    const blocks = this.#snapshot.blocks.map((block): TranscriptBlock => {
      if (block.kind !== "interaction" || block.id !== id) return block;
      if (block.interaction === "permission") {
        if (answer) return { ...block, status, answer };
        const { answer: _answer, ...withoutAnswer } = block;
        return { ...withoutAnswer, status };
      }
      if (answer === "y" || answer === "n") return { ...block, status, answer };
      const { answer: _answer, ...withoutAnswer } = block;
      return { ...withoutAnswer, status };
    });
    this.update({ blocks, pendingInteraction: undefined });
    pending.cleanup?.();
    pending.resolve(decision);
  }

  private cancelPendingInteraction(): void {
    const pending = this.#pendingInteraction;
    if (!pending) return;
    this.settleInteraction(pending.id, "cancelled", undefined, pending.fallback);
  }

  private update(patch: SnapshotPatch): void {
    const next = { ...this.#snapshot, ...patch } as TuiSnapshot;
    if (patch.pendingInteraction === undefined && Object.hasOwn(patch, "pendingInteraction")) {
      delete next.pendingInteraction;
    }
    this.#snapshot = next;
    for (const listener of this.#listeners) listener();
  }
}
