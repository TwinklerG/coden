# CodeN TUI Cursor and Inline Interactions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make TUI multiline input use one correctly positioned native cursor with atomic bottom layout, and replace every modal confirmation dialog with a persistent transcript interaction.

**Architecture:** Patch Ink 7.1.1's full-screen cursor suffix calculation at the dependency boundary, then make `TuiApp` own the editor snapshot from which input height, transcript height, and cursor coordinates are derived in one render. Represent tool permissions and generic confirmations as semantic transcript blocks plus one store-owned pending resolver; route their keys separately while the visible task input remains disabled.

**Tech Stack:** TypeScript, React 19, Ink 7.1.1, Bun dependency patches and lockfile, Vitest, ink-testing-library, Biome, virtual ANSI terminal tests, Node.js 22+

**Spec:** `docs/superpowers/specs/2026-08-31-coden-tui-cursor-and-inline-interactions-design.md`

## Global Constraints

- Display exactly one cursor: the terminal-native blinking cursor; never render `▏` or another application caret.
- Preserve IME positioning through Ink `useCursor()`.
- Keep the status bar on the final terminal row during every input growth and shrink frame.
- Preserve Enter, Shift+Enter, odd trailing-`\`, Tab, grapheme, CJK, emoji, wrapping, history, mouse, and transcript-navigation behavior.
- Remove all overlay dialogs, including tool permission, workspace trust, and plugin confirmation dialogs.
- Keep the task input visible but disabled while any inline interaction is pending.
- Retain the complete request, choices, and selected answer in the transcript after resolution.
- Permit at most one pending interaction; permission fallback is `deny` and confirm fallback is `false`.
- Do not change `AgentInteraction`, `PermissionPolicy`, runtime, provider, event-bus, or session-persistence APIs.
- Pin Ink to exactly `7.1.1`; dependency upgrades must not silently reuse the patch.
- Use Bun as the JS/TS toolchain without Bun-only runtime APIs; format and lint with Biome; preserve Node.js 22+ artifact compatibility.
- Follow TDD and commit each task independently.

## File Structure

### New files

- `patches/ink@7.1.1.patch`: Bun-managed patch correcting cursor suffix positioning for frames without a trailing newline.
- `test/tui-ink-cursor.test.tsx`: actual Ink renderer regression tests decoded through the virtual terminal.
- `test/tui-frame.test.tsx`: full TUI frame-sequence tests for continuation and row deletion.

### Modified production files

- `package.json`: exact-pin Ink 7.1.1 and record Bun's generated patched dependency metadata.
- `bun.lock`: lock the exact patched Ink package.
- `src/tui/components/input-bar.tsx`: expose pure input-layout calculation, consume parent-owned editor state/layout, remove the visible caret and row feedback.
- `src/tui/app.tsx`: own editor state/revision, derive all row allocation atomically, route pending interaction keys, and remove the overlay.
- `src/tui/types.ts`: replace dialog types with interaction blocks and pending-interaction descriptors.
- `src/tui/transcript.ts`: render resize-aware permission and generic confirmation blocks.
- `src/tui/store.ts`: persist interaction blocks, own one resolver, and settle resolution/abort/close exactly once.
- `src/i18n/locales/en.ts`: add the inline-interaction cancellation label.
- `src/i18n/locales/zh.ts`: add the matching Chinese label.
- `README.md`: document transcript-inline confirmations and disabled task input while waiting.
- `README.en.md`: document the same behavior in English.

### Deleted production file

- `src/tui/components/permission-dialog.tsx`: remove the obsolete modal component.

### Modified test files

- `test/helpers/virtual-terminal.ts`: decode absolute cursor movement, cursor visibility, and generic CSI sequences needed by Ink output.
- `test/tui-components.test.tsx`: use a controlled input harness, assert native-caret-only rendering, and remove dialog component tests.
- `test/tui-layout.test.ts`: assert the uncompensated cursor origin and atomic row calculations.
- `test/tui-transcript.test.ts`: cover pending, resolved, cancelled, dangerous, generic, long, and resized interactions.
- `test/tui-store.test.ts`: cover interaction lifecycle, concurrency, answer validation, abort, close, and persistence.
- `test/tui-controller.test.ts`: replace dialog terminology/assertions with pending-interaction shutdown assertions.
- `test/i18n.test.ts`: keep locale shape parity after the new message.

---

### Task 1: Correct Ink's no-trailing-newline cursor positioning

**Files:**
- Modify: `package.json`
- Modify: `bun.lock`
- Create: `patches/ink@7.1.1.patch`
- Modify: `test/helpers/virtual-terminal.ts`
- Create: `test/tui-ink-cursor.test.tsx`

**Interfaces:**
- Consumes: Ink `render()`, `useCursor()`, and its internal `buildCursorSuffix()`/`buildCursorOnlySequence()` implementation.
- Produces: exact dependency `"ink": "7.1.1"` with a Bun-applied patch.
- Produces: `VirtualTerminal.cursorVisible: boolean`, CSI `G`/`H` positioning, and existing `cursor`/`lines()` behavior for later frame tests.

- [ ] **Step 1: Extend `VirtualTerminal` and write failing real-Ink cursor tests**

Update `test/helpers/virtual-terminal.ts` so CSI parsing accepts a private marker, any number of numeric parameters, and a final letter. Preserve the existing write, erase, and resize behavior, and add these semantics:

```ts
cursorVisible = false;

private applyCsi(parameters: string, final: string): void {
  const privateMode = parameters.startsWith("?");
  const values = (privateMode ? parameters.slice(1) : parameters)
    .split(";")
    .filter(Boolean)
    .map(Number);
  const first = values[0] || 1;

  if (final === "A") this.cursor.row = Math.max(0, this.cursor.row - first);
  if (final === "B") this.cursor.row = Math.min(this.rows - 1, this.cursor.row + first);
  if (final === "C") this.cursor.column = Math.min(this.columns - 1, this.cursor.column + first);
  if (final === "D") this.cursor.column = Math.max(0, this.cursor.column - first);
  if (final === "G") this.cursor.column = Math.max(0, Math.min(this.columns - 1, first - 1));
  if (final === "H" || final === "f") {
    this.cursor.row = Math.max(0, Math.min(this.rows - 1, (values[0] || 1) - 1));
    this.cursor.column = Math.max(0, Math.min(this.columns - 1, (values[1] || 1) - 1));
  }
  if (final === "J") this.eraseDown();
  if (final === "K") this.eraseLine();
  if (privateMode && first === 25 && final === "h") this.cursorVisible = true;
  if (privateMode && first === 25 && final === "l") this.cursorVisible = false;
}
```

Replace the current fixed CSI regex with:

```ts
const match = /^([?]?[0-9;]*)([A-Za-z])/.exec(chunk.slice(index + 2));
```

Create `test/tui-ink-cursor.test.tsx`. Use a small `Writable` with `isTTY = true`, fixed `columns`/`rows`, and captured chunks. Render a three-line, no-trailing-newline fixture that calls `setCursorPosition({x, y})`, feed every emitted chunk into `VirtualTerminal`, then rerender with unchanged text and a different cursor position. Include these assertions:

```tsx
function CursorFrame({x, y}: {x: number; y: number}) {
  const {setCursorPosition} = useCursor();
  setCursorPosition({x, y});
  return <Text>{"aaa\nbbb\nccc"}</Text>;
}

expect(screen.cursor).toEqual({row: 1, column: 2});
expect(screen.cursorVisible).toBe(true);

view.rerender(<CursorFrame x={1} y={2} />);
await flushInk();
expect(screen.cursor).toEqual({row: 2, column: 1});
expect(screen.cursorVisible).toBe(true);
```

Add a trailing-newline fixture and assert its existing positioning remains correct.

- [ ] **Step 2: Run the cursor test and verify RED**

Run:

```bash
bun run vitest run test/tui-ink-cursor.test.tsx
```

Expected: the no-trailing-newline assertion is one row too high on initial or cursor-only rendering; the trailing-newline case remains correct.

- [ ] **Step 3: Exact-pin and prepare the Ink package patch**

Change `package.json`:

```json
"ink": "7.1.1"
```

Then run:

```bash
bun install
bun patch ink@7.1.1
```

Edit the prepared `node_modules/ink/build/cursor-helpers.js` so `buildCursorSuffix` receives whether output ends with a newline and calculates the actual output-end row:

```js
export const buildCursorSuffix = (visibleLineCount, cursorPosition, outputEndsWithNewline) => {
    if (!cursorPosition) {
        return '';
    }
    const outputEndRow = visibleLineCount - (outputEndsWithNewline ? 0 : 1);
    const moveUp = outputEndRow - cursorPosition.y;
    return ((moveUp > 0 ? ansiEscapes.cursorUp(moveUp) : '') +
        ansiEscapes.cursorTo(cursorPosition.x) +
        showCursorEscape);
};
```

Add `outputEndsWithNewline` to `CursorOnlyInput` in `node_modules/ink/build/cursor-helpers.d.ts`, add the third boolean parameter to the `buildCursorSuffix` declaration, and pass the new field through `buildCursorOnlySequence()`:

```js
const cursorSuffix = buildCursorSuffix(
    input.visibleLineCount,
    input.cursorPosition,
    input.outputEndsWithNewline,
);
```

In every standard and incremental branch of `node_modules/ink/build/log-update.js`:

- call `buildCursorSuffix(visibleCount, activeCursor, str.endsWith('\n'))`;
- include `outputEndsWithNewline: str.endsWith('\n')` in both cursor-only calls;
- use the same three-argument call in both `render.sync` implementations.

Generate the committed patch:

```bash
bun patch --commit node_modules/ink
```

Verify that Bun created `patches/ink@7.1.1.patch` and recorded it in `package.json`/`bun.lock`.

- [ ] **Step 4: Run patched dependency and installation checks**

Run:

```bash
bun run vitest run test/tui-ink-cursor.test.tsx
bun install --frozen-lockfile
bun run vitest run test/tui-ink-cursor.test.tsx
bun run typecheck
```

Expected: both cursor fixtures pass before and after frozen reinstall; TypeScript reports no errors.

- [ ] **Step 5: Commit the dependency-boundary fix**

```bash
git add package.json bun.lock patches/ink@7.1.1.patch test/helpers/virtual-terminal.ts test/tui-ink-cursor.test.tsx
git commit -m "fix: correct Ink full-screen cursor positioning"
```

---

### Task 2: Make editor height and root layout one atomic render

**Files:**
- Modify: `src/tui/components/input-bar.tsx`
- Modify: `src/tui/app.tsx`
- Modify: `test/tui-components.test.tsx`
- Modify: `test/tui-layout.test.ts`

**Interfaces:**
- Produces: `InputBarLayout` with `prompt`, `promptWidth`, `editorColumns`, and `editor: EditorLayout`.
- Produces: `calculateInputBarLayout(text, cursor, language, columns): InputBarLayout`.
- Changes `InputBarProps` to consume `state: EditorState`, `layout: InputBarLayout`, and `onEditorChange(): void`.
- Changes `calculateInputCursorTopRow(transcriptRows: number): number` to return the real first editor content row, with no Ink compensation.
- Removes: `InputBar.onRowsChange`, local redraw state, local `EditorState`, and the visible-caret split path.

- [ ] **Step 1: Convert component tests to a controlled harness and assert no rendered caret**

In `test/tui-components.test.tsx`, add a harness that owns the editor above `InputBar`, mirroring the intended `TuiApp` ownership:

```tsx
function ControlledInputBar(props: Omit<InputBarProps, "state" | "layout" | "onEditorChange">) {
  const state = useRef(new EditorState()).current;
  const [, redraw] = useReducer((value: number) => value + 1, 0);
  const layout = calculateInputBarLayout(state.text, state.cursor, props.language, props.columns);
  return (
    <InputBar
      {...props}
      state={state}
      layout={layout}
      onEditorChange={() => redraw()}
    />
  );
}
```

Replace direct `InputBar` test mounts with this harness. Change frame expectations from `Task > ▏` and `Task > abcd▏` to `Task > ` and `Task > abcd`. Add:

```ts
expect(view.frames.join("\n")).not.toContain("▏");
```

Replace row-callback assertions with assertions against the harness frame after wrapping, continuation, Backspace, and reset.

In `test/tui-layout.test.ts`, change the cursor-origin expectation:

```ts
expect(calculateInputCursorTopRow(20)).toBe(21);
```

Add a pure atomic allocation assertion using the actual editor layout length:

```ts
const one = calculateInputBarLayout("a", 1, "en", 20);
const two = calculateInputBarLayout("a\nb", 3, "en", 20);
expect(calculateTranscriptRows(24, one.editor.rows.length)).toBe(20);
expect(calculateTranscriptRows(24, two.editor.rows.length)).toBe(19);
```

- [ ] **Step 2: Run focused tests and verify RED**

Run:

```bash
bun run vitest run test/tui-components.test.tsx test/tui-layout.test.ts
```

Expected: tests fail because `InputBar` still owns its editor, emits `▏`, reports rows through a callback, and uses the compensated cursor origin.

- [ ] **Step 3: Add the pure input layout and make `InputBar` controlled**

In `src/tui/components/input-bar.tsx`, export:

```ts
export interface InputBarLayout {
  prompt: string;
  promptWidth: number;
  editorColumns: number;
  editor: ReturnType<typeof layoutEditor>;
}

export function calculateInputBarLayout(
  text: string,
  cursor: number,
  language: Language,
  columns: number,
): InputBarLayout {
  const prompt = language === "zh" ? "任务 > " : "Task > ";
  const promptWidth = displayWidth(prompt);
  const editorColumns = Math.max(3, columns - promptWidth + 1);
  return {
    prompt,
    promptWidth,
    editorColumns,
    editor: layoutEditor(text, cursor, editorColumns),
  };
}
```

Change `InputBarProps` to include:

```ts
state: EditorState;
layout: InputBarLayout;
onEditorChange(): void;
```

Remove local `EditorState`, local redraw state, disabled-reset effect, `onRowsChange`, `CURSOR_CHAR`, `splitRowAtColumn`, and caret-specific `ReactNode` rendering. After every handled editor operation call `onEditorChange()` once. On submit, preserve this order:

```ts
state.remember(result.text);
state.reset();
onEditorChange();
onSubmit(result.text);
```

Render `row.text` directly. Set the native cursor from the supplied layout:

```ts
setCursorPosition(
  active && !disabled
    ? {
        x: layout.promptWidth + Math.max(0, layout.editor.cursor.column - 2),
        y: topRow + layout.editor.cursor.row,
      }
    : undefined,
);
```

- [ ] **Step 4: Lift editor ownership into `TuiApp` and remove row feedback**

In `src/tui/app.tsx`, import `EditorState`, `useReducer`, `useRef`, and `calculateInputBarLayout`. Add parent ownership:

```ts
const editor = useRef(new EditorState()).current;
const [, reviseEditor] = useReducer((value: number) => value + 1, 0);
const inputLayout = calculateInputBarLayout(
  editor.text,
  editor.cursor,
  i18n.currentLanguage,
  columns,
);
const inputRows = inputLayout.editor.rows.length;
const transcriptRows = calculateTranscriptRows(rows, inputRows);
```

Delete `useState(inputRows)`, `onInputRowsChange`, and their callback imports. Change:

```ts
export function calculateInputCursorTopRow(transcriptRows: number): number {
  return transcriptRows + 1;
}
```

Pass the controlled values:

```tsx
<InputBar
  state={editor}
  layout={inputLayout}
  onEditorChange={() => reviseEditor()}
  topRow={calculateInputCursorTopRow(transcriptRows)}
  {...remainingProps}
/>
```

Do not reset the editor in an effect when `disabled` changes; submit/reset already occurs before `onSubmit`, and bootstrap interactions occur before user editing.

- [ ] **Step 5: Run editor, component, and layout tests**

Run:

```bash
bun run vitest run test/editor-state.test.ts test/editor-layout.test.ts test/tui-components.test.tsx test/tui-layout.test.ts test/tui-ink-cursor.test.tsx
bun run typecheck
```

Expected: all selected tests pass, no frame contains `▏`, and TypeScript reports no errors.

- [ ] **Step 6: Commit the atomic editor layout**

```bash
git add src/tui/components/input-bar.tsx src/tui/app.tsx test/tui-components.test.tsx test/tui-layout.test.ts
git commit -m "fix: render TUI editor layout atomically"
```

---

### Task 3: Add semantic transcript interaction blocks

**Files:**
- Modify: `src/tui/types.ts`
- Modify: `src/tui/transcript.ts`
- Modify: `src/i18n/locales/en.ts`
- Modify: `src/i18n/locales/zh.ts`
- Modify: `test/tui-transcript.test.ts`
- Modify: `test/i18n.test.ts`

**Interfaces:**
- Produces: `TuiInteractionAnswer = "y" | "s" | "n"`.
- Produces: `TuiInteractionStatus = "pending" | "resolved" | "cancelled"`.
- Produces: transcript block `kind: "interaction"` with semantic permission/confirm prompt data.
- Produces: `TuiPendingInteraction` for key routing.
- Removes: `TuiDialog` and `TuiSnapshot.dialog`.

- [ ] **Step 1: Write failing transcript rendering and locale tests**

Add blocks to `test/tui-transcript.test.ts` that assert:

```ts
const permission: TranscriptBlock = {
  id: "permission-1",
  kind: "interaction",
  interaction: "permission",
  toolName: "edit",
  risk: "modify",
  lines: ["path: src/a.ts", "content:", "  line one", "  line two"],
  allowSession: true,
  status: "pending",
};

expect(renderTranscriptBlock(permission, 30, new I18n("en"))).toContain("MODIFY  edit");
expect(renderTranscriptBlock(permission, 30, new I18n("en"))).toContain(
  "Allow? [y]es / [s]ession / [N]o: ",
);
expect(renderTranscriptBlock({...permission, status: "resolved", answer: "s"}, 30, new I18n("en")))
  .toContain("[N]o: s");
expect(renderTranscriptBlock({...permission, risk: "dangerous", allowSession: false}, 30, new I18n("en")))
  .not.toContain("session");
expect(renderTranscriptBlock({...permission, status: "cancelled"}, 30, new I18n("zh")))
  .toContain("已取消");
```

Add a generic confirmation whose message already ends in `[y/N] ` and assert choices are not duplicated. Render the permission at widths 20 and 40 and assert the horizontal rule follows each width. Include at least 20 input lines and assert the final line is present, proving the old 12-line dialog bound is gone.

Update `test/i18n.test.ts` locale-shape assertion to expect the new `tui.interactionCancelled` message in both locales.

- [ ] **Step 2: Run transcript tests and verify RED**

Run:

```bash
bun run vitest run test/tui-transcript.test.ts test/i18n.test.ts
```

Expected: TypeScript/test collection fails because interaction block types and the new locale key do not exist.

- [ ] **Step 3: Replace dialog types with interaction types**

In `src/tui/types.ts`, remove `TuiDialog` and add:

```ts
export type TuiInteractionAnswer = "y" | "s" | "n";
export type TuiInteractionStatus = "pending" | "resolved" | "cancelled";

export type TranscriptInteractionBlock =
  | {
      id: string;
      kind: "interaction";
      interaction: "permission";
      toolName: string;
      risk: ToolRisk;
      lines: readonly string[];
      allowSession: boolean;
      status: TuiInteractionStatus;
      answer?: TuiInteractionAnswer;
    }
  | {
      id: string;
      kind: "interaction";
      interaction: "confirm";
      message: string;
      status: TuiInteractionStatus;
      answer?: "y" | "n";
    };

export type TuiPendingInteraction =
  | {id: string; kind: "permission"; allowSession: boolean}
  | {id: string; kind: "confirm"; allowSession: false};
```

Add `TranscriptInteractionBlock` to `TranscriptBlock`. Replace `dialog?: TuiDialog` in `TuiSnapshot` with:

```ts
pendingInteraction?: TuiPendingInteraction;
```

- [ ] **Step 4: Render permission and confirmation blocks**

Add `interactionCancelled` to locales:

```ts
// en
interactionCancelled: "cancelled",

// zh
interactionCancelled: "已取消",
```

In `src/tui/transcript.ts`, add pure helpers equivalent to:

```ts
function interactionSuffix(block: TranscriptInteractionBlock, i18n: I18n): string {
  if (block.status === "cancelled") return i18n.messages.tui.interactionCancelled;
  return block.answer ?? "";
}

function renderInteraction(
  block: TranscriptInteractionBlock,
  columns: number,
  i18n: I18n,
): string {
  const suffix = interactionSuffix(block, i18n);
  if (block.interaction === "confirm") {
    const message = sanitizeTerminalText(block.message).trimEnd();
    const prompt = /\[y\/N\]$/u.test(message) ? message : `${message} [y/N]`;
    return `${prompt} ${suffix}`;
  }

  const rule = "─".repeat(Math.max(1, columns));
  const values = block.lines.map((line) => `  ${sanitizeTerminalText(line)}`).join("\n");
  const choices = block.allowSession
    ? "[y]es / [s]ession / [N]o"
    : "[y]es / [N]o";
  return `${rule}\n${block.risk.toUpperCase()}  ${sanitizeTerminalText(block.toolName)}\n\n${values}\n${rule}\n${i18n.messages.format.allow} ${choices}: ${suffix}`;
}
```

Add an `interaction` case in `renderTranscriptBlock`. Require `i18n` for this case by falling back to `new I18n("en")` only when the optional argument is absent.

- [ ] **Step 5: Run rendering, locale, and formatting tests**

Run:

```bash
bun run vitest run test/tui-transcript.test.ts test/i18n.test.ts test/format.test.ts test/tool-input-display.test.ts
bun run typecheck
```

Expected: all selected tests pass; existing CLI permission formatting is unchanged.

- [ ] **Step 6: Commit semantic interaction rendering**

```bash
git add src/tui/types.ts src/tui/transcript.ts src/i18n/locales/en.ts src/i18n/locales/zh.ts test/tui-transcript.test.ts test/i18n.test.ts
git commit -m "feat: render confirmations in TUI transcript"
```

---

### Task 4: Replace dialog resolution with persistent store interactions

**Files:**
- Modify: `src/tui/store.ts`
- Modify: `test/tui-store.test.ts`

**Interfaces:**
- Preserves: `requestPermission(tool, call, risk, signal?): Promise<PermissionDecision>`.
- Preserves: `requestConfirm(message, signal?): Promise<boolean>`.
- Produces: `resolveInteraction(answer: TuiInteractionAnswer): void`.
- Removes: `resolveDialog()` and all pending-dialog internals.

- [ ] **Step 1: Replace dialog tests with failing interaction lifecycle tests**

In `test/tui-store.test.ts`, replace the dialog test with cases that assert:

```ts
const permission = store.requestPermission(
  edit,
  {callId: "1", name: "edit", input: {path: "src/a.ts"}},
  "modify",
);
expect(store.getSnapshot().pendingInteraction).toMatchObject({
  kind: "permission",
  allowSession: true,
});
expect(store.getSnapshot().blocks.at(-1)).toMatchObject({
  kind: "interaction",
  status: "pending",
  lines: expect.arrayContaining(["path: src/a.ts"]),
});
store.resolveInteraction("s");
store.resolveInteraction("n");
await expect(permission).resolves.toBe("allow_session");
expect(store.getSnapshot().pendingInteraction).toBeUndefined();
expect(store.getSnapshot().blocks.at(-1)).toMatchObject({
  kind: "interaction",
  status: "resolved",
  answer: "s",
});
```

Add independent tests for:

- dangerous permission ignoring `s` and resolving on `n`;
- generic `y`/`n` mapping to booleans;
- abort resolving safe fallback and leaving `status: "cancelled"`;
- close settling once and preserving the cancelled block;
- a second concurrent request immediately returning fallback and adding an error block;
- at least 20 formatted input lines remaining in the permission block;
- control characters being sanitized.

- [ ] **Step 2: Run store tests and verify RED**

Run:

```bash
bun run vitest run test/tui-store.test.ts
```

Expected: tests fail because the store still exposes dialog state and `resolveDialog()`.

- [ ] **Step 3: Create interaction blocks without truncating tool input**

In `requestPermission()`, call:

```ts
const display = formatToolInput(
  {name: tool.name, risk, inputSchema: tool.inputSchema, input: call.input},
  {maxLines: Infinity, maxValueChars: Infinity, maxDepth: Infinity},
);
```

Create a stable string ID via `this.id("interaction")`, sanitize the tool name, and call a generic private opener with a permission interaction block, fallback `"deny"`, and the supplied signal.

In `requestConfirm()`, create a confirm block containing `sanitizeTerminalText(message)`, fallback `false`, and the supplied signal.

- [ ] **Step 4: Implement exact-once interaction settlement**

Replace `PendingDialog` with a private discriminated pending record keyed by the interaction block's string ID. Implement:

```ts
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
```

`settleInteraction()` must:

1. compare the requested ID with the currently pending ID;
2. clear `#pendingInteraction` before publishing state;
3. replace only the matching transcript block with `status` and optional `answer`;
4. remove the abort listener;
5. update `blocks` and delete `pendingInteraction` in one snapshot notification;
6. invoke the saved resolver once after the snapshot update.

The abort handler calls the same settlement path with `status: "cancelled"`, no answer, and the safe fallback. `close()` and `setFatal()` use that path before clearing listeners. Unexpected overlap calls `addError("interaction: another confirmation is already pending")` and immediately returns the fallback.

Update `update()` so an explicit `pendingInteraction: undefined` deletes the optional property, matching the old dialog cleanup behavior.

- [ ] **Step 5: Run store and controller tests**

Run:

```bash
bun run vitest run test/tui-store.test.ts test/tui-controller.test.ts
bun run typecheck
```

Expected: store tests pass; controller tests may still fail only where they assert dialog-specific names/state, which Task 5 updates.

- [ ] **Step 6: Commit the store lifecycle**

```bash
git add src/tui/store.ts test/tui-store.test.ts
git commit -m "feat: persist TUI confirmation interactions"
```

---

### Task 5: Route inline answers and remove the modal overlay

**Files:**
- Modify: `src/tui/app.tsx`
- Delete: `src/tui/components/permission-dialog.tsx`
- Modify: `test/tui-components.test.tsx`
- Modify: `test/tui-controller.test.ts`

**Interfaces:**
- Consumes: `snapshot.pendingInteraction` and `store.resolveInteraction(answer)` from Tasks 3-4.
- Preserves: `TuiController` wiring to `store.requestConfirm()` and `store.requestPermission()`.
- Removes: `PermissionDialog` rendering and dialog-focused input activation.

- [ ] **Step 1: Add failing root-routing tests and remove component dialog expectations**

Delete `PermissionDialog` imports and its risk-choice component test from `test/tui-components.test.tsx`.

Add root-level tests in the same file or `test/tui-frame.test.tsx` using an exported `TuiApp` and a real `TuiStore`. Assert:

- with a pending permission, `s` resolves `allow_session`;
- with a dangerous permission, `s` leaves it pending and `n` denies;
- with a generic confirm, `y` resolves `true`;
- `Esc` resolves safe denial;
- typed `abc` while pending never appears in the controlled editor frame;
- PageUp and mouse wheel still alter transcript follow state while pending;
- no frame contains a bordered centered overlay.

Update `test/tui-controller.test.ts`:

```ts
expect(store.getSnapshot().pendingInteraction).toBeUndefined();
```

Rename `"settles dialogs and disposes once during shutdown"` to `"settles inline interactions and disposes once during shutdown"`, then assert the retained final interaction block has `status: "cancelled"`.

- [ ] **Step 2: Run focused app/controller tests and verify RED**

Run:

```bash
bun run vitest run test/tui-components.test.tsx test/tui-frame.test.tsx test/tui-controller.test.ts
```

Expected: tests fail because `TuiApp` still reads `snapshot.dialog`, renders `PermissionDialog`, and does not route `pendingInteraction` keys.

- [ ] **Step 3: Add mutually exclusive interaction input routing**

Export `TuiApp` for the integration harness. Replace the dialog-only root `useInput` with:

```ts
const pendingInteraction = snapshot.pendingInteraction;
useInput(
  (input, key) => {
    if (key.ctrl && input === "c") {
      void controller.requestExit();
      return;
    }
    if (key.escape) {
      store.resolveInteraction("n");
      return;
    }
    const answer = input.toLowerCase();
    if (answer === "y" || answer === "n") store.resolveInteraction(answer);
    if (answer === "s" && pendingInteraction?.kind === "permission") {
      store.resolveInteraction("s");
    }
  },
  {isActive: Boolean(pendingInteraction)},
);
```

Keep transcript navigation active regardless of pending interaction:

```tsx
active={true}
```

Configure task input as:

```tsx
disabled={snapshot.running || Boolean(pendingInteraction)}
active={!pendingInteraction}
```

This keeps the rules and editor visible, suppresses the native cursor, and prevents task edits while the interaction handler owns confirmation keys.

- [ ] **Step 4: Remove overlay rendering and modal component**

Delete the `PermissionDialog` import and the absolute overlay JSX from `src/tui/app.tsx`. Delete `src/tui/components/permission-dialog.tsx`.

Do not change controller interaction callbacks; their Promise API now reaches the store's inline implementation.

- [ ] **Step 5: Run all TUI interaction tests**

Run:

```bash
bun run vitest run test/tui-components.test.tsx test/tui-frame.test.tsx test/tui-store.test.ts test/tui-controller.test.ts test/tui-transcript.test.ts
bun run typecheck
```

Expected: all selected tests pass, every request resolves through transcript state, and no modal component remains.

- [ ] **Step 6: Commit overlay removal and key routing**

```bash
git add src/tui/app.tsx src/tui/components/permission-dialog.tsx test/tui-components.test.tsx test/tui-controller.test.ts test/tui-frame.test.tsx
git commit -m "feat: handle all TUI confirmations inline"
```

---

### Task 6: Prove frame stability and document the final behavior

**Files:**
- Modify: `test/tui-frame.test.tsx`
- Modify: `test/tui-components.test.tsx`
- Modify: `README.md`
- Modify: `README.en.md`

**Interfaces:**
- Consumes: patched Ink cursor semantics, controlled `InputBar`, atomic `TuiApp` allocation, and inline interactions from Tasks 1-5.
- Produces: decoded-frame regression coverage for the two reported cursor/layout failures.

- [ ] **Step 1: Add decoded output-sequence assertions for continuation and row deletion**

In `test/tui-frame.test.tsx`, make the TTY output fixture feed every completed Ink write into `VirtualTerminal` and record snapshots:

```ts
type ScreenSnapshot = {
  lines: string[];
  cursor: {row: number; column: number};
  cursorVisible: boolean;
};
```

Add a continuation test that types `first\` then Enter. For every snapshot after input settles, assert:

```ts
expect(snapshot.lines.join("\n")).not.toContain("▏");
```

For the final snapshot assert the first editor line contains `Task > first`, the next editor line is present, and the only visible native cursor is on that second editor-content row at its first content column.

Add a deletion test that creates `first\nsecond`, moves to the second line start, and presses Backspace. Locate the status text by its stable provider/model prefix in every snapshot produced by that keypress and assert:

```ts
expect(statusRow).toBe(terminalRows - 1);
```

Also cover Tab, trailing space, Up/Down, Shift+Enter, CJK, wrap, submit reset, and terminal resize with final native cursor coordinates.

- [ ] **Step 2: Run frame tests repeatedly to detect timing regressions**

Run:

```bash
for run in 1 2 3 4 5; do
  bun run vitest run test/tui-frame.test.tsx test/tui-ink-cursor.test.tsx || exit 1
done
```

Expected: all five runs pass without status-row displacement or cursor variance.

- [ ] **Step 3: Update Chinese and English TUI documentation**

In `README.md`, amend the TUI behavior paragraph to state that all tool, workspace-trust, and plugin confirmations appear in transcript flow, the task input remains visible but disabled while waiting, and the completed prompt retains the selected answer.

In `README.en.md`, add the equivalent statement. Also remove the stale English phrase `confirmed idle Ctrl+C exits`; current controller behavior exits immediately while idle.

Keep the key descriptions exact:

```text
普通授权：y 允许一次、s 本会话、n/Esc 拒绝；危险操作不提供会话授权。
Normal permission: y allows once, s allows for the session, and n/Esc denies; dangerous operations do not offer session approval.
```

- [ ] **Step 4: Run formatting and the complete verification suite**

Run:

```bash
just fmt
just check
just build
node dist/index.js --help >/tmp/coden-tui-help.txt
grep -q -- "--tui" /tmp/coden-tui-help.txt
git diff --check
```

Expected: Biome leaves the tree formatted; all lint, type, and test checks pass; the Node artifact exposes `--tui`; no whitespace errors remain.

- [ ] **Step 5: Run a real terminal acceptance pass**

Run the built artifact in a real PTY with at least 80 columns and 24 rows:

```bash
node dist/index.js --tui
```

Verify in order:

1. type `first\` and Enter: only one blinking native cursor appears on the new row;
2. type `second`, move to its start, and Backspace: the status bar never flashes upward;
3. trigger a modification permission: no overlay appears, the task input stays visible and disabled, and `s` resolves in transcript;
4. trigger a dangerous permission: only `y/n` is offered and `s` has no effect;
5. trigger workspace/plugin confirmation: it also appears inline;
6. scroll during a long pending prompt, then press End to follow output;
7. press Ctrl+C during a pending tool permission: the turn cancels and the prompt remains marked cancelled;
8. exit and confirm alternate screen, mouse reporting, Kitty keyboard mode, and native cursor visibility are restored.

Record the PTY terminal name and any residual terminal-specific behavior in the commit body if a failure is observed; do not waive a failed acceptance item.

- [ ] **Step 6: Commit documentation and acceptance coverage**

```bash
git add README.md README.en.md test/tui-frame.test.tsx test/tui-components.test.tsx
git commit -m "test: verify stable TUI cursor and inline prompts"
```

---

## Final Review Checklist

- [ ] `rg -n "CURSOR_CHAR|▏|PermissionDialog|snapshot\.dialog|resolveDialog|onRowsChange" src test` returns no obsolete implementation references.
- [ ] `rg -n '"ink"' package.json` shows exact `7.1.1`, and `bun install --frozen-lockfile` applies `patches/ink@7.1.1.patch`.
- [ ] Every prompt category uses `TranscriptInteractionBlock`; no absolute overlay remains.
- [ ] Permission and confirmation Promise signatures consumed by `AgentApplication` are unchanged.
- [ ] Abort, close, fatal error, repeated keys, and unexpected concurrent prompts settle safely exactly once.
- [ ] Input layout, transcript capacity, status row, and native cursor coordinates derive from one parent render.
- [ ] `just check`, `just build`, Node artifact smoke test, five repeated frame tests, and real PTY acceptance all pass.
- [ ] `git status --short` contains only intentional changes; the pre-existing untracked `docs/superpowers/plans/2026-08-30-agent-lifecycle-hooks.md` remains untouched.
