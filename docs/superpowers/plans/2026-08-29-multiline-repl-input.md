# Multiline REPL Input Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the main REPL's single-line `readline.question()` input with a dependency-free terminal editor that supports full multiline editing, safe multiline paste, Shift+Enter where terminals expose it, and portable trailing-backslash continuation.

**Architecture:** Pure layout, editor-state, and input-decoder modules hold all deterministic behavior. A thin `MultilineEditor` owns raw-mode input and ANSI redraw only while the main prompt is active; existing readline prompts remain responsible for permissions and trust questions and never compete for stdin. The REPL selects the rich editor only for an interactive TTY and preserves the existing fallback elsewhere.

**Tech Stack:** TypeScript ES2022, Node standard TTY/readline/stream APIs, `Intl.Segmenter`, Bun, Vitest, Biome.

**Spec:** `docs/superpowers/specs/2026-08-29-multiline-repl-input-design.md`

## Global Constraints

- Enter submits; a distinctly encoded Shift+Enter inserts LF.
- At end-of-draft only, the trailing backslash run uses parity semantics: pairs become literal backslashes and an unpaired final backslash continues onto a new line.
- The first visual row prefix is exactly `"> "`; every later logical or wrapped row prefix is exactly two ASCII spaces.
- Every visual row reserves exactly two terminal columns for its prefix.
- Tabs are stored as `\t` and laid out on four-column tab stops.
- Bracketed paste normalizes CRLF/CR to LF, preserves tabs/newlines, filters unsafe controls, and never submits.
- Editing and deletion operate on grapheme clusters; Chinese and emoji width must be reflected in layout.
- History is process-local, stores nonempty submissions, and suppresses immediate duplicates.
- Ctrl+C clears a nonempty draft; Ctrl+C/Ctrl+D exits on an empty draft; Ctrl+D otherwise deletes forward.
- Permission/trust questions, `--print`, non-TTY operation, and model-turn Ctrl+C behavior remain unchanged.
- Use only standard Web/Node APIs; do not add a runtime dependency or Bun-specific API.
- Commands: focused tests with `bun run test <file>`; full gate with `just check`; portable bundle verification with `just build`.

---

## File Structure

- `src/cli/editor-layout.ts` — grapheme segmentation, display width, tab expansion, visual-row wrapping, cursor mapping, and vertical target lookup.
- `src/cli/editor-state.ts` — draft editing, cursor movement, history, cancellation, and Enter/backslash semantics; no terminal I/O.
- `src/cli/editor-input.ts` — stateful raw-byte decoder for key sequences and bracketed paste.
- `src/cli/multiline-editor.ts` — raw-mode lifecycle, event dispatch, ANSI redraw, resize handling, canonical submit, and terminal cleanup.
- `src/cli/agent-command.ts` — select rich versus readline main input, make readline questions exclusive, preserve exact submitted multiline text, and recognize commands only on one logical line.
- `src/observability/terminal.ts` — render the initial activity frame immediately after canonical prompt submission.
- `src/observability/terminal-text.ts` — expose grapheme-aware width helpers shared by layout and existing terminal rendering.
- `test/editor-layout.test.ts` — width, wrapping, prefixes, tabs, Unicode, cursor mapping, and resize layouts.
- `test/editor-state.test.ts` — editing, movement, history, cancellation, and continuation rules.
- `test/editor-input.test.ts` — chunked escape decoding, Shift+Enter, and paste sanitization.
- `test/multiline-editor.test.ts` — fake-TTY lifecycle and stateful virtual-terminal rendering assertions.
- `test/cli.test.ts` — non-TTY/command/EOF regressions.
- `test/runtime.integration.test.ts` — exact multiline runtime/session persistence.
- `test/plugin-terminal.test.ts` — immediate first `thinking` frame.
- `README.md` — document multiline controls and compatibility fallback.

---

### Task 1: Build grapheme-aware editor layout

**Files:**
- Create: `src/cli/editor-layout.ts`
- Modify: `src/observability/terminal-text.ts`
- Create: `test/editor-layout.test.ts`
- Modify: `test/tool-input-display.test.ts`

**Interfaces:**
- Produces from `src/observability/terminal-text.ts`:
  - `export function graphemes(text: string): string[]`
  - `export function graphemeWidth(grapheme: string): number`
  - existing `displayWidth(text: string): number`, changed to sum grapheme widths.
- Produces from `src/cli/editor-layout.ts`:

```ts
export interface VisualPosition {
  offset: number;
  column: number;
}

export interface VisualRow {
  prefix: "> " | "  ";
  start: number;
  end: number;
  text: string;
  width: number;
  positions: VisualPosition[];
}

export interface EditorLayout {
  rows: VisualRow[];
  cursor: { row: number; column: number };
}

export function layoutEditor(
  text: string,
  cursor: number,
  terminalColumns: number,
  tabSize?: number,
): EditorLayout;

export function offsetAtColumn(row: VisualRow, preferredColumn: number): number;
```

- `offset` is a UTF-16 string offset and every returned offset is a grapheme boundary.
- `VisualPosition.column` is a content column, excluding the two-column prefix. `EditorLayout.cursor.column` includes the prefix and is therefore at least 2.

- [ ] **Step 1: Write failing width and layout tests**

Create `test/editor-layout.test.ts` with focused assertions:

```ts
import { describe, expect, it } from "vitest";
import { layoutEditor, offsetAtColumn } from "../src/cli/editor-layout.js";
import { displayWidth, graphemes } from "../src/observability/terminal-text.js";

describe("editor layout", () => {
  it("segments combining text and emoji as whole graphemes", () => {
    expect(graphemes("e\u0301👨‍👩‍👧‍👦中")).toEqual(["e\u0301", "👨‍👩‍👧‍👦", "中"]);
    expect(displayWidth("e\u0301👨‍👩‍👧‍👦中")).toBe(5);
  });

  it("uses > only on the first row and two spaces thereafter", () => {
    const layout = layoutEditor("abcd\n中文x", 8, 6);
    expect(layout.rows.map((row) => row.prefix)).toEqual(["> ", "  ", "  "]);
    expect(layout.rows.map((row) => [row.start, row.end])).toEqual([
      [0, 4],
      [5, 7],
      [7, 8],
    ]);
    expect(layout.cursor.column).toBe(3);
  });

  it("uses four-column tab stops and maps preferred columns", () => {
    const layout = layoutEditor("a\tb\nxy", 3, 10);
    expect(layout.rows[0]?.width).toBe(5);
    expect(offsetAtColumn(layout.rows[1]!, 4)).toBe(6);
  });

  it("keeps blank logical lines and a cursor at the trailing empty line", () => {
    const layout = layoutEditor("a\n\n", 3, 20);
    expect(layout.rows).toHaveLength(3);
    expect(layout.rows.map((row) => row.prefix)).toEqual(["> ", "  ", "  "]);
    expect(layout.cursor).toEqual({ row: 2, column: 2 });
  });
});
```

Also add a regression to `test/tool-input-display.test.ts` proving `displayWidth("e\u0301") === 1` while the existing Chinese and box-drawing expectations remain unchanged.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun run test test/editor-layout.test.ts test/tool-input-display.test.ts`
Expected: FAIL because `editor-layout.ts`, `graphemes`, and `graphemeWidth` do not exist.

- [ ] **Step 3: Implement grapheme width helpers**

In `src/observability/terminal-text.ts`, keep `characterWidth` for compatibility and add a shared segmenter plus grapheme-aware width:

```ts
const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
const MARK = /\p{Mark}/u;
const EMOJI = /\p{Extended_Pictographic}|\p{Regional_Indicator}|\u20e3/u;

export function graphemes(text: string): string[] {
  return Array.from(segmenter.segment(text), ({ segment }) => segment);
}

export function graphemeWidth(grapheme: string): number {
  if (!grapheme) return 0;
  if (EMOJI.test(grapheme) || grapheme.includes("\ufe0f")) return 2;
  const visible = Array.from(grapheme).filter(
    (character) => !MARK.test(character) && character !== "\u200d" && character !== "\ufe0e",
  );
  return visible.reduce((width, character) => Math.max(width, characterWidth(character)), 0);
}

export function displayWidth(text: string): number {
  return graphemes(text).reduce((sum, grapheme) => sum + graphemeWidth(grapheme), 0);
}
```

Keep `sanitizeTerminalText` and `truncateDisplay`; update `truncateDisplay` to iterate `graphemes(text)` instead of `Array.from(text)` and use `graphemeWidth()` for its budget so it cannot split a cluster.

- [ ] **Step 4: Implement deterministic layout and cursor mapping**

Create `src/cli/editor-layout.ts`. Normalize `cursor` to the nearest preceding grapheme boundary. Split on logical LF boundaries, wrap each line to `Math.max(1, terminalColumns - 2)` content columns, and always emit one row for an empty logical line. Compute a tab's width with:

```ts
const tabWidth = (column: number, tabSize: number) => tabSize - (column % tabSize);
```

For every row, push `{ offset, column }` before each grapheme and one final boundary after it. Build `row.text` from visible graphemes and expand each tab to spaces up to the next four-column content tab stop; the renderer must never write a raw tab. A grapheme that does not fit starts the next visual row unless the current row is empty. Newline offsets belong to the end of the row before LF; the offset after LF begins the next logical row. Set `prefix` from the global visual row index, not the logical row index.

Implement nearest-column lookup without bisecting a grapheme:

```ts
export function offsetAtColumn(row: VisualRow, preferredColumn: number): number {
  let best = row.positions[0] ?? { offset: row.start, column: 0 };
  for (const position of row.positions) {
    if (Math.abs(position.column - preferredColumn) < Math.abs(best.column - preferredColumn)) {
      best = position;
    }
  }
  return best.offset;
}
```

- [ ] **Step 5: Run focused tests and commit**

Run: `bun run test test/editor-layout.test.ts test/tool-input-display.test.ts`
Expected: PASS.

```bash
git add src/observability/terminal-text.ts src/cli/editor-layout.ts test/editor-layout.test.ts test/tool-input-display.test.ts
git commit -m "feat: add grapheme-aware editor layout"
```

---

### Task 2: Implement pure multiline editing and history state

**Files:**
- Create: `src/cli/editor-state.ts`
- Create: `test/editor-state.test.ts`

**Interfaces:**
- Consumes: `layoutEditor`, `offsetAtColumn` from Task 1.
- Produces:

```ts
export type ResolvedEnter =
  | { type: "continue"; text: string; cursor: number }
  | { type: "submit"; text: string };
export type EnterResult = { type: "continue" } | { type: "submit"; text: string };

export function resolveEnter(text: string, cursor: number, shift: boolean): ResolvedEnter;
export type InterruptResult = "cleared" | "eof";
export type DeleteResult = "deleted" | "eof";

export class EditorState {
  constructor(history?: string[]);
  get text(): string;
  get cursor(): number;
  get entries(): readonly string[];
  insert(text: string): void;
  backspace(): void;
  deleteForward(): void;
  moveHorizontal(direction: -1 | 1): void;
  moveVertical(direction: -1 | 1, columns: number): void;
  historyPrevious(): void;
  historyNext(): void;
  moveLineBoundary(boundary: "start" | "end"): void;
  moveWord(direction: -1 | 1): void;
  deleteWordBackward(): void;
  deleteToLineBoundary(boundary: "start" | "end"): void;
  enter(shift: boolean): EnterResult;
  interrupt(): InterruptResult;
  endOfInput(): DeleteResult;
  remember(text: string): void;
  reset(): void;
}
```

- `reset()` clears only the active draft/history cursor; it preserves `entries`.
- Up/Down navigate history only when layout reports no visual row in that direction. Ctrl+P/Ctrl+N will call the same boundary behavior through `moveVertical` with first/final-row positioning in Task 4.

- [ ] **Step 1: Write failing editing, continuation, and history tests**

Create `test/editor-state.test.ts` covering the public API. Include these exact edge cases:

```ts
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

it("inserts with Shift+Enter and continues on an odd trailing slash", () => {
  const shifted = new EditorState();
  shifted.insert("ab");
  expect(shifted.enter(true)).toEqual({ type: "continue" });
  expect(shifted.text).toBe("ab\n");

  const continued = new EditorState();
  continued.insert("first" + "\\".repeat(3));
  expect(continued.enter(false)).toEqual({ type: "continue" });
  expect(continued.text).toBe("first" + "\\" + "\n");
});

it("collapses an even trailing slash run and submits", () => {
  const state = new EditorState();
  state.insert("path" + "\\".repeat(2));
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
```

Add these table-driven checks in the same file (use a fresh state for each row):

```ts
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
```

- [ ] **Step 2: Run the state tests to verify they fail**

Run: `bun run test test/editor-state.test.ts`
Expected: FAIL because `EditorState` does not exist.

- [ ] **Step 3: Implement editing on UTF-16 grapheme boundaries**

Create `src/cli/editor-state.ts`. Store `_text`, `_cursor`, `preferredColumn`, `history`, `historyIndex`, and `savedDraft`. Use Task 1's `graphemes()` to derive boundaries for horizontal movement and deletion. Use LF searches for logical Home/End and Unicode whitespace/non-whitespace transitions for word movement.

Vertical movement must call `layoutEditor(this._text, this._cursor, columns)`, retain the first requested content column while moving repeatedly, and call `offsetAtColumn` on the target row. Any nonvertical edit/move resets `preferredColumn`.

- [ ] **Step 4: Implement Enter parity and history without mutating stored entries**

Use an end-only helper for Enter:

```ts
function trailingBackslashes(text: string): number {
  let count = 0;
  for (let index = text.length - 1; index >= 0 && text[index] === "\\"; index--) count++;
  return count;
}
```

Implement the transformation in exported pure helper `resolveEnter()`, then have `EditorState.enter()` apply its returned text/cursor on `continue`. When `shift` is true, insert LF at the cursor. For ordinary Enter away from the draft end, return the unchanged text. At the draft end, replace a trailing run of `count` slashes with `"\\".repeat(Math.floor(count / 2))`; if `count` is odd, append LF and return `continue`; otherwise return `submit` with the transformed text.

History navigation copies strings into `_text`. Save `{ text, cursor }` before first navigating backward and restore both when moving beyond the newest entry. `remember()` ignores whitespace-only input and an immediate duplicate.

- [ ] **Step 5: Run focused tests and commit**

Run: `bun run test test/editor-state.test.ts test/editor-layout.test.ts`
Expected: PASS.

```bash
git add src/cli/editor-state.ts test/editor-state.test.ts
git commit -m "feat: add multiline editor state and history"
```

---

### Task 3: Decode terminal keys and safe bracketed paste

**Files:**
- Create: `src/cli/editor-input.ts`
- Create: `test/editor-input.test.ts`

**Interfaces:**
- Produces:

```ts
export type EditorKey =
  | "enter"
  | "shift-enter"
  | "left"
  | "right"
  | "up"
  | "down"
  | "home"
  | "end"
  | "backspace"
  | "delete"
  | "tab"
  | "ctrl-a"
  | "ctrl-c"
  | "ctrl-d"
  | "ctrl-e"
  | "ctrl-k"
  | "ctrl-n"
  | "ctrl-p"
  | "ctrl-u"
  | "ctrl-w"
  | "alt-b"
  | "alt-f";

export type EditorInputEvent =
  | { type: "key"; key: EditorKey }
  | { type: "text"; text: string }
  | { type: "paste"; text: string };

export class EditorInputDecoder {
  push(chunk: Buffer | string): EditorInputEvent[];
  end(): EditorInputEvent[];
}
```

- Recognized Shift+Enter encodings: `ESC [ 13 ; 2 u`, `ESC [ 27 ; 2 ; 13 ~`, and `ESC CR`/`ESC LF`.
- Bracketed paste delimiters: `ESC [ 200 ~` and `ESC [ 201 ~`.

- [ ] **Step 1: Write failing decoder tests**

Create `test/editor-input.test.ts`:

```ts
it.each(["\u001b[13;2u", "\u001b[27;2;13~", "\u001b\r"])(
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
  expect(decoder.push(Buffer.concat([chinese.subarray(1), Buffer.from("\n好\u001b[201~")]))).toEqual([
    { type: "paste", text: "你\n好" },
  ]);
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
```

For paste sanitization, strip the complete pasted terminal control sequence; pasted escape bytes must never leave printable fragments such as `[31m` or reach terminal output.

- [ ] **Step 2: Run decoder tests to verify they fail**

Run: `bun run test test/editor-input.test.ts`
Expected: FAIL because `EditorInputDecoder` does not exist.

- [ ] **Step 3: Implement chunk-safe UTF-8 and escape parsing**

Use `StringDecoder` from `node:string_decoder` so split UTF-8 characters remain intact. Maintain `pending`, `inPaste`, and `pasteBuffer`. In normal mode:

- emit contiguous printable text as one `text` event;
- map C0 control bytes to the declared key union;
- recognize arrows, Home/End, Delete, Alt+B/F, bracketed-paste start, and the three Shift+Enter forms;
- hold an incomplete known prefix in `pending` for the next `push()`;
- consume an unknown CSI through its final byte (`0x40`–`0x7e`) without emitting text.

In paste mode, search only for the bracketed-paste end delimiter. Keep an end-delimiter prefix in `pasteBuffer` across chunks. On completion, normalize `\r\n?` to LF, remove complete VT control sequences with `stripVTControlCharacters`, and filter every remaining control except tab and LF.

`end()` flushes decoder text, drops an incomplete escape sequence, and emits a sanitized paste payload if EOF occurs inside paste.

- [ ] **Step 4: Run focused tests and commit**

Run: `bun run test test/editor-input.test.ts`
Expected: PASS.

```bash
git add src/cli/editor-input.ts test/editor-input.test.ts
git commit -m "feat: decode multiline editor input"
```

---

### Task 4: Implement raw-mode editor rendering and cleanup

**Files:**
- Create: `src/cli/multiline-editor.ts`
- Create: `test/helpers/virtual-terminal.ts`
- Create: `test/multiline-editor.test.ts`

**Interfaces:**
- Consumes: `EditorState`, `EditorInputDecoder`, and `layoutEditor` from Tasks 1–3.
- Produces:

```ts
export interface EditorInputStream extends NodeJS.ReadStream {
  isRaw?: boolean;
  setRawMode(mode: boolean): this;
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

export class MultilineEditor {
  static supported(input: NodeJS.ReadStream, output: NodeJS.WritableStream, term?: string): boolean;
  constructor(options?: MultilineEditorOptions);
  read(): Promise<MainInputResult>;
  dispose(): void;
}
```

- `read()` rejects concurrent calls.
- One `MultilineEditor` instance persists history across repeated `read()` calls.

- [ ] **Step 1: Build a stateful virtual terminal and failing lifecycle tests**

Create `test/helpers/virtual-terminal.ts` with a bounded character grid and `apply(chunk)` support for the exact sequences the editor emits: CR, LF, cursor up/down/right, erase-line, and erase-down. Expose `lines(): string[]` and `{ row, column }` cursor state.

Create `test/multiline-editor.test.ts` using a `PassThrough`-based fake input with `isTTY = true`, `isRaw`, and a recording `setRawMode`; use a writable sink with `isTTY = true` and mutable `columns`.

Test at least:

```ts
it("renders multiline input with two-space continuation prefixes", async () => {
  const h = editorHarness(12);
  const result = h.editor.read();
  h.input.write("first\u001b[13;2usecond\r");
  await expect(result).resolves.toEqual({ type: "submit", text: "first\nsecond" });
  expect(h.screen.lines().slice(0, 2)).toEqual(["> first", "  second"]);
});

it("inserts bracketed paste without submitting and then submits once", async () => {
  const h = editorHarness(20);
  const result = h.editor.read();
  h.input.write("\u001b[200~a\nb\u001b[201~");
  expect(h.settled()).toBe(false);
  h.input.write("\r");
  await expect(result).resolves.toEqual({ type: "submit", text: "a\nb" });
});

it("clears a nonempty draft on Ctrl+C and exits on Ctrl+C when empty", async () => {
  const h = editorHarness(20);
  const result = h.editor.read();
  h.input.write("draft\u0003");
  expect(h.screen.lines()).toEqual(["> "]);
  h.input.write("\u0003");
  await expect(result).resolves.toEqual({ type: "eof" });
});

it("restores raw mode and bracketed paste after submission and exceptions", async () => {
  const h = editorHarness(20, { initiallyRaw: false });
  const result = h.editor.read();
  h.input.write("ok\r");
  await result;
  expect(h.rawTransitions).toEqual([true, false]);
  expect(h.output.value).toContain("\u001b[?2004h");
  expect(h.output.value).toContain("\u001b[?2004l");
  expect(h.listenerCounts()).toEqual({ data: 0, resize: 0 });
});
```

Add explicit tests named `wraps and redraws after resize without stale rows`, `restores the cursor after Up across a blank line`, `Ctrl+D deletes forward and exits only when empty`, `continues on a trailing backslash`, `retains editable history across read calls`, `dispose resolves EOF and restores the terminal`, and `rejects concurrent read calls`. Each test must feed the named key bytes through the fake input and assert both `MainInputResult` and `VirtualTerminal.lines()`/cursor. Add a signal table test:

```ts
it.each(["SIGHUP", "SIGTERM"] as const)("cleans up before %s termination", async (signal) => {
  const h = editorHarness(20);
  const result = h.editor.read();
  h.signals.emit(signal);
  await h.nextTick();
  expect(h.rawTransitions.at(-1)).toBe(false);
  expect(h.terminated).toEqual([signal]);
  h.editor.dispose();
  await expect(result).resolves.toEqual({ type: "eof" });
});
```

Add a separate external `SIGINT` test asserting `{ type: "eof" }`, restored raw mode, and zero listeners. These are fake-emitter tests and must not signal the Vitest process.

- [ ] **Step 2: Run terminal-editor tests to verify they fail**

Run: `bun run test test/multiline-editor.test.ts`
Expected: FAIL because `MultilineEditor` and the harness helper do not exist.

- [ ] **Step 3: Implement exclusive raw-mode lifecycle**

In `MultilineEditor.read()`:

1. Reject if another read is active or if disposed.
2. Record `input.isRaw`, call `setRawMode(true)`, resume stdin, enable bracketed paste with `\u001b[?2004h`, and install `data`, `end`, `error`, `SIGWINCH`, `SIGINT`, `SIGHUP`, and `SIGTERM` listeners.
3. Reset only the active draft and render `> `.
4. Decode each chunk and dispatch all resulting events synchronously.
5. Resolve once with submit/EOF and invoke an idempotent `cleanup()` in `finally`.

`cleanup()` removes every installed listener, writes `\u001b[?2004l`, restores the previous raw state, clears the active decoder/promise references, and leaves history intact. `dispose()` invokes the same cleanup and resolves an active read as EOF. An external SIGINT resolves as EOF after cleanup. SIGHUP/SIGTERM first clean up, then call the injected `terminate(signal)`; the production default re-sends that signal with `process.kill(process.pid, signal)` after the editor listener has been removed.

- [ ] **Step 4: Implement event dispatch and canonical redraw**

Map decoder keys directly to `EditorState` methods. Ctrl+P and Ctrl+N call `historyPrevious()` and `historyNext()` directly, independently of the visual cursor row. Insert `text` and `paste` payloads identically after decoder sanitization.

Track the previous rendered cursor row and rendered row count. For each redraw:

1. Return from the previous cursor position to the owned region's first row with CR and cursor-up.
2. Erase from that point down.
3. Write every layout row as `row.prefix + row.text`, separated by LF; `row.text` already contains tab expansion.
4. Move from the rendered end back to `layout.cursor.row`, then right to `layout.cursor.column`.

On submit, first redraw with the cursor at the end of the transformed submitted text, then write exactly one LF before cleanup. On resize, recompute from state with `output.columns ?? 80` and use the same redraw path.

`MultilineEditor.supported()` returns true only when both streams are TTY-capable, `input.setRawMode` exists, and `(term ?? process.env.TERM) !== "dumb"`.

- [ ] **Step 5: Run focused tests and commit**

Run: `bun run test test/multiline-editor.test.ts test/editor-state.test.ts test/editor-input.test.ts test/editor-layout.test.ts`
Expected: PASS.

```bash
git add src/cli/multiline-editor.ts test/helpers/virtual-terminal.ts test/multiline-editor.test.ts
git commit -m "feat: add interactive multiline terminal editor"
```

---

### Task 5: Integrate the editor into the REPL and preserve exclusive readline prompts

**Files:**
- Modify: `src/cli/agent-command.ts`
- Modify: `src/observability/terminal.ts`
- Modify: `test/cli.test.ts`
- Modify: `test/runtime.integration.test.ts`
- Modify: `test/plugin-terminal.test.ts`
- Modify: `README.md`

**Interfaces:**
- Consumes: `resolveEnter()` from Task 2 plus `MultilineEditor.supported()`, `new MultilineEditor()`, and `MainInputResult` from Task 4.
- Produces in `src/cli/agent-command.ts`:

```ts
type Question = (message: string, signal?: AbortSignal) => Promise<string>;

export async function collectFallbackInput(
  readLine: (prompt: string) => Promise<string | undefined>,
): Promise<MainInputResult>;

export function classifyReplInput(text: string):
  | { type: "empty" }
  | { type: "command"; command: string }
  | { type: "message"; text: string };
```

- `classifyReplInput` returns `command` only when `text` contains no LF and `text.trim()` is one of the supported slash commands. It returns the original, untrimmed text for messages.

- [ ] **Step 1: Write failing REPL classification and regression tests**

Add unit-level assertions to `test/cli.test.ts`:

```ts
expect(classifyReplInput("  /help  ")).toEqual({ type: "command", command: "/help" });
expect(classifyReplInput("/help\nmore")).toEqual({ type: "message", text: "/help\nmore" });
expect(classifyReplInput("  code\n    indented\n")).toEqual({
  type: "message",
  text: "  code\n    indented\n",
});
expect(classifyReplInput(" \n\t ")).toEqual({ type: "empty" });

const lines = ["first\\", "second"];
await expect(collectFallbackInput(async (prompt) => {
  expect(prompt).toBe(lines.length === 2 ? "> " : "  ");
  return lines.shift();
})).resolves.toEqual({ type: "submit", text: "first\nsecond" });
```

Add exact fallback edge assertions:

```ts
await expect(collectFallbackInput(async () => undefined)).resolves.toEqual({ type: "eof" });

const eofAfterContinuation = ["first\\", undefined];
await expect(collectFallbackInput(async () => eofAfterContinuation.shift())).resolves.toEqual({
  type: "eof",
});

const literalSlash = ["path\\\\"];
await expect(collectFallbackInput(async () => literalSlash.shift())).resolves.toEqual({
  type: "submit",
  text: "path\\",
});
```

Retain the existing spawned non-TTY `/new\n/quit\n` and resume tests. Add a spawned EOF case with empty stdin and assert clean exit.

In `test/runtime.integration.test.ts`, add a direct runtime call with `"  first\n    second\n"`, then recover the session and assert the user message content is byte-for-byte equal.

In `test/plugin-terminal.test.ts`, add:

```ts
it("renders the first thinking frame immediately", async () => {
  vi.useFakeTimers();
  const out = new Sink();
  const err = new Sink();
  Object.assign(err, { columns: 80 });
  const events = new EventBus();
  const renderer = new TerminalRenderer(events, { stdout: out, stderr: err, tty: true });
  await events.emit("provider.started");
  expect(err.value).toContain("thinking");
  renderer.dispose();
});
```

- [ ] **Step 2: Run integration tests to verify they fail**

Run: `bun run test test/cli.test.ts test/runtime.integration.test.ts test/plugin-terminal.test.ts`
Expected: FAIL because `classifyReplInput` is absent and `provider.started` does not render immediately.

- [ ] **Step 3: Refactor input ownership in `runAgentCommand`**

Import `MultilineEditor`. Determine rich main-input support before creating a persistent readline interface:

```ts
const richRepl =
  !initialPrompt &&
  !options.print &&
  MultilineEditor.supported(stdin, process.stderr, process.env.TERM);
const needsInput = !options.auto || (!initialPrompt && !options.print);
const rl = needsInput && !richRepl
  ? createInterface({ input: stdin, output: process.stderr })
  : undefined;
```

Keep the existing `question(rl, ...)` helper for the fallback path. Add `transientQuestion(message, signal)` that creates a readline interface, calls `question`, and closes it in `finally`. Select one exclusive `Question` function:

```ts
const ask: Question = rl
  ? (message, signal) => question(rl, message, signal)
  : transientQuestion;
```

Pass `ask` into `createPermissionPrompt` and `yesNo` instead of requiring an interface. During rich REPL editing no readline interface exists; after submission the editor has cleaned up before `runTurn()` can call a permission prompt. Keep the existing persistent readline interface in nonrich mode so non-TTY input sequencing and current behavior stay intact.

Construct one `MultilineEditor` for the REPL when `richRepl` is true, pass it into `repl`, and dispose it in the outer `finally`. Keep `runTurn()` unchanged: its process listener handles rich mode, while its optional readline listener preserves fallback-terminal Ctrl+C behavior. No multiline-editor listener remains active during either path's model turn.

- [ ] **Step 4: Implement fallback continuation and exact-text classification**

Implement `collectFallbackInput()` as an accumulation loop. Ask with `> ` for the first physical line and two spaces thereafter. Append each returned line to the accumulated draft, call `resolveEnter(candidate, candidate.length, false)`, continue with its transformed text on `continue`, and return its submitted text on `submit`. Return `{ type: "eof" }` when `readLine` returns `undefined`, including EOF after an unfinished continuation. This keeps ordinary fallback input single-line while making trailing-backslash continuation available in every terminal.

Implement `classifyReplInput` with a constant command set:

```ts
const REPL_COMMANDS = new Set([
  "/help",
  "/session",
  "/sessions",
  "/compact",
  "/reload",
  "/new",
  "/quit",
]);

export function classifyReplInput(text: string) {
  if (!text.trim()) return { type: "empty" } as const;
  const trimmed = text.trim();
  if (!text.includes("\n") && REPL_COMMANDS.has(trimmed)) {
    return { type: "command", command: trimmed } as const;
  }
  return { type: "message", text } as const;
}
```

In `repl`, read from `editor.read()` when present; otherwise call `collectFallbackInput()` with an adapter that maps the existing readline EOF sentinel to `undefined`. Map either path's EOF to loop termination. Branch on `classifyReplInput`. Keep command handlers unchanged, but pass `classified.text`—not a trimmed local—to `runTurn()`.

Call `editorState.remember()` inside `MultilineEditor` immediately before returning a nonempty submit, so commands and model messages share one history and immediate duplicates are suppressed.

- [ ] **Step 5: Render the first activity frame immediately**

Change `TerminalRenderer.startProviderAttempt()` in `src/observability/terminal.ts` to:

```ts
private startProviderAttempt(): void {
  this.endProviderAttempt();
  this.providerStartedAt = Date.now();
  this.startSpinner();
  this.renderActivityLine();
}
```

Do not add a newline: the editor's canonical submit already leaves the cursor on the next row, and subsequent timer frames overwrite that same row.

- [ ] **Step 6: Document the user-facing controls**

Update the README REPL paragraph to state:

```markdown
交互式 REPL 支持完整多行编辑：Enter 提交；终端可区分该按键时，Shift+Enter 插入换行；所有终端均可在行尾输入单个 `\` 后按 Enter 继续下一行（`\\` 表示保留一个字面反斜杠）。支持多行粘贴、跨行方向键编辑和当前进程内输入历史。传统终端若无法区分 Shift+Enter，请使用行尾 `\`。
```

Retain the command list immediately after this explanation.

- [ ] **Step 7: Run integration tests and commit**

Run: `bun run test test/cli.test.ts test/runtime.integration.test.ts test/plugin-terminal.test.ts test/multiline-editor.test.ts`
Expected: PASS.

```bash
git add src/cli/agent-command.ts src/observability/terminal.ts test/cli.test.ts test/runtime.integration.test.ts test/plugin-terminal.test.ts README.md
git commit -m "feat: support multiline REPL input"
```

---

### Task 6: Full compatibility and package verification

**Files:**
- Modify only if a failing gate exposes a defect in files already listed above.

**Interfaces:**
- Consumes the complete feature from Tasks 1–5.
- Produces a lint-clean, strict-typechecked, tested, Node-targeted CLI bundle with no added dependency.

- [ ] **Step 1: Format the implementation**

Run: `bun run format`
Expected: Biome formats only the source/test/config files it manages. Review `git diff` to ensure no unrelated changes were introduced.

- [ ] **Step 2: Run the complete project gate**

Run: `just check`
Expected: Biome lint passes, strict `tsc --noEmit` passes, and all offline Vitest tests pass.

- [ ] **Step 3: Build the published Node CLI**

Run: `just build`
Expected: `dist/index.js` and plugin artifacts build successfully; the editor code contains no unresolved Bun API.

- [ ] **Step 4: Verify dependency and diff hygiene**

Run:

```bash
git diff --check
git diff -- package.json bun.lock
git status --short
```

Expected: no whitespace errors; no changes to `package.json` or `bun.lock`; only intentional formatted source/test/README changes remain.

- [ ] **Step 5: Commit any formatting-only changes**

If Step 1 changed tracked implementation files after the Task 5 commit:

```bash
git add src test README.md
git commit -m "style: format multiline editor implementation"
```

If there are no formatting changes, do not create an empty commit.
