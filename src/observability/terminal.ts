import * as readline from "node:readline";
import pc from "picocolors";
import type { EventBus, RuntimeEvent } from "../core/events.js";

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
  private spinner: NodeJS.Timeout | undefined;
  private frame = 0;
  private providerStartedAt: number | undefined;
  private reasoningText = "";
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
      options.tty ?? Boolean(process.stderr.isTTY && !process.env.NO_COLOR && !process.env.CI);
    events.on((event) => this.render(event));
  }
  private render(event: RuntimeEvent): void {
    if (event.type === "provider.started") this.startProviderAttempt();
    if (event.type === "provider.reasoning_delta") {
      const text = String(event.data?.text ?? "");
      if (this.tty && this.providerStartedAt !== undefined && !this.contentStarted && text) {
        this.reasoningText += text;
        this.renderThinkingLine();
      }
    }
    if (event.type === "provider.delta") {
      const text = String(event.data?.text ?? "");
      if (text && !this.contentStarted) this.finishThinking();
      if (this.tty) this.stdout.write(text);
      else this.pendingText += text;
    }
    if (event.type === "provider.completed") {
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
      this.status(`tool ${String(event.data?.name)} started`);
    }
    if (event.type === "tool.completed")
      this.status(
        `tool ${String(event.data?.name)} ${event.data?.isError ? "failed" : "completed"} (${String(event.data?.durationMs)}ms)`,
      );
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
  private startProviderAttempt(): void {
    this.endProviderAttempt();
    this.providerStartedAt = Date.now();
    this.startSpinner();
  }
  private endProviderAttempt(): void {
    this.stopSpinner();
    this.providerStartedAt = undefined;
    this.reasoningText = "";
    this.contentStarted = false;
  }
  private finishThinking(): void {
    const startedAt = this.providerStartedAt;
    const hadReasoning = Boolean(this.normalizedReasoning());
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
  private renderThinkingLine(): void {
    const normalized = this.normalizedReasoning();
    if (!normalized) return;
    const columns = (this.stderr as NodeJS.WritableStream & { columns?: number }).columns ?? 80;
    const frame = SPINNER_FRAMES[this.frame++ % SPINNER_FRAMES.length] ?? "";
    const visible = this.truncateTail(normalized, Math.max(0, columns - 2));
    readline.clearLine(this.stderr, 0);
    readline.cursorTo(this.stderr, 0);
    this.stderr.write(pc.dim(`${frame} ${visible}`));
  }
  private truncateTail(text: string, maxColumns: number): string {
    if (maxColumns <= 0) return "";
    const characters = Array.from(text);
    const width = (character: string) => ((character.codePointAt(0) ?? 0) <= 0xff ? 1 : 2);
    const total = characters.reduce((sum, character) => sum + width(character), 0);
    if (total <= maxColumns) return text;
    const kept: string[] = [];
    let used = 1;
    for (let index = characters.length - 1; index >= 0; index--) {
      const character = characters[index];
      if (character === undefined || used + width(character) > maxColumns) break;
      kept.unshift(character);
      used += width(character);
    }
    return `…${kept.join("")}`;
  }
  private startSpinner(): void {
    if (!this.tty || this.spinner) {
      if (!this.tty && this.options.verbose) this.status("requesting model");
      return;
    }
    this.spinner = setInterval(() => {
      if (this.normalizedReasoning()) {
        this.renderThinkingLine();
        return;
      }
      readline.clearLine(this.stderr, 0);
      readline.cursorTo(this.stderr, 0);
      const frame = SPINNER_FRAMES[this.frame++ % SPINNER_FRAMES.length] ?? "";
      this.stderr.write(`${frame} thinking`);
    }, 80);
  }
  private stopSpinner(): void {
    if (!this.spinner) return;
    clearInterval(this.spinner);
    this.spinner = undefined;
    readline.clearLine(this.stderr, 0);
    readline.cursorTo(this.stderr, 0);
  }
  dispose(): void {
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
