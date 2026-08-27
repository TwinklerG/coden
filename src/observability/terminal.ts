import * as readline from "node:readline";
import pc from "picocolors";
import type { EventBus, RuntimeEvent } from "../core/events.js";

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
    if (event.type === "provider.started") this.startSpinner();
    if (event.type === "provider.delta") {
      this.stopSpinner();
      const text = String(event.data?.text ?? "");
      if (this.tty) this.stdout.write(text);
      else this.pendingText += text;
    }
    if (event.type === "provider.completed") {
      this.stopSpinner();
      if (!this.tty && this.pendingText) {
        this.stdout.write(this.pendingText);
        this.pendingText = "";
      }
    }
    if (event.type === "provider.retry" || event.type === "turn.failed") {
      this.stopSpinner();
      this.pendingText = "";
    }
    if (event.type === "tool.started") {
      this.stopSpinner();
      this.status(`tool ${String(event.data?.name)} started`);
    }
    if (event.type === "tool.completed")
      this.status(
        `tool ${String(event.data?.name)} ${event.data?.isError ? "failed" : "completed"} (${String(event.data?.durationMs)}ms)`,
      );
    if (event.type === "provider.retry" && this.options.verbose)
      this.status(`provider retry ${String(event.data?.attempt)}`);
    if (event.type === "turn.completed") {
      this.stopSpinner();
      this.stdout.write("\n");
      this.status(
        `done: ${String(event.data?.tools)} tools, ${String(event.data?.durationMs)}ms, ${String(event.data?.inputTokens)}/${String(event.data?.outputTokens)} tokens`,
      );
    }
    if (event.type === "turn.failed") {
      this.stopSpinner();
      this.status(pc.red(`failed: ${String(event.data?.message)}`));
    }
  }
  private status(message: string): void {
    this.stderr.write(this.tty ? `${pc.dim(message)}\n` : `[coden] ${message}\n`);
  }
  private startSpinner(): void {
    if (!this.tty || this.spinner) {
      if (!this.tty && this.options.verbose) this.status("requesting model");
      return;
    }
    const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
    this.spinner = setInterval(() => {
      readline.clearLine(this.stderr, 0);
      readline.cursorTo(this.stderr, 0);
      this.stderr.write(`${frames[this.frame++ % frames.length]} thinking`);
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
    this.stopSpinner();
  }
}
