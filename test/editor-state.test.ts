import { describe, expect, it } from "vitest";
import { EditorState } from "../src/cli/editor-state.js";

describe("editor state", () => {
  it("edits across line and grapheme boundaries", () => {
    const state = new EditorState();
    state.insert("a👨‍👩‍👧‍👦\n中");
    state.moveHorizontal(-1);
    state.backspace();
    expect(state.text).toBe("a👨‍👩‍👧‍👦中");
    state.moveHorizontal(-1);
    state.backspace();
    expect(state.text).toBe("a中");
  });

  it("moves and deletes combining marks as one grapheme", () => {
    const state = new EditorState();
    state.insert("e\u0301x");
    state.moveHorizontal(-1);
    state.backspace();
    expect(state.text).toBe("x");
  });

  it("preserves vertical movement across a line containing a tab", () => {
    const state = new EditorState();
    state.insert("a\tb\nxy");
    state.moveLineBoundary("start");
    state.moveHorizontal(1);
    state.moveHorizontal(1);
    state.moveVertical(1, 80);
    expect(state.cursor).toBe(6);
    state.moveVertical(-1, 80);
    expect(state.cursor).toBe(1);
  });

  it("inserts with Shift+Enter and continues on an odd trailing slash", () => {
    const shifted = new EditorState();
    shifted.insert("ab");
    expect(shifted.enter(true)).toEqual({ type: "continue" });
    expect(shifted.text).toBe("ab\n");

    const continued = new EditorState();
    continued.insert(`first${"\\".repeat(3)}`);
    expect(continued.enter(false)).toEqual({ type: "continue" });
    expect(continued.text).toBe(`first${"\\"}\n`);
  });

  it("collapses an even trailing slash run and submits", () => {
    const state = new EditorState();
    state.insert(`path${"\\".repeat(2)}`);
    expect(state.enter(false)).toEqual({ type: "submit", text: "path\\" });
  });

  it("does not interpret trailing slashes when the cursor is inside the draft", () => {
    const state = new EditorState();
    state.insert("a\\");
    state.moveHorizontal(-1);
    expect(state.enter(false)).toEqual({ type: "submit", text: "a\\" });
  });

  it("restores the unsent draft after editable history copies", () => {
    const state = new EditorState(["one", "two"]);
    state.insert("draft");
    state.moveVertical(-1, 80);
    expect(state.text).toBe("two");
    state.insert("!");
    state.moveVertical(1, 80);
    expect(state.text).toBe("draft");
    expect(state.entries).toEqual(["one", "two"]);
  });

  it("resets preferred column after recalling history", () => {
    const state = new EditorState(["abcdef\nxy"]);
    state.insert("a\tb\nxy");
    state.moveLineBoundary("start");
    state.moveHorizontal(-1);
    state.moveHorizontal(-1);
    state.moveVertical(1, 80);
    state.historyPrevious();
    state.moveVertical(-1, 80);
    expect(state.cursor).toBe(2);
  });

  it("resets preferred column after returning to the saved draft", () => {
    const state = new EditorState(["abcdef\nxy"]);
    state.insert("a\tb\nxy");
    state.moveLineBoundary("start");
    state.moveHorizontal(-1);
    state.moveHorizontal(-1);
    state.moveVertical(1, 80);
    state.historyPrevious();
    state.historyNext();
    state.moveVertical(-1, 80);
    expect(state.cursor).toBe(1);
  });

  it("implements the approved Ctrl+C and Ctrl+D behavior", () => {
    const state = new EditorState();
    expect(state.interrupt()).toBe("eof");
    state.insert("x");
    expect(state.interrupt()).toBe("cleared");
    expect(state.text).toBe("");
    state.insert("xy");
    state.moveHorizontal(-1);
    expect(state.endOfInput()).toBe("deleted");
    expect(state.text).toBe("x");
  });

  it.each([
    ["home", "ab\ncdef", 3],
    ["end", "ab\ncdef", 7],
  ] as const)("moves to logical line %s", (boundary, text, expected) => {
    const state = new EditorState();
    state.insert(text);
    state.moveHorizontal(-1);
    state.moveLineBoundary(boundary === "home" ? "start" : "end");
    expect(state.cursor).toBe(expected);
  });

  it("preserves a preferred content column across visual rows", () => {
    const state = new EditorState();
    state.insert("abcdef\nxy\nabcdef");
    state.moveLineBoundary("start");
    state.moveHorizontal(1);
    state.moveHorizontal(1);
    state.moveVertical(-1, 80);
    expect(state.cursor).toBe(9);
    state.moveVertical(-1, 80);
    expect(state.cursor).toBe(2);
  });

  it("moves and deletes by words and logical boundaries", () => {
    const words = new EditorState();
    words.insert("alpha beta\ngamma");
    words.moveWord(-1);
    expect(words.cursor).toBe(11);
    words.moveWord(1);
    expect(words.cursor).toBe(16);
    words.deleteWordBackward();
    expect(words.text).toBe("alpha beta\n");

    const line = new EditorState();
    line.insert("ab\ncdef");
    line.moveHorizontal(-1);
    line.moveHorizontal(-1);
    line.deleteToLineBoundary("start");
    expect(line.text).toBe("ab\nef");
    line.deleteToLineBoundary("end");
    expect(line.text).toBe("ab\n");
  });

  it("suppresses immediate history duplicates and navigates at visual boundaries", () => {
    const state = new EditorState(["one"]);
    state.remember("one");
    expect(state.entries).toEqual(["one"]);
    state.historyPrevious();
    expect(state.text).toBe("one");
    state.historyNext();
    expect(state.text).toBe("");
  });
});
