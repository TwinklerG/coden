import { describe, expect, it } from "vitest";
import logUpdate from "../node_modules/ink/build/log-update.js";
import { VirtualTerminal } from "./helpers/virtual-terminal.js";

function createRenderer(columns = 20, rows = 6) {
  const terminal = new VirtualTerminal(columns, rows);
  const stream = {
    isTTY: true,
    write(chunk: string | Uint8Array) {
      terminal.apply(String(chunk));
      return true;
    },
  } as unknown as NodeJS.WriteStream;
  return { terminal, update: logUpdate.create(stream, { showCursor: true }) };
}

describe("patched Ink cursor rendering", () => {
  it("positions full-screen output without a trailing newline", () => {
    const { terminal, update } = createRenderer();
    update.setCursorPosition({ x: 2, y: 1 });
    update("aaa\nbbb\nccc");

    expect(terminal.cursor).toEqual({ row: 1, column: 2 });
    expect(terminal.cursorVisible).toBe(true);
  });

  it("positions cursor-only updates from the actual final output row", () => {
    const { terminal, update } = createRenderer();
    update.setCursorPosition({ x: 2, y: 1 });
    update("aaa\nbbb\nccc");

    update.setCursorPosition({ x: 1, y: 2 });
    update("aaa\nbbb\nccc");

    expect(terminal.cursor).toEqual({ row: 2, column: 1 });
    expect(terminal.cursorVisible).toBe(true);
  });

  it("hides and restores the native cursor without changing output", () => {
    const { terminal, update } = createRenderer();
    update.setCursorPosition({ x: 2, y: 1 });
    update("aaa\nbbb\nccc");
    update.setCursorPosition(undefined);
    update("aaa\nbbb\nccc");
    expect(terminal.cursorVisible).toBe(false);

    update.setCursorPosition({ x: 1, y: 2 });
    update("aaa\nbbb\nccc");
    expect(terminal.cursor).toEqual({ row: 2, column: 1 });
    expect(terminal.cursorVisible).toBe(true);
  });

  it("preserves positioning for output with a trailing newline", () => {
    const { terminal, update } = createRenderer();
    update.setCursorPosition({ x: 1, y: 2 });
    update("aaa\nbbb\nccc\n");

    expect(terminal.cursor).toEqual({ row: 2, column: 1 });
    expect(terminal.cursorVisible).toBe(true);
  });
});
