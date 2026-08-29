import { EventEmitter } from "node:events";
import { PassThrough, Writable } from "node:stream";
import { describe, expect, it } from "vitest";
import { MultilineEditor } from "../src/cli/multiline-editor.js";
import { VirtualTerminal } from "./helpers/virtual-terminal.js";

class FakeInput extends PassThrough {
  isRaw = false;
  readonly rawTransitions: boolean[] = [];

  setRawMode(mode: boolean): this {
    this.isRaw = mode;
    this.rawTransitions.push(mode);
    return this;
  }
}

class Sink extends Writable {
  value = "";
  isTTY = true;
  columns: number;

  constructor(
    columns: number,
    private readonly screen: VirtualTerminal,
  ) {
    super();
    this.columns = columns;
  }

  _write(
    chunk: Buffer | string,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ): void {
    const text = chunk.toString();
    this.value += text;
    this.screen.apply(text);
    callback();
  }
}

function editorHarness(columns: number, initiallyRaw = false) {
  const input = new FakeInput();
  input.isRaw = initiallyRaw;
  const screen = new VirtualTerminal(columns);
  const output = new Sink(columns, screen);
  const resize = new EventEmitter();
  const signals = new EventEmitter();
  const terminated: Array<"SIGHUP" | "SIGTERM"> = [];
  const editor = new MultilineEditor({
    input: input as unknown as import("../src/cli/multiline-editor.js").EditorInputStream,
    output,
    resizeEmitter: resize as unknown as Pick<NodeJS.Process, "on" | "removeListener">,
    signalEmitter: signals as unknown as Pick<NodeJS.Process, "on" | "removeListener">,
    terminate: (signal) => terminated.push(signal),
    term: "xterm-256color",
  });
  return {
    editor,
    input,
    output,
    screen,
    resize,
    signals,
    terminated,
    rawTransitions: input.rawTransitions,
    listenerCounts: () => ({
      data: input.listenerCount("data"),
      resize: resize.listenerCount("SIGWINCH"),
    }),
  };
}

describe("MultilineEditor", () => {
  it("renders multiline input with two-space continuation prefixes", async () => {
    const h = editorHarness(12);
    const result = h.editor.read();
    h.input.write("first\u001b[13;2usecond\r");
    await expect(result).resolves.toEqual({ type: "submit", text: "first\nsecond" });
    expect(h.screen.lines().slice(0, 2)).toEqual(["> first", "  second"]);
  });

  it("renders Chinese characters at display width", async () => {
    const h = editorHarness(12);
    const result = h.editor.read();
    h.input.write("中a");
    expect(h.screen.lines()).toEqual(["> 中a"]);
    expect(h.screen.cursor).toEqual({ row: 0, column: 5 });
    h.input.write("\r");
    await expect(result).resolves.toEqual({ type: "submit", text: "中a" });
  });

  it("renders emoji and combining clusters at display width", async () => {
    const h = editorHarness(12);
    const result = h.editor.read();
    h.input.write("e\u0301👨‍👩‍👧‍👦");
    expect(h.screen.lines()).toEqual(["> é👨‍👩‍👧‍👦"]);
    expect(h.screen.cursor).toEqual({ row: 0, column: 5 });
    h.input.write("\r");
    await expect(result).resolves.toEqual({ type: "submit", text: "e\u0301👨‍👩‍👧‍👦" });
  });

  it("inserts bracketed paste without submitting and then submits once", async () => {
    const h = editorHarness(20);
    const result = h.editor.read();
    h.input.write("\u001b[200~a\nb\u001b[201~");
    let settled = false;
    void result.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    h.input.write("\r");
    await expect(result).resolves.toEqual({ type: "submit", text: "a\nb" });
    expect(h.screen.lines().slice(0, 2)).toEqual(["> a", "  b"]);
  });

  it("clears a nonempty draft on Ctrl+C and exits on Ctrl+C when empty", async () => {
    const h = editorHarness(20);
    const result = h.editor.read();
    h.input.write("draft\u0003");
    expect(h.screen.lines()).toEqual(["> "]);
    h.input.write("\u0003");
    await expect(result).resolves.toEqual({ type: "eof" });
  });

  it("restores raw mode and bracketed paste after submission", async () => {
    const h = editorHarness(20, false);
    const result = h.editor.read();
    h.input.write("ok\r");
    await result;
    expect(h.rawTransitions).toEqual([true, false]);
    expect(h.output.value).toContain("\u001b[?2004h");
    expect(h.output.value).toContain("\u001b[?2004l");
    expect(h.listenerCounts()).toEqual({ data: 0, resize: 0 });
  });

  it("wraps and redraws after resize without stale rows", async () => {
    const h = editorHarness(8);
    const result = h.editor.read();
    h.input.write("abcdefgh");
    expect(h.screen.lines()).toEqual(["> abcdef", "  gh"]);
    h.output.columns = 20;
    h.screen.resize(20);
    h.resize.emit("SIGWINCH");
    expect(h.screen.lines()).toEqual(["> abcdefgh"]);
    h.input.write("\r");
    await expect(result).resolves.toEqual({ type: "submit", text: "abcdefgh" });
  });

  it("restores the cursor after Up across a blank line", async () => {
    const h = editorHarness(20);
    const result = h.editor.read();
    h.input.write("a\u001b[13;2u\u001b[13;2ub\u001b[A");
    expect(h.screen.cursor).toEqual({ row: 1, column: 2 });
    h.input.write("x\r");
    await expect(result).resolves.toEqual({ type: "submit", text: "a\nx\nb" });
    expect(h.screen.lines().slice(0, 3)).toEqual(["> a", "  x", "  b"]);
  });

  it("Ctrl+D deletes forward and exits only when empty", async () => {
    const h = editorHarness(20);
    const result = h.editor.read();
    h.input.write("ab\u001b[D\u0004");
    expect(h.screen.lines()).toEqual(["> a"]);
    h.input.write("\u007f\u0004");
    await expect(result).resolves.toEqual({ type: "eof" });
  });

  it("continues on a trailing backslash", async () => {
    const h = editorHarness(20);
    const result = h.editor.read();
    h.input.write("first\\\rsecond\r");
    await expect(result).resolves.toEqual({ type: "submit", text: "first\nsecond" });
    expect(h.screen.lines().slice(0, 2)).toEqual(["> first", "  second"]);
  });

  it("retains editable history across read calls", async () => {
    const h = editorHarness(20);
    const first = h.editor.read();
    h.input.write("one\r");
    await first;
    const second = h.editor.read();
    h.input.write("\u001b[A!\r");
    await expect(second).resolves.toEqual({ type: "submit", text: "one!" });
    expect(h.screen.lines().at(-1)).toBe("> one!");
  });

  it("dispose resolves EOF and restores the terminal", async () => {
    const h = editorHarness(20);
    const result = h.editor.read();
    h.input.write("draft");
    h.editor.dispose();
    await expect(result).resolves.toEqual({ type: "eof" });
    expect(h.rawTransitions.at(-1)).toBe(false);
    expect(h.listenerCounts()).toEqual({ data: 0, resize: 0 });
  });

  it("rejects concurrent read calls", async () => {
    const h = editorHarness(20);
    const first = h.editor.read();
    await expect(h.editor.read()).rejects.toThrow("already active");
    h.editor.dispose();
    await expect(first).resolves.toEqual({ type: "eof" });
  });

  it.each(["SIGHUP", "SIGTERM"] as const)("cleans up before %s termination", async (signal) => {
    const h = editorHarness(20);
    const result = h.editor.read();
    h.signals.emit(signal);
    await Promise.resolve();
    expect(h.rawTransitions.at(-1)).toBe(false);
    expect(h.terminated).toEqual([signal]);
    await expect(result).resolves.toEqual({ type: "eof" });
  });

  it("treats external SIGINT as EOF and removes listeners", async () => {
    const h = editorHarness(20);
    const result = h.editor.read();
    h.signals.emit("SIGINT");
    await expect(result).resolves.toEqual({ type: "eof" });
    expect(h.rawTransitions.at(-1)).toBe(false);
    expect(h.listenerCounts()).toEqual({ data: 0, resize: 0 });
  });
});
