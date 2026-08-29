import { EditorInputDecoder, type EditorInputEvent, type EditorKey } from "./editor-input.js";
import { layoutEditor } from "./editor-layout.js";
import { EditorState } from "./editor-state.js";

export interface EditorInputStream extends Omit<NodeJS.ReadStream, "isRaw" | "setRawMode"> {
  isRaw?: boolean;
  setRawMode(mode: boolean): EditorInputStream;
}

export interface EditorOutputStream extends NodeJS.WritableStream {
  columns?: number;
  isTTY?: boolean;
}

export interface MultilineEditorOptions {
  input?: EditorInputStream;
  output?: EditorOutputStream;
  resizeEmitter?: Pick<NodeJS.Process, "on" | "removeListener">;
  signalEmitter?: Pick<NodeJS.Process, "on" | "removeListener">;
  terminate?: (signal: "SIGHUP" | "SIGTERM") => void;
  term?: string;
}

export type MainInputResult = { type: "submit"; text: string } | { type: "eof" };

type ActiveRead = {
  decoder: EditorInputDecoder;
  resolve: (result: MainInputResult) => void;
  reject: (error: Error) => void;
  rawMode: boolean | undefined;
  data: (chunk: Buffer | string) => void;
  end: () => void;
  error: (error: Error) => void;
  resize: () => void;
  sigint: () => void;
  sighup: () => void;
  sigterm: () => void;
};

const BRACKETED_PASTE_ENABLE = "\u001b[?2004h";
const BRACKETED_PASTE_DISABLE = "\u001b[?2004l";

export class MultilineEditor {
  private readonly input: EditorInputStream;
  private readonly output: EditorOutputStream;
  private readonly resizeEmitter: Pick<NodeJS.Process, "on" | "removeListener">;
  private readonly signalEmitter: Pick<NodeJS.Process, "on" | "removeListener">;
  private readonly terminate: (signal: "SIGHUP" | "SIGTERM") => void;
  private readonly term: string | undefined;
  private readonly state = new EditorState();
  private active: ActiveRead | undefined;
  private disposed = false;
  private renderedRows = 0;
  private renderedCursorRow = 0;

  constructor(options: MultilineEditorOptions = {}) {
    this.input = options.input ?? (process.stdin as EditorInputStream);
    this.output = options.output ?? process.stderr;
    this.resizeEmitter = options.resizeEmitter ?? process;
    this.signalEmitter = options.signalEmitter ?? process;
    this.terminate = options.terminate ?? ((signal) => process.kill(process.pid, signal));
    this.term = options.term;
  }

  static supported(
    input: NodeJS.ReadStream,
    output: NodeJS.WritableStream,
    term?: string,
  ): boolean {
    const rawInput = input as Partial<EditorInputStream>;
    const terminalOutput = output as EditorOutputStream;
    return (
      input.isTTY === true &&
      terminalOutput.isTTY === true &&
      typeof rawInput.setRawMode === "function" &&
      (term ?? process.env.TERM) !== "dumb"
    );
  }

  read(): Promise<MainInputResult> {
    if (this.disposed) return Promise.reject(new Error("MultilineEditor is disposed"));
    if (this.active) return Promise.reject(new Error("MultilineEditor read is already active"));

    return new Promise<MainInputResult>((resolve, reject) => {
      const decoder = new EditorInputDecoder();
      const active: ActiveRead = {
        decoder,
        resolve,
        reject,
        rawMode: this.input.isRaw,
        data: (chunk) => this.handleEvents(decoder.push(chunk)),
        end: () => {
          this.handleEvents(decoder.end());
          this.finish({ type: "eof" });
        },
        error: (error) => this.fail(error),
        resize: () => this.redraw(),
        sigint: () => this.finish({ type: "eof" }),
        sighup: () => this.stopForSignal("SIGHUP"),
        sigterm: () => this.stopForSignal("SIGTERM"),
      };
      this.active = active;
      this.renderedRows = 0;
      this.renderedCursorRow = 0;
      this.state.reset();

      try {
        this.input.setRawMode(true);
        this.input.resume();
        this.output.write(BRACKETED_PASTE_ENABLE);
        this.install(active);
        this.redraw();
      } catch (error) {
        this.fail(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  dispose(): void {
    this.disposed = true;
    this.finish({ type: "eof" });
  }

  private install(active: ActiveRead): void {
    this.input.on("data", active.data);
    this.input.on("end", active.end);
    this.input.on("error", active.error);
    this.resizeEmitter.on("SIGWINCH", active.resize);
    this.signalEmitter.on("SIGINT", active.sigint);
    this.signalEmitter.on("SIGHUP", active.sighup);
    this.signalEmitter.on("SIGTERM", active.sigterm);
  }

  private cleanup(): ActiveRead | undefined {
    const active = this.active;
    if (!active) return undefined;
    this.active = undefined;
    this.input.removeListener("data", active.data);
    this.input.removeListener("end", active.end);
    this.input.removeListener("error", active.error);
    this.resizeEmitter.removeListener("SIGWINCH", active.resize);
    this.signalEmitter.removeListener("SIGINT", active.sigint);
    this.signalEmitter.removeListener("SIGHUP", active.sighup);
    this.signalEmitter.removeListener("SIGTERM", active.sigterm);
    this.output.write(BRACKETED_PASTE_DISABLE);
    this.input.setRawMode(active.rawMode ?? false);
    this.renderedRows = 0;
    this.renderedCursorRow = 0;
    return active;
  }

  private finish(result: MainInputResult): void {
    const active = this.cleanup();
    active?.resolve(result);
  }

  private fail(error: Error): void {
    const active = this.cleanup();
    active?.reject(error);
  }

  private stopForSignal(signal: "SIGHUP" | "SIGTERM"): void {
    this.finish({ type: "eof" });
    this.terminate(signal);
  }

  private handleEvents(events: EditorInputEvent[]): void {
    if (!this.active) return;
    for (const event of events) {
      if (!this.active) return;
      if (event.type === "text" || event.type === "paste") {
        this.state.insert(event.text);
        this.redraw();
      } else {
        this.handleKey(event.key);
      }
    }
  }

  private handleKey(key: EditorKey): void {
    if (!this.active) return;
    switch (key) {
      case "enter":
      case "shift-enter": {
        const result = this.state.enter(key === "shift-enter");
        if (result.type === "submit") {
          this.state.remember(result.text);
          this.redraw(layoutEditor(result.text, result.text.length, this.columns()));
          this.output.write("\n");
          this.finish({ type: "submit", text: result.text });
          return;
        }
        break;
      }
      case "left":
        this.state.moveHorizontal(-1);
        break;
      case "right":
        this.state.moveHorizontal(1);
        break;
      case "up":
        this.state.moveVertical(-1, this.columns());
        break;
      case "down":
        this.state.moveVertical(1, this.columns());
        break;
      case "home":
      case "ctrl-a":
        this.state.moveLineBoundary("start");
        break;
      case "end":
      case "ctrl-e":
        this.state.moveLineBoundary("end");
        break;
      case "backspace":
        this.state.backspace();
        break;
      case "delete":
        this.state.deleteForward();
        break;
      case "ctrl-d":
        if (this.state.endOfInput() === "eof") {
          this.finish({ type: "eof" });
          return;
        }
        break;
      case "ctrl-c":
        if (this.state.interrupt() === "eof") {
          this.finish({ type: "eof" });
          return;
        }
        break;
      case "ctrl-k":
        this.state.deleteToLineBoundary("end");
        break;
      case "ctrl-n":
        this.state.historyNext();
        break;
      case "ctrl-p":
        this.state.historyPrevious();
        break;
      case "ctrl-u":
        this.state.deleteToLineBoundary("start");
        break;
      case "ctrl-w":
        this.state.deleteWordBackward();
        break;
      case "alt-b":
        this.state.moveWord(-1);
        break;
      case "alt-f":
        this.state.moveWord(1);
        break;
      case "tab":
        this.state.insert("\t");
        break;
    }
    this.redraw();
  }

  private columns(): number {
    return this.output.columns ?? 80;
  }

  private redraw(layout = layoutEditor(this.state.text, this.state.cursor, this.columns())): void {
    if (!this.active) return;
    if (this.renderedRows > 0) {
      this.output.write("\r");
      if (this.renderedCursorRow > 0) this.output.write(`\u001b[${this.renderedCursorRow}A`);
      this.output.write("\u001b[J");
    }

    for (let index = 0; index < layout.rows.length; index++) {
      const row = layout.rows[index];
      if (!row) continue;
      this.output.write(`${row.prefix}${row.text}`);
      if (index < layout.rows.length - 1) this.output.write("\n");
    }

    const fromEnd = layout.rows.length - 1 - layout.cursor.row;
    if (fromEnd > 0) this.output.write(`\u001b[${fromEnd}A`);
    this.output.write("\r");
    if (layout.cursor.column > 0) this.output.write(`\u001b[${layout.cursor.column}C`);
    this.renderedRows = layout.rows.length;
    this.renderedCursorRow = layout.cursor.row;
  }
}
