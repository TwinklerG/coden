import * as readline from "node:readline";
import pc from "picocolors";
import type { EventBus, RuntimeEvent } from "../core/events.js";
import { MarkdownStreamRenderer } from "./markdown.js";
import { displayWidth, sanitizeTerminalText, truncateDisplay } from "./terminal-text.js";

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"] as const;

export interface TerminalOptions {
  stdout?: NodeJS.WritableStream;
  stderr?: NodeJS.WritableStream;
  tty?: boolean;
  verbose?: boolean;
  printMode?: boolean;
}
export class TerminalRenderer {
  private readonly stdout: NodeJS.WritableStream;
  private readonly stderr: NodeJS.WritableStream;
  private readonly tty: boolean;
  private readonly markdown: MarkdownStreamRenderer;
  private spinner: NodeJS.Timeout | undefined;
  private frame = 0;
  private providerStartedAt: number | undefined;
  private reviewingTool: string | undefined;
  private reasoningText = "";
  private readonly toolCallPreviews = new Map<number, { name: string; argumentsText: string }>();
  private activeToolCallIndex: number | undefined;
  private contentStarted = false;
  // Non-TTY output is buffered until the provider attempt succeeds so that a
  // failed stream attempt followed by a retry cannot corrupt pipeline output.
  private pendingText = "";
  constructor(
    events: EventBus,
    private readonly options: TerminalOptions = {},
  ) {
    this.stdout = options.stdout ?? process.stdout;
    this.stderr = options.stderr ?? process.stderr;
    this.tty =
      !options.printMode &&
      (options.tty ?? Boolean(process.stderr.isTTY && !process.env.NO_COLOR && !process.env.CI));
    this.markdown = new MarkdownStreamRenderer(
      (text) => this.stdout.write(text),
      () => {
        const stdoutColumns = (this.stdout as NodeJS.WritableStream & { columns?: number }).columns;
        const stderrColumns = (this.stderr as NodeJS.WritableStream & { columns?: number }).columns;
        return stdoutColumns ?? stderrColumns ?? 80;
      },
    );
    events.on((event) => this.render(event));
  }
  private render(event: RuntimeEvent): void {
    if (event.type === "permission.review_started") {
      this.endProviderAttempt();
      this.reviewingTool = sanitizeTerminalText(String(event.data?.name ?? "tool"));
      if (this.tty) {
        this.startSpinner();
        this.renderActivityLine();
      } else this.status(`reviewing ${this.reviewingTool}…`);
    }
    if (event.type === "permission.review_completed") {
      this.reviewingTool = undefined;
      this.stopSpinner();
      const name = sanitizeTerminalText(String(event.data?.name ?? "tool"));
      const reason = sanitizeTerminalText(String(event.data?.reason ?? ""));
      const decision = event.data?.decision;
      if (decision === "allow")
        this.reviewStatus(
          this.options.verbose
            ? `AI approved ${name} [${String(event.data?.strictness ?? "medium")}] — ${reason}`
            : `AI approved ${name}`,
        );
      else this.reviewStatus(`AI requested human review — ${reason}`);
    }
    if (event.type === "permission.review_failed") {
      this.reviewingTool = undefined;
      this.stopSpinner();
      this.reviewStatus(
        `AI review unavailable — ${sanitizeTerminalText(String(event.data?.message ?? "failed"))}; human approval required`,
      );
    }
    if (event.type === "provider.started") this.startProviderAttempt();
    if (event.type === "provider.reasoning_delta") {
      const text = String(event.data?.text ?? "");
      if (this.tty && this.providerStartedAt !== undefined && !this.contentStarted && text) {
        this.reasoningText += text;
        this.renderActivityLine();
      }
    }
    if (event.type === "provider.tool_call_start" && this.tty) {
      const index = Number(event.data?.index);
      const name = String(event.data?.name ?? "tool");
      if (Number.isInteger(index)) this.startToolCallPreview(index, name);
    }
    if (event.type === "provider.tool_call_delta" && this.tty) {
      const index = Number(event.data?.index);
      const text = String(event.data?.argumentsDelta ?? "");
      if (Number.isInteger(index) && text) this.appendToolCallPreview(index, text);
    }
    if (event.type === "provider.tool_call_end" && this.tty) {
      const index = Number(event.data?.index);
      if (Number.isInteger(index)) this.endToolCallPreview(index);
    }
    if (event.type === "provider.delta") {
      const text = String(event.data?.text ?? "");
      if (text && !this.contentStarted) this.finishThinking();
      if (this.tty) {
        this.clearActivityLine();
        this.markdown.push(text);
        if (text) {
          this.startSpinner();
          this.renderActivityLine();
        }
      } else this.pendingText += text;
    }
    if (event.type === "provider.completed") {
      if (this.tty) {
        this.stopSpinner();
        this.markdown.complete();
      }
      if (!this.tty && this.pendingText) {
        this.stdout.write(this.pendingText);
        this.pendingText = "";
      }
      this.endProviderAttempt();
    }
    if (event.type === "provider.retry" || event.type === "turn.failed") {
      this.endProviderAttempt();
      this.pendingText = "";
    }
    if (event.type === "tool.started") {
      this.endProviderAttempt();
      const name = sanitizeTerminalText(String(event.data?.name ?? "tool"));
      if (this.tty) {
        const summary = sanitizeTerminalText(String(event.data?.summary ?? ""));
        this.toolStatus(`◇ ${name}${summary ? `  ${summary}` : ""}`);
      } else this.status(`tool ${name} started`);
    }
    if (event.type === "tool.completed") {
      const name = sanitizeTerminalText(String(event.data?.name ?? "tool"));
      const duration = String(event.data?.durationMs ?? "?");
      if (this.tty) {
        const failed = Boolean(event.data?.isError);
        this.toolStatus(`${failed ? "✗" : "✓"} ${name}  ${duration}ms`, failed);
      } else {
        this.status(`tool ${name} ${event.data?.isError ? "failed" : "completed"} (${duration}ms)`);
      }
    }
    if (event.type === "provider.retry" && this.options.verbose)
      this.status(`provider retry ${String(event.data?.attempt)}`);
    if (event.type === "turn.completed") {
      this.endProviderAttempt();
      this.stdout.write("\n");
      this.status(
        `done: ${String(event.data?.tools)} tools, ${String(event.data?.durationMs)}ms, ${String(event.data?.inputTokens)}/${String(event.data?.outputTokens)} tokens`,
      );
    }
    if (event.type === "turn.failed") {
      this.status(pc.red(`failed: ${String(event.data?.message)}`));
    }
    if (event.type === "plugin.loaded" && this.options.verbose) {
      this.status(`plugin loaded: ${pluginLabel(event)}`);
    }
    if (event.type === "plugin.failed") {
      this.status(pc.red(`plugin failed: ${pluginLabel(event)}${eventMessage(event)}`));
    }
    if (event.type === "plugin.unavailable") {
      this.status(pc.yellow(`plugin unavailable: ${pluginLabel(event)}${eventMessage(event)}`));
    }
    if (event.type === "plugin.restart_required") {
      this.status(
        pc.yellow(`plugin restart required: ${pluginLabel(event)}${eventMessage(event)}`),
      );
    }
  }
  private status(message: string): void {
    this.stderr.write(this.tty ? `${pc.dim(message)}\n` : `[coden] ${message}\n`);
  }
  private reviewStatus(message: string): void {
    const columns = (this.stderr as NodeJS.WritableStream & { columns?: number }).columns ?? 80;
    this.status(truncateDisplay(sanitizeTerminalText(message), columns));
  }
  private toolStatus(message: string, failed = false): void {
    const columns = (this.stderr as NodeJS.WritableStream & { columns?: number }).columns ?? 80;
    const visible = truncateDisplay(sanitizeTerminalText(message), columns);
    this.stderr.write(`${failed ? pc.red(visible) : pc.dim(visible)}\n`);
  }
  private startProviderAttempt(): void {
    this.endProviderAttempt();
    this.providerStartedAt = Date.now();
    this.startSpinner();
    this.renderActivityLine();
  }
  private endProviderAttempt(): void {
    this.stopSpinner();
    this.clearToolCallPreviews();
    this.markdown.reset();
    this.providerStartedAt = undefined;
    this.reasoningText = "";
    this.contentStarted = false;
  }
  private finishThinking(): void {
    const startedAt = this.providerStartedAt;
    const hadReasoning = Boolean(this.normalizedReasoning());
    this.clearToolCallPreviews();
    this.stopSpinner();
    this.contentStarted = true;
    if (this.tty && startedAt !== undefined && hadReasoning) {
      const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);
      this.stderr.write(`${pc.dim(`thought for ${seconds}s`)}\n`);
    }
  }
  private normalizedReasoning(): string {
    return this.reasoningText.replace(/\s+/g, " ").trim();
  }
  private startToolCallPreview(index: number, name: string): void {
    this.toolCallPreviews.set(index, { name, argumentsText: "" });
    this.activeToolCallIndex = index;
    this.startSpinner();
    this.renderActivityLine();
  }
  private appendToolCallPreview(index: number, text: string): void {
    const preview = this.toolCallPreviews.get(index);
    if (!preview) return;
    preview.argumentsText += text;
    this.activeToolCallIndex = index;
    this.renderActivityLine();
  }
  private endToolCallPreview(index: number): void {
    if (!this.toolCallPreviews.delete(index)) return;
    if (this.activeToolCallIndex === index) {
      this.activeToolCallIndex = [...this.toolCallPreviews.keys()].at(-1);
    }
    if (this.activeToolCallIndex === undefined && this.contentStarted) {
      this.stopSpinner();
      return;
    }
    this.renderActivityLine();
  }
  private clearToolCallPreviews(): void {
    this.toolCallPreviews.clear();
    this.activeToolCallIndex = undefined;
  }
  private renderActivityLine(): void {
    if (!this.tty || (this.providerStartedAt === undefined && !this.reviewingTool)) return;
    const columns = (this.stderr as NodeJS.WritableStream & { columns?: number }).columns ?? 80;
    const maxColumns = Math.max(0, columns - 2);
    const frame = SPINNER_FRAMES[this.frame++ % SPINNER_FRAMES.length] ?? "";
    const visible = this.currentActivityText(maxColumns);
    readline.clearLine(this.stderr, 0);
    readline.cursorTo(this.stderr, 0);
    this.stderr.write(pc.dim(`${frame} ${visible}`));
  }
  private currentActivityText(maxColumns: number): string {
    if (this.reviewingTool)
      return this.truncateTail(`reviewing ${this.reviewingTool}…`, maxColumns);
    const active =
      this.activeToolCallIndex === undefined
        ? undefined
        : this.toolCallPreviews.get(this.activeToolCallIndex);
    if (active) {
      const label = `preparing ${active.name}…`;
      const normalizedArguments = active.argumentsText.replace(/\s+/g, " ").trim();
      if (!normalizedArguments) return this.truncateTail(label, maxColumns);
      const argumentColumns = Math.max(0, maxColumns - displayWidth(label) - 1);
      if (argumentColumns === 0) return this.truncateTail(label, maxColumns);
      return `${label} ${this.truncateTail(normalizedArguments, argumentColumns)}`;
    }
    if (this.contentStarted) {
      const preview = this.markdown.preview();
      return preview === undefined ? "rendering…" : this.truncateTail(preview, maxColumns);
    }
    const reasoning = this.normalizedReasoning();
    return reasoning ? this.truncateTail(reasoning, maxColumns) : "thinking";
  }
  private truncateTail(text: string, maxColumns: number): string {
    return truncateDisplay(text, maxColumns, "tail");
  }
  private startSpinner(): void {
    if (!this.tty || this.spinner) {
      if (!this.tty && this.options.verbose) this.status("requesting model");
      return;
    }
    this.spinner = setInterval(() => {
      this.renderActivityLine();
    }, 80);
  }
  private clearActivityLine(): void {
    if (!this.tty) return;
    readline.clearLine(this.stderr, 0);
    readline.cursorTo(this.stderr, 0);
  }
  private stopSpinner(): void {
    if (!this.spinner) return;
    clearInterval(this.spinner);
    this.spinner = undefined;
    this.clearActivityLine();
  }
  dispose(): void {
    this.reviewingTool = undefined;
    this.endProviderAttempt();
  }
}

function pluginLabel(event: RuntimeEvent): string {
  const data = event.data ?? {};
  const scope = stringValue(data.scope);
  const packageName = stringValue(data.packageName);
  const version = stringValue(data.version ?? data.diskVersion);
  const name = stringValue(data.name);
  const path = stringValue(data.path);
  const source = stringValue(data.source);
  if (packageName)
    return `${scope ? `${scope} ` : ""}${packageName}${version ? `@${version}` : ""}`;
  if (name) return name;
  if (path) return `${scope ? `${scope} ` : ""}${path}`;
  if (source) return source;
  return "plugin";
}

function eventMessage(event: RuntimeEvent): string {
  const message = stringValue(event.data?.message ?? event.data?.reason);
  return message ? ` — ${message}` : "";
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
