import { describe, expect, it } from "vitest";
import { EditorInputDecoder } from "../src/cli/editor-input.js";

describe("editor input decoder", () => {
  it("recognizes ordinary Enter", () => {
    const decoder = new EditorInputDecoder();
    expect(decoder.push("\r\n")).toEqual([
      { type: "key", key: "enter" },
      { type: "key", key: "enter" },
    ]);
  });

  it.each(["\u001b[13;2u", "\u001b[27;2;13~", "\u001b\r", "\u001b\n"])(
    "recognizes Shift+Enter sequence %j",
    (sequence) => {
      const decoder = new EditorInputDecoder();
      expect(decoder.push(sequence)).toEqual([{ type: "key", key: "shift-enter" }]);
    },
  );

  it("buffers escape and UTF-8 sequences split across chunks", () => {
    const decoder = new EditorInputDecoder();
    const chinese = Buffer.from("你", "utf8");
    expect(decoder.push(Buffer.from("\u001b[20"))).toEqual([]);
    expect(decoder.push(Buffer.concat([Buffer.from("0~"), chinese.subarray(0, 1)]))).toEqual([]);
    expect(
      decoder.push(Buffer.concat([chinese.subarray(1), Buffer.from("\n好\u001b[201~")])),
    ).toEqual([{ type: "paste", text: "你\n好" }]);
  });

  it("buffers a split bracketed paste end delimiter", () => {
    const decoder = new EditorInputDecoder();
    expect(decoder.push("\u001b[200~abc\u001b[20")).toEqual([]);
    expect(decoder.push("1~")).toEqual([{ type: "paste", text: "abc" }]);
  });

  it("normalizes and sanitizes bracketed paste without emitting Enter", () => {
    const decoder = new EditorInputDecoder();
    expect(decoder.push("\u001b[200~a\r\nb\rc\t\u0000\u001b[31m\u001b[201~")).toEqual([
      { type: "paste", text: "a\nb\nc\t" },
    ]);
  });

  it("maps editing controls and ignores unknown CSI sequences", () => {
    const decoder = new EditorInputDecoder();
    expect(decoder.push("x\u001b[A\u007f\u001b[999~y")).toEqual([
      { type: "text", text: "x" },
      { type: "key", key: "up" },
      { type: "key", key: "backspace" },
      { type: "text", text: "y" },
    ]);
  });
});
