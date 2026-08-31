# TUI Transcript Activity and Multiline Input Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move transient thinking into transcript flow and make the bordered TUI multiline editor reliable with `Shift+Enter` and predictable visual-row cursor movement.

**Architecture:** Keep providers, `AgentRuntime`, and `EventBus` unchanged. Extend the TUI transcript model with one store-owned transient activity block that the first real assistant delta replaces in place; separately, keep all editing semantics in the shared `EditorState`, render input boundaries in `InputBar`, and let the TUI root reserve their rows and opt into Ink's automatic Kitty keyboard support.

**Tech Stack:** TypeScript, React 19, Ink 7, Ink Kitty keyboard protocol support, wrap-ansi, Vitest, ink-testing-library, Biome, Bun tooling, Node.js 22+

**Spec:** `docs/superpowers/specs/2026-08-30-tui-transcript-activity-and-input-design.md`

## Global Constraints

- Do not change provider, runtime, event-bus, session persistence, or assistant Markdown event semantics.
- Every assistant character shown during generation must come from real `provider.delta` events; do not add timers, replay, simulated typing, or completed-response buffering.
- Reasoning and transient activity are presentation state only and must never become persisted `AgentMessage` content.
- At most one transient activity block may exist at any time.
- `Enter` submits; `Shift+Enter` inserts `\n`; odd trailing `\` plus `Enter` remains the compatibility fallback.
- Arrow keys edit the current draft only; history navigation remains exclusive to `Ctrl+P` and `Ctrl+N`.
- Use Ink's keyboard input path and automatic Kitty protocol support; do not add another stdin listener.
- Preserve grapheme-safe editing, CJK/emoji/combining-mark widths, tabs, explicit lines, automatic wrapping, IME cursor placement, mouse reporting, and Shift-drag terminal selection.
- The input has one terminal-width rule above and below its content, while the status bar stays below the lower rule.
- Use Bun as the JS/TS toolchain without Bun-only runtime APIs; format and lint with Biome; keep Node.js 22+ artifact compatibility.
- Follow TDD for each task and keep every focused task green before committing it.

## File Structure

### New production file

- `src/tui/activity.ts`: spinner frames and pure width-aware activity-line formatting shared by transcript rendering/tests.

### Modified production files

- `src/cli/editor-state.ts`: stop visual-row movement at draft boundaries instead of invoking history.
- `src/tui/types.ts`: add transient activity blocks and remove the obsolete snapshot-level activity string after migration.
- `src/tui/store.ts`: own the single transient activity block and replace it in place with streamed assistant output.
- `src/tui/transcript.ts`: render an activity block through the pure activity formatter.
- `src/tui/components/transcript-view.tsx`: animate activity blocks inside the virtualized transcript.
- `src/tui/components/input-bar.tsx`: render upper/lower rules and preserve shared layout coordinates for multiline input.
- `src/tui/app.tsx`: remove the fixed activity row, reserve two input-rule rows, correct cursor origin, and enable Kitty keyboard auto mode.
- `README.md`: update TUI layout and direction/history key documentation to match the shipped behavior.

### Deleted production file

- `src/tui/components/activity-line.tsx`: remove after activity rendering moves into transcript flow.

### Modified tests

- `test/editor-state.test.ts`: visual-boundary, explicit-line, wrapping, and explicit-history behavior.
- `test/tui-store.test.ts`: activity lifecycle, in-place replacement, real-delta accumulation, tools/review, retry/failure/close cleanup.
- `test/tui-transcript.test.ts`: activity formatting, localization fallback, and truncation.
- `test/tui-components.test.tsx`: transcript spinner, `Shift+Enter`, multiline movement, boundaries, and row reporting.
- `test/tui-layout.test.ts`: two-rule row allocation, cursor origin, and Kitty render configuration.

---

### Task 1: Decouple visual cursor movement from history navigation

**Files:**
- Modify: `src/cli/editor-state.ts:143-164`
- Modify: `test/editor-state.test.ts`

**Interfaces:**
- Consumes: `layoutEditor(text: string, cursor: number, terminalColumns: number): EditorLayout` and `offsetAtColumn(row: VisualRow, preferredColumn: number): number`.
- Produces: unchanged `EditorState.moveVertical(direction: -1 | 1, columns: number): void`, now constrained to the current draft.
- Produces: unchanged explicit `historyPrevious(): void` and `historyNext(): void` for `Ctrl+P`/`Ctrl+N` callers.

- [ ] **Step 1: Add failing tests for explicit lines, wrapped rows, and history boundaries**

Add these cases to `test/editor-state.test.ts`:

```ts
it("moves horizontally across explicit newline boundaries", () => {
  const state = new EditorState();
  state.insert("a\nb");

  state.moveHorizontal(-1);
  expect(state.cursor).toBe(2);
  state.moveHorizontal(-1);
  expect(state.cursor).toBe(1);
  state.moveHorizontal(1);
  expect(state.cursor).toBe(2);
});

it("moves vertically across explicit and wrapped visual rows", () => {
  const explicit = new EditorState();
  explicit.insert("abcd\nxy");
  explicit.moveVertical(-1, 80);
  expect(explicit.cursor).toBe(2);
  explicit.moveVertical(1, 80);
  expect(explicit.cursor).toBe(7);

  const wrapped = new EditorState();
  wrapped.insert("abcdef");
  wrapped.moveVertical(-1, 6);
  expect(wrapped.cursor).toBe(2);
  wrapped.moveVertical(1, 6);
  expect(wrapped.cursor).toBe(6);
});

it("stops vertical arrows at draft boundaries without recalling history", () => {
  const state = new EditorState(["history"]);
  state.insert("ab\ncd");

  state.moveVertical(1, 80);
  expect(state.text).toBe("ab\ncd");
  expect(state.cursor).toBe(5);

  state.moveVertical(-1, 80);
  state.moveVertical(-1, 80);
  expect(state.text).toBe("ab\ncd");
  expect(state.cursor).toBe(2);

  state.historyPrevious();
  expect(state.text).toBe("history");
});
```

- [ ] **Step 2: Run the focused tests and verify RED**

Run:

```bash
bun run vitest run test/editor-state.test.ts
```

Expected: the boundary test fails because `moveVertical(1, ...)` currently calls `historyNext()` and `moveVertical(-1, ...)` at the top currently calls `historyPrevious()`.

- [ ] **Step 3: Remove implicit history navigation from `moveVertical`**

Replace the boundary tail of `EditorState.moveVertical()` so the method only updates inside a valid target row:

```ts
moveVertical(direction: -1 | 1, columns: number): void {
  const layout = layoutEditor(this._text, this._cursor, columns);
  const contentColumn = Math.max(0, layout.cursor.column - 2);
  if (this.preferredColumn === undefined) this.preferredColumn = contentColumn;

  const targetRowIndex = layout.cursor.row + direction;
  if (targetRowIndex < 0 || targetRowIndex >= layout.rows.length) return;

  const targetRow = layout.rows[targetRowIndex];
  if (targetRow) this._cursor = offsetAtColumn(targetRow, this.preferredColumn);
}
```

Do not change `historyPrevious()` or `historyNext()`; `InputBar` already maps them only from `Ctrl+P` and `Ctrl+N`.

- [ ] **Step 4: Run editor tests and type checking**

Run:

```bash
bun run vitest run test/editor-state.test.ts test/editor-layout.test.ts test/multiline-editor.test.ts
bun run typecheck
```

Expected: all selected tests pass and TypeScript reports no errors.

- [ ] **Step 5: Commit the editor semantic fix**

```bash
git add src/cli/editor-state.ts test/editor-state.test.ts
git commit -m "fix: keep editor arrows within multiline drafts"
```

---

### Task 2: Add reliable multiline input boundaries and TUI keyboard configuration

**Files:**
- Modify: `src/tui/components/input-bar.tsx`
- Modify: `src/tui/app.tsx`
- Modify: `test/tui-components.test.tsx`
- Modify: `test/tui-layout.test.ts`

**Interfaces:**
- Consumes: `EditorState.enter(shift: boolean): EnterResult`, `EditorState.moveVertical(direction, columns)`, and `layoutEditor(text, cursor, editorColumns)`.
- Produces: `inputRule(columns: number): string` from `src/tui/components/input-bar.tsx` for deterministic rule tests.
- Produces in this task: `calculateTranscriptRows(terminalRows: number, inputRows: number, hasActivity: boolean): number`, reserving two rules, one status row, and the still-present fixed activity row when needed.
- Produces in this task: `calculateInputCursorTopRow(transcriptRows: number, hasActivity: boolean): number`, including the temporary fixed activity row, upper-rule row, and Ink full-screen compensation.
- Task 4 removes `hasActivity` from both signatures when it removes the fixed activity row.
- Produces: exported `TUI_RENDER_OPTIONS` with `kittyKeyboard.mode === "auto"` and `disambiguateEscapeCodes` enabled.
- Preserves: `InputBar.onRowsChange(rows)` reports editor content rows only; the parent adds the fixed two rule rows.

- [ ] **Step 1: Add failing component tests for rules, Shift+Enter, and multiline movement**

Update the existing input tests in `test/tui-components.test.tsx` and add:

```tsx
it("draws terminal-width rules around the input", () => {
  const view = render(
    <InputBar
      disabled={false}
      active={true}
      language="en"
      columns={12}
      onSubmit={() => {}}
      onEof={() => {}}
      onInterrupt={() => {}}
    />,
  );

  expect(view.lastFrame()?.split("\n")).toEqual([
    "────────────",
    "Task > ",
    "────────────",
  ]);
});

it("uses Kitty Shift+Enter for a newline and Enter for submission", async () => {
  const onSubmit = vi.fn();
  const view = render(
    <InputBar
      disabled={false}
      active={true}
      language="en"
      columns={50}
      onSubmit={onSubmit}
      onEof={() => {}}
      onInterrupt={() => {}}
    />,
  );

  view.stdin.write("first");
  view.stdin.write("\u001b[13;2u");
  view.stdin.write("second\r");
  await new Promise((resolve) => setTimeout(resolve, 20));

  expect(onSubmit).toHaveBeenCalledWith("first\nsecond");
});

it("moves within a multiline draft without switching history", async () => {
  const onSubmit = vi.fn();
  const view = render(
    <InputBar
      disabled={false}
      active={true}
      language="en"
      columns={50}
      onSubmit={onSubmit}
      onEof={() => {}}
      onInterrupt={() => {}}
    />,
  );

  view.stdin.write("abcd");
  view.stdin.write("\u001b[13;2u");
  view.stdin.write("xy");
  view.stdin.write("\u001b[A");
  view.stdin.write("\u001b[D");
  view.stdin.write("Z");
  view.stdin.write("\u0005");
  view.stdin.write("\u001b[B");
  view.stdin.write("\r");
  await new Promise((resolve) => setTimeout(resolve, 20));

  expect(onSubmit).toHaveBeenCalledWith("aZbcd\nxy");
});
```

Keep the existing `hello\\\r` continuation test; it is the regression assertion for the compatibility fallback. Update assertions that index rendered input rows because the upper rule is now row 0: for example, the narrow-boundary assertion becomes `view.lastFrame()?.split("\n")[1] === "Task > abcd"`. Existing `onRowsChange` expectations remain unchanged because they count editor content rows, not rules.

Add a resize/rerender assertion so rule width follows `columns`:

```tsx
it("resizes both input rules with terminal columns", () => {
  const props = {
    disabled: false,
    active: true,
    language: "en" as const,
    onSubmit: () => {},
    onEof: () => {},
    onInterrupt: () => {},
  };
  const view = render(<InputBar {...props} columns={8} />);
  expect(view.lastFrame()?.split("\n")[0]).toBe("────────");

  view.rerender(<InputBar {...props} columns={14} />);
  const lines = view.lastFrame()?.split("\n") ?? [];
  expect(lines[0]).toBe("──────────────");
  expect(lines.at(-1)).toBe("──────────────");
});
```

- [ ] **Step 2: Replace old layout tests with the two-rule contract**

Change `test/tui-layout.test.ts` to import `TUI_RENDER_OPTIONS` and assert:

```ts
import {
  TUI_RENDER_OPTIONS,
  calculateInputCursorTopRow,
  calculateTranscriptRows,
} from "../src/tui/app.js";
import { inputRule } from "../src/tui/components/input-bar.js";

it("reserves two input rules, status, and any temporary fixed activity row", () => {
  expect(calculateTranscriptRows(24, 1, false)).toBe(20);
  expect(calculateTranscriptRows(24, 3, false)).toBe(18);
  expect(calculateTranscriptRows(24, 1, true)).toBe(19);
  expect(20 + 1 + 2 + 1).toBe(24);
});

it("always leaves one transcript row", () => {
  expect(calculateTranscriptRows(2, 3, true)).toBe(1);
});

it("offsets the real cursor past activity and the upper input rule", () => {
  expect(calculateInputCursorTopRow(20, false)).toBe(22);
  expect(calculateInputCursorTopRow(19, true)).toBe(22);
});

it("draws at least one rule cell and follows terminal width", () => {
  expect(inputRule(0)).toBe("─");
  expect(inputRule(4)).toBe("────");
});

it("uses safe automatic Kitty keyboard detection", () => {
  expect(TUI_RENDER_OPTIONS.kittyKeyboard).toEqual({
    mode: "auto",
    flags: ["disambiguateEscapeCodes"],
  });
});
```

- [ ] **Step 3: Run focused tests and verify RED**

Run:

```bash
bun run vitest run test/tui-components.test.tsx test/tui-layout.test.ts
```

Expected: failures show missing input rules, old row calculations/signatures, missing `TUI_RENDER_OPTIONS`, and no render-level Kitty configuration.

- [ ] **Step 4: Render the upper and lower input rules**

In `src/tui/components/input-bar.tsx`, add the pure helper:

```ts
export function inputRule(columns: number): string {
  return "─".repeat(Math.max(1, columns));
}
```

Wrap existing editor rows with the rules while keeping `renderedRows = layout.rows.length`:

```tsx
return (
  <Box flexDirection="column">
    <Text dimColor>{inputRule(columns)}</Text>
    {layout.rows.map((row, index) => (
      <Text key={`${row.start}-${row.end}`} {...(index === 0 ? { color: "cyan" } : {})}>
        {index === 0 ? prompt : " ".repeat(promptWidth)}
        {row.text}
      </Text>
    ))}
    <Text dimColor>{inputRule(columns)}</Text>
  </Box>
);
```

Do not add the rules to `onRowsChange`; they are fixed layout rows owned by the parent calculation.

- [ ] **Step 5: Correct row allocation and real-cursor origin**

In `src/tui/app.tsx`, replace the activity-dependent helpers with:

```ts
export function calculateTranscriptRows(
  terminalRows: number,
  inputRows: number,
  hasActivity: boolean,
): number {
  return Math.max(1, terminalRows - Math.max(1, inputRows) - 3 - (hasActivity ? 1 : 0));
}

export function calculateInputCursorTopRow(
  transcriptRows: number,
  hasActivity: boolean,
): number {
  // Fixed activity (temporary), one upper rule, and Ink's full-screen compensation.
  return transcriptRows + (hasActivity ? 1 : 0) + 2;
}
```

Update the call sites with `Boolean(snapshot.activity)`. This preserves a correct intermediate layout while the fixed activity row still exists. Task 4 removes both the row and the boolean parameter.

- [ ] **Step 6: Export and apply safe Ink Kitty keyboard options**

Import `type RenderOptions` from Ink and define:

```ts
export const TUI_RENDER_OPTIONS = {
  alternateScreen: true,
  exitOnCtrlC: false,
  patchConsole: false,
  kittyKeyboard: {
    mode: "auto",
    flags: ["disambiguateEscapeCodes"],
  },
} satisfies RenderOptions;
```

Use it in `runTuiCommand`:

```ts
instance = render(<TuiApp controller={controller} store={store} i18n={i18n} />, TUI_RENDER_OPTIONS);
```

Automatic mode queries support only on interactive TTYs. Do not use `mode: "enabled"`, do not request event-type reporting, and do not add custom protocol escape writes.

- [ ] **Step 7: Run input, layout, mouse, and type tests**

Run:

```bash
bun run vitest run test/editor-state.test.ts test/editor-layout.test.ts test/tui-components.test.tsx test/tui-layout.test.ts test/tui-mouse.test.ts
bun run typecheck
```

Expected: all selected tests pass; Shift+Enter is parsed from `CSI 13;2u`; the continuation test still passes; TypeScript accepts `TUI_RENDER_OPTIONS`.

- [ ] **Step 8: Commit the multiline input surface**

```bash
git add src/tui/components/input-bar.tsx src/tui/app.tsx test/tui-components.test.tsx test/tui-layout.test.ts
git commit -m "fix: stabilize bordered TUI multiline input"
```

---

### Task 3: Add an activity block renderer inside the transcript

**Files:**
- Create: `src/tui/activity.ts`
- Modify: `src/tui/types.ts`
- Modify: `src/tui/transcript.ts`
- Modify: `src/tui/components/transcript-view.tsx`
- Modify: `test/tui-transcript.test.ts`
- Modify: `test/tui-components.test.tsx`

**Interfaces:**
- Produces: `TranscriptBlock` variant `{ id: string; kind: "activity"; phase: TuiPhase; text: string }`.
- Produces: `formatActivityLine(phase: TuiPhase, activity: string, fallback: string, columns: number, frame: number): string`.
- Produces: `ACTIVITY_FRAME_INTERVAL_MS = 80`.
- Extends: `renderTranscriptBlock(block, columns, i18n, activityFrame = 0): string`.
- Preserves: the existing snapshot-level activity field and fixed `ActivityLine` temporarily, so this task remains type-safe before store migration in Task 4.

- [ ] **Step 1: Add failing transcript formatting tests**

Append to `test/tui-transcript.test.ts`:

```ts
it("renders transient activity with localized fallback and a bounded spinner line", () => {
  const i18n = new I18n("zh");
  const fallback = renderTranscriptBlock(
    { id: "activity", kind: "activity", phase: "thinking", text: "" },
    20,
    i18n,
    0,
  );
  expect(fallback).toContain("⠋");
  expect(fallback).toContain("思考中");

  const long = renderTranscriptBlock(
    {
      id: "activity",
      kind: "activity",
      phase: "thinking",
      text: "one two three four five six",
    },
    12,
    new I18n("en"),
    1,
  );
  expect(displayWidth(long)).toBeLessThanOrEqual(12);
  expect(long).toContain("⠙");

  expect(
    renderTranscriptBlock(
      { id: "activity", kind: "activity", phase: "thinking", text: "narrow" },
      1,
      new I18n("en"),
      0,
    ),
  ).toBe("⠋");
});
```

Add `displayWidth` to the imports from `src/observability/terminal-text.ts`.

- [ ] **Step 2: Add a failing virtual transcript activity test**

In `test/tui-components.test.tsx`, add:

```tsx
it("renders thinking as the latest transcript block", () => {
  const view = render(
    <TranscriptView
      blocks={[
        { id: "u", kind: "user", text: "hello" },
        { id: "activity", kind: "activity", phase: "thinking", text: "checking files" },
      ]}
      columns={40}
      rows={6}
      followOutput={true}
      active={false}
      i18n={new I18n("en")}
      onFollowChange={() => {}}
    />,
  );

  expect(view.lastFrame()).toContain("> hello");
  expect(view.lastFrame()).toContain("checking files");
  expect(view.lastFrame()).toMatch(/[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/u);
});

it("keeps activity updates at the bottom only while follow mode is enabled", async () => {
  const i18n = new I18n("en");
  const onFollowChange = vi.fn();
  const base = Array.from({ length: 8 }, (_, index) => ({
    id: `line-${index}`,
    kind: "info" as const,
    text: `line ${index}`,
  }));
  const renderView = (blocks: TranscriptBlock[], followOutput: boolean) => (
    <TranscriptView
      blocks={blocks}
      columns={30}
      rows={4}
      followOutput={followOutput}
      active={true}
      i18n={i18n}
      onFollowChange={onFollowChange}
    />
  );
  const activity: TranscriptBlock = {
    id: "activity",
    kind: "activity",
    phase: "thinking",
    text: "first thought",
  };
  const view = render(renderView([...base, activity], true));
  expect(view.lastFrame()).toContain("first thought");

  view.stdin.write("\u001b[5~");
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(onFollowChange).toHaveBeenLastCalledWith(false);
  const scrolledFrame = view.lastFrame();

  view.rerender(
    renderView(
      [...base, { ...activity, text: "updated thought" }, { id: "new", kind: "info", text: "new" }],
      false,
    ),
  );
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(view.lastFrame()).toBe(scrolledFrame);

  view.rerender(renderView([...base, { ...activity, text: "updated thought" }], true));
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(view.lastFrame()).toContain("updated thought");
});
```

Add `TranscriptBlock` as a type import from `src/tui/types.ts`. Compare the set of visible non-activity `line N` labels before and after the rerender rather than relying on whole-frame equality, because the spinner frame legitimately changes every 80ms. Assert that those labels remain equal and that `updated thought` and `new` stay outside the manually scrolled viewport until follow mode becomes true.

- [ ] **Step 3: Run focused tests and verify RED**

Run:

```bash
bun run vitest run test/tui-transcript.test.ts test/tui-components.test.tsx
```

Expected: TypeScript/transformation or assertion failures occur because `activity` is not a `TranscriptBlock` and no transcript activity formatter exists.

- [ ] **Step 4: Create the pure activity formatter**

Create `src/tui/activity.ts`:

```ts
import { truncateDisplay } from "../observability/terminal-text.js";
import type { TuiPhase } from "./types.js";

const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"] as const;

export const ACTIVITY_FRAME_INTERVAL_MS = 80;

export function formatActivityLine(
  phase: TuiPhase,
  activity: string,
  fallback: string,
  columns: number,
  frame: number,
): string {
  const width = Math.max(1, columns);
  const spinner = FRAMES[Math.abs(frame) % FRAMES.length] ?? FRAMES[0];
  if (width === 1) return spinner;
  const label = activity || fallback || (phase === "submitting" ? "submitting" : phase);
  const text = width > 2 ? truncateDisplay(label, width - 2, "tail") : "";
  return `${spinner} ${text}`;
}
```

- [ ] **Step 5: Extend transcript types and rendering**

Add this variant to `TranscriptBlock` in `src/tui/types.ts`:

```ts
| { id: string; kind: "activity"; phase: TuiPhase; text: string }
```

In `src/tui/transcript.ts`, import `formatActivityLine`, give `renderTranscriptBlock` a fourth defaulted parameter, and add:

```ts
case "activity":
  return formatActivityLine(
    block.phase,
    block.text,
    _i18n?.messages.tui.phases[block.phase] ?? block.phase,
    columns,
    activityFrame,
  );
```

Rename `_i18n` to `i18n` if Biome flags a used underscore-prefixed argument, and use that name consistently.

- [ ] **Step 6: Animate activity inside `TranscriptView`**

In `src/tui/components/transcript-view.tsx`:

1. Import `ACTIVITY_FRAME_INTERVAL_MS`.
2. Add `const [activityFrame, setActivityFrame] = useState(0);`.
3. Derive `const hasActivity = blocks.some((block) => block.kind === "activity");`.
4. Add an effect that increments the frame only while activity exists and clears its interval on dependency change/unmount:

```ts
useEffect(() => {
  if (!hasActivity) return;
  const timer = setInterval(
    () => setActivityFrame((value) => value + 1),
    ACTIVITY_FRAME_INTERVAL_MS,
  );
  return () => clearInterval(timer);
}, [hasActivity]);
```

5. Pass `activityFrame` to `renderTranscriptBlock` and include it in the line-projection `useMemo` dependency array.

The activity remains a regular projected line, so existing `maximum`, offset, overscan, and follow-mode logic applies without a second viewport path.

- [ ] **Step 7: Run transcript/component tests and type checking**

Run:

```bash
bun run vitest run test/tui-transcript.test.ts test/tui-components.test.tsx
bun run typecheck
```

Expected: transcript and component tests pass, interval cleanup produces no open-handle warning, and TypeScript is clean.

- [ ] **Step 8: Commit transcript activity rendering**

```bash
git add src/tui/activity.ts src/tui/types.ts src/tui/transcript.ts src/tui/components/transcript-view.tsx test/tui-transcript.test.ts test/tui-components.test.tsx
git commit -m "feat: render transient activity in TUI transcript"
```

---

### Task 4: Migrate activity lifecycle into `TuiStore` and remove the fixed bottom row

**Files:**
- Modify: `src/tui/types.ts`
- Modify: `src/tui/store.ts`
- Modify: `src/tui/app.tsx`
- Delete: `src/tui/components/activity-line.tsx`
- Modify: `test/tui-store.test.ts`
- Modify: `test/tui-components.test.tsx`
- Modify: `test/tui-layout.test.ts`
- Modify: `README.md`

**Interfaces:**
- Consumes: activity `TranscriptBlock` and `TranscriptView` animation from Task 3.
- Produces: `TuiSnapshot` without `activity`; activity is represented only in `blocks`.
- Produces: private store helpers `showActivity(phase: TuiPhase, text: string): void`, `activityText(): string`, and `clearActivity(): void`.
- Preserves: public `setIdle()`, `setSubmitting()`, `setFatal()`, `apply(event)`, and real `provider.delta` handling.

- [ ] **Step 1: Expand store tests for the complete activity lifecycle**

Replace the first streamed-turn case in `test/tui-store.test.ts` with explicit intermediate assertions:

```ts
it("replaces thinking in place with real streamed assistant deltas", async () => {
  const events = new EventBus();
  const store = new TuiStore(new I18n("en"));
  store.connect(events);

  await events.emit("turn.started", { input: "hello" }, "turn");
  expect(store.getSnapshot().blocks.map((block) => block.kind)).toEqual(["user", "activity"]);

  await events.emit("provider.started", {}, "turn");
  await events.emit("provider.reasoning_delta", { text: " checking\nfiles " }, "turn");
  expect(store.getSnapshot().blocks[1]).toMatchObject({
    kind: "activity",
    phase: "thinking",
    text: "checking files",
  });

  await events.emit("provider.delta", { text: "final " }, "turn");
  expect(store.getSnapshot().blocks[1]).toMatchObject({
    kind: "assistant",
    markdown: "final ",
  });
  expect(store.getSnapshot().blocks).toHaveLength(2);

  await events.emit("provider.delta", { text: "answer" }, "turn");
  expect(store.getSnapshot().blocks[1]).toMatchObject({
    kind: "assistant",
    markdown: "final answer",
  });

  await events.emit("provider.completed", {}, "turn");
  await events.emit("turn.completed", { inputTokens: 3, outputTokens: 4, durationMs: 5 }, "turn");
  expect(store.getSnapshot()).toMatchObject({
    phase: "idle",
    running: false,
    turnUsage: { inputTokens: 3, outputTokens: 4, durationMs: 5 },
  });
  expect(store.getSnapshot().blocks.some((block) => block.kind === "activity")).toBe(false);
});
```

Import `I18n` in this test file.

- [ ] **Step 2: Add failing tests for deduplication, tools/review, and cleanup**

Add:

```ts
it("keeps one transient block across repeated starts and tool preparation", async () => {
  const events = new EventBus();
  const store = new TuiStore();
  store.connect(events);

  await events.emit("turn.started", { input: "hello" }, "turn");
  await events.emit("provider.started", {}, "turn");
  await events.emit("provider.started", {}, "turn");
  expect(store.getSnapshot().blocks.filter((block) => block.kind === "activity")).toHaveLength(1);

  await events.emit("provider.tool_call_start", { index: 0, name: "read" }, "turn");
  await events.emit(
    "provider.tool_call_delta",
    { index: 0, argumentsDelta: '{"path":"src/a.ts"}' },
    "turn",
  );
  expect(store.getSnapshot().blocks.at(-1)).toMatchObject({ kind: "activity", phase: "tool" });

  await events.emit("tool.started", { name: "read", summary: "src/a.ts" }, "turn");
  expect(store.getSnapshot().blocks.some((block) => block.kind === "activity")).toBe(false);

  await events.emit("permission.review_started", { name: "edit" }, "turn");
  expect(store.getSnapshot().blocks.at(-1)).toMatchObject({
    kind: "activity",
    phase: "reviewing",
  });
  await events.emit("permission.review_completed", { name: "edit" }, "turn");
  expect(store.getSnapshot().blocks.some((block) => block.kind === "activity")).toBe(false);
});

it.each([
  ["provider.completed", {}],
  ["provider.retry", { attempt: 1 }],
  ["turn.completed", {}],
  ["turn.failed", { message: "cancelled" }],
] as const)("cleans transient activity on %s", async (type, data) => {
  const events = new EventBus();
  const store = new TuiStore();
  store.connect(events);

  await events.emit("provider.started", {}, "turn");
  await events.emit(type, data, "turn");
  expect(store.getSnapshot().blocks.some((block) => block.kind === "activity")).toBe(false);
});

it("cleans transient activity on controller state changes and close", async () => {
  const events = new EventBus();
  const store = new TuiStore();
  store.connect(events);

  await events.emit("provider.started", {}, "turn");
  store.setSubmitting();
  expect(store.getSnapshot().blocks.some((block) => block.kind === "activity")).toBe(false);

  await events.emit("provider.started", {}, "turn");
  store.setIdle();
  expect(store.getSnapshot().blocks.some((block) => block.kind === "activity")).toBe(false);

  await events.emit("provider.started", {}, "turn");
  store.setFatal(new Error("fatal"));
  expect(store.getSnapshot().blocks.some((block) => block.kind === "activity")).toBe(false);

  await events.emit("provider.started", {}, "turn");
  store.close();
  expect(store.getSnapshot().blocks.some((block) => block.kind === "activity")).toBe(false);
});
```

Retain the existing failed-attempt assistant retry test to ensure streamed text from a failed provider attempt is discarded.

- [ ] **Step 3: Run focused tests and verify RED**

Run:

```bash
bun run vitest run test/tui-store.test.ts test/tui-layout.test.ts test/tui-components.test.tsx
```

Expected: store assertions fail because activity still lives in `snapshot.activity`, and app/component assertions still include the fixed bottom activity row.

- [ ] **Step 4: Replace snapshot activity with a store-owned block identity**

In `src/tui/types.ts`, remove:

```ts
activity: string;
```

from `TuiSnapshot`.

In `src/tui/store.ts`:

- Remove `activity` from `INITIAL` and every snapshot patch.
- Add `#activeActivity: string | undefined;`.
- Change `setPhase` to accept only `phase: TuiPhase`, or remove it because no external caller currently uses it.
- Implement the helpers:

```ts
private showActivity(phase: TuiPhase, text: string): void {
  const blocks = [...this.#snapshot.blocks];
  if (this.#activeActivity) {
    const index = blocks.findIndex((block) => block.id === this.#activeActivity);
    if (index >= 0) {
      blocks[index] = { id: this.#activeActivity, kind: "activity", phase, text };
      this.update({ blocks, phase });
      return;
    }
  }

  const id = this.id("activity");
  this.#activeActivity = id;
  this.update({ blocks: [...blocks, { id, kind: "activity", phase, text }], phase });
}

private activityText(): string {
  if (!this.#activeActivity) return "";
  const block = this.#snapshot.blocks.find((candidate) => candidate.id === this.#activeActivity);
  return block?.kind === "activity" ? block.text : "";
}

private clearActivity(): void {
  if (!this.#activeActivity) return;
  const id = this.#activeActivity;
  this.#activeActivity = undefined;
  this.update({ blocks: this.#snapshot.blocks.filter((block) => block.id !== id) });
}
```

`setRecoveredMessages()` must set `#activeActivity = undefined` before replacing blocks.

- [ ] **Step 5: Map runtime events to the transient block**

Apply these exact event rules in `TuiStore.apply()`:

- `turn.started`: clear old activity, clear active assistant/tool preview, add the user block, then `showActivity("thinking", "")`, and set `running: true`.
- `provider.started`: clear active assistant/tool preview, then `showActivity("thinking", "")` without appending a duplicate.
- `provider.reasoning_delta`: normalize `${activityText()}${delta}` with `.replace(/\s+/g, " ").trim()`, then `showActivity("thinking", normalized)`.
- `provider.tool_call_start`/`provider.tool_call_delta`: retain `#toolPreview` accumulation and call `showActivity("tool", preview)`.
- `provider.tool_call_end`: clear tool preview and activity.
- `tool.started`: clear activity before adding the durable `◇ tool` block.
- `permission.review_started`: call `showActivity("reviewing", localizedReviewText)`.
- `permission.review_completed` and `permission.review_failed`: clear activity and restore phase `tool`.
- `provider.completed`, `provider.retry`, `turn.completed`, `turn.failed`, `setIdle`, `setFatal`, and `close`: clear activity.
- `setSubmitting`: clear stale activity before marking the controller busy.
- `provider.retry`: also retain `discardActiveAssistant()`.

Avoid leaving a fallback label in `block.text`; an empty text allows transcript rendering to localize the current phase.

- [ ] **Step 6: Replace activity in place on the first assistant delta**

Update `appendAssistant()` so a new assistant uses the transient block's index when present:

```ts
private appendAssistant(text: string, turnId: string | undefined): void {
  if (!text) return;
  const id =
    this.#activeAssistant ??
    (turnId ? `assistant-${turnId}-${this.#nextId++}` : this.id("assistant"));
  const blocks = [...this.#snapshot.blocks];

  if (!this.#activeAssistant && this.#activeActivity) {
    const activityIndex = blocks.findIndex((block) => block.id === this.#activeActivity);
    this.#activeActivity = undefined;
    this.#activeAssistant = id;
    if (activityIndex >= 0) {
      blocks[activityIndex] = { id, kind: "assistant", markdown: text };
      this.update({ blocks, phase: "rendering" });
      return;
    }
  }

  this.#activeAssistant = id;
  const index = blocks.findIndex((block) => block.id === id);
  if (index >= 0) {
    const current = blocks[index];
    if (current?.kind === "assistant") {
      blocks[index] = { ...current, markdown: `${current.markdown}${text}` };
    }
  } else {
    blocks.push({ id, kind: "assistant", markdown: text });
  }
  this.update({ blocks, phase: "rendering" });
}
```

Do not debounce this method. Every invocation corresponds to one already-received `provider.delta` and must synchronously update the store.

- [ ] **Step 7: Remove the fixed activity component from the root layout**

In `src/tui/app.tsx`:

- Delete the `ActivityLine` import and JSX.
- Change `calculateTranscriptRows` to `(terminalRows: number, inputRows: number)` and retain `Math.max(1, terminalRows - Math.max(1, inputRows) - 3)`.
- Change `calculateInputCursorTopRow` to `(transcriptRows: number)` and return `transcriptRows + 2`.
- Update both call sites to omit activity state.
- Leave `TranscriptView` as the only activity renderer.

Update `test/tui-layout.test.ts` to the final signatures and remove the temporary activity assertions:

```ts
expect(calculateTranscriptRows(24, 1)).toBe(20);
expect(calculateTranscriptRows(24, 3)).toBe(18);
expect(calculateInputCursorTopRow(20)).toBe(22);
```

Delete `src/tui/components/activity-line.tsx` and remove its direct test/import from `test/tui-components.test.tsx`; the equivalent width/spinner assertions now live in transcript tests from Task 3.

Update the TUI paragraph in `README.md` so it no longer says activity is fixed at the bottom. State that transient thinking/tool activity follows the current transcript, the input is bounded by horizontal rules, arrows move within explicit/wrapped draft rows, and only `Ctrl+P`/`Ctrl+N` navigate input history. Keep the existing Enter, Shift+Enter, trailing-backslash fallback, scrolling, cancellation, and single-task descriptions.

- [ ] **Step 8: Run all TUI-focused tests and type checking**

Run:

```bash
bun run vitest run \
  test/tui-store.test.ts \
  test/tui-transcript.test.ts \
  test/tui-components.test.tsx \
  test/tui-layout.test.ts \
  test/tui-controller.test.ts \
  test/tui-mouse.test.ts
bun run typecheck
```

Expected: every selected test passes; no source/test reference to `snapshot.activity` or `ActivityLine` remains.

Confirm with:

```bash
rg -n "snapshot\.activity|components/activity-line|<ActivityLine" src test
```

Expected: no matches.

- [ ] **Step 9: Commit the store and layout migration**

```bash
git add src/tui/types.ts src/tui/store.ts src/tui/app.tsx src/tui/components/activity-line.tsx test/tui-store.test.ts test/tui-components.test.tsx test/tui-layout.test.ts README.md
git commit -m "feat: move TUI thinking into transcript flow"
```

---

### Task 5: Run regression validation and artifact smoke tests

**Files:**
- Verify only; modify production/tests only if a regression is exposed, then include the fix and its regression test in the corresponding earlier task commit or a focused follow-up commit.

**Interfaces:**
- Verifies: real provider-delta propagation remains `provider.stream` → `AgentRuntime` → `EventBus` → `TuiStore.appendAssistant`.
- Verifies: terminal protocols, alternate screen, mouse reporting, and cursor state remain owned/restored by Ink and the existing mouse hook.
- Produces: command evidence for the completed implementation.

- [ ] **Step 1: Inspect the final diff for accidental streaming/runtime changes**

Run:

```bash
git diff HEAD~4 -- src/providers src/core/runtime.ts src/core/events.ts
```

Expected: no diff. If the number of implementation commits differs, compare against the design commit `6fdde3f` instead:

```bash
git diff 6fdde3f -- src/providers src/core/runtime.ts src/core/events.ts
```

Expected: no diff.

- [ ] **Step 2: Run the complete project check**

Run:

```bash
just check
```

Expected: Biome, TypeScript, and the full Vitest suite pass with no new skipped tests.

- [ ] **Step 3: Build the distributable Node artifact**

Run:

```bash
just build
```

Expected: `dist/index.js`, `dist/plugin/index.js`, and `dist/plugin/index.d.ts` are generated successfully.

- [ ] **Step 4: Smoke-test the Node CLI artifact**

Run:

```bash
node dist/index.js --help >/tmp/coden-tui-help.txt
grep -q -- "--tui" /tmp/coden-tui-help.txt
grep -q -- "--cli" /tmp/coden-tui-help.txt
```

Expected: all commands exit zero.

- [ ] **Step 5: Check formatting, whitespace, and repository state**

Run:

```bash
git diff --check
git status --short
```

Expected: `git diff --check` prints nothing. Repository status contains no unintended source files, generated `dist` files, staged files, or unrelated edits.

If validation exposes a defect, return to the task that owns that behavior, add a focused failing regression test, make the minimal correction, rerun that task's focused commands and `just check`, and commit the exact files changed by that correction. Do not create an empty validation commit.
