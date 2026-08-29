# Streaming Line Preview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show a dim spinner and the raw buffered assistant line while interactive TTY Markdown waits for a complete line or closing fence.

**Architecture:** `MarkdownStreamRenderer` remains the sole owner of line and fence buffering and exposes the currently buffered raw preview through a read-only method. `TerminalRenderer` clears the transient stderr line before committing Markdown to stdout, then repaints the spinner with the preview or `rendering…`; all existing non-TTY paths remain untouched.

**Tech Stack:** TypeScript, Node.js streams/readline, marked, picocolors, Vitest, Biome, Bun

**Spec:** `docs/superpowers/specs/2026-08-29-streaming-line-preview-design.md`

## Global Constraints

- Enable previews only for interactive TTY rendering; non-TTY, `--print`, CI, and `NO_COLOR` output must remain unchanged.
- Preview sanitized raw text with Markdown delimiters intact; do not parse or style incomplete Markdown.
- Show only one dim transient line and tail-truncate it to the current terminal width.
- For fenced code, preview the latest buffered raw line, including a line whose newline has already arrived.
- Between a committed line and the next content delta, show `rendering…` while the provider remains active.
- Completion, retry, failure, tool start, and disposal must clear the preview and pending Markdown state.
- Do not add another timer, write preview content to stdout, persist it, or change fenced-block commit behavior.

---

### Task 1: Expose buffered Markdown preview state

**Files:**
- Modify: `src/observability/markdown.ts`
- Test: `test/markdown-terminal.test.ts`

**Interfaces:**
- Consumes: Existing `MarkdownStreamRenderer.push(text: string)`, `complete()`, and `reset()` buffering behavior.
- Produces: `MarkdownStreamRenderer.preview(): string | undefined`, returning an incomplete ordinary line, otherwise the latest buffered fence line without its trailing newline, otherwise `undefined`.

- [ ] **Step 1: Write failing tests for ordinary-line preview state**

Add this test to `test/markdown-terminal.test.ts`:

```ts
it("exposes the sanitized raw incomplete line as a preview", () => {
  const h = harness();

  h.renderer.push("**bo\u001b[31m");
  expect(h.renderer.preview()).toBe("**bo");
  expect(h.output()).toBe("");

  h.renderer.push("ld**\n");
  expect(h.renderer.preview()).toBeUndefined();
  expect(h.output()).toBe("bold\n");
});
```

This verifies that the preview stays raw, uses the existing control-character sanitizer, and disappears once the line is committed.

- [ ] **Step 2: Write failing tests for fenced-block preview state**

Add:

```ts
it("previews the latest buffered fenced-code line", () => {
  const h = harness();

  h.renderer.push("```ts\nconst first = 1;\n");
  expect(h.output()).toBe("");
  expect(h.renderer.preview()).toBe("const first = 1;");

  h.renderer.push("const second");
  expect(h.renderer.preview()).toBe("const second");

  h.renderer.push(" = 2;\n```\n");
  expect(h.renderer.preview()).toBeUndefined();
  expect(h.output()).toContain("const first = 1;\nconst second = 2;");
});
```

Extend the existing reset/completion coverage with exact preview assertions:

```ts
const reset = harness();
reset.renderer.push("pending");
expect(reset.renderer.preview()).toBe("pending");
reset.renderer.reset();
expect(reset.renderer.preview()).toBeUndefined();

const complete = harness();
complete.renderer.push("final");
expect(complete.renderer.preview()).toBe("final");
complete.renderer.complete();
expect(complete.renderer.preview()).toBeUndefined();
```

- [ ] **Step 3: Run the Markdown tests and verify the new API is missing**

Run:

```bash
bun run test -- test/markdown-terminal.test.ts
```

Expected: FAIL because `MarkdownStreamRenderer` has no `preview()` method.

- [ ] **Step 4: Implement the read-only preview method**

Add this public method after `push()` in `src/observability/markdown.ts`:

```ts
preview(): string | undefined {
  if (this.pending) return this.pending;
  const latestFenceLine = this.fence?.lines.at(-1);
  if (latestFenceLine === undefined) return undefined;
  return latestFenceLine.endsWith("\n") ? latestFenceLine.slice(0, -1) : latestFenceLine;
}
```

Do not create separate preview storage. `pending` and `fence.lines` are already sanitized by `push()`, so deriving the preview from them prevents stale or divergent state.

- [ ] **Step 5: Run the focused tests**

Run:

```bash
bun run test -- test/markdown-terminal.test.ts
```

Expected: all Markdown terminal tests PASS.

- [ ] **Step 6: Format and commit**

Run:

```bash
bun run format
git add src/observability/markdown.ts test/markdown-terminal.test.ts
git commit -m "feat: expose pending markdown preview"
```

Expected: one commit containing only the preview API and its tests.

---

### Task 2: Render the preview through the existing TTY activity line

**Files:**
- Modify: `src/observability/terminal.ts`
- Test: `test/plugin-terminal.test.ts`

**Interfaces:**
- Consumes: `MarkdownStreamRenderer.preview(): string | undefined` from Task 1, existing `renderActivityLine()`, `startSpinner()`, `stopSpinner()`, and `truncateDisplay(..., "tail")` behavior.
- Produces: TTY-only transient assistant previews on stderr; no new public API or runtime events.

- [ ] **Step 1: Write a failing integration test for partial-line preview and commit ordering**

Import `stripVTControlCharacters` from `node:util` at the top of `test/plugin-terminal.test.ts`, then add a helper near `Sink`:

```ts
function visibleTerminal(value: string): string {
  return stripVTControlCharacters(value);
}
```

Add this test beside the existing TTY Markdown tests:

```ts
it("previews a raw incomplete Markdown line and commits it when complete", async () => {
  const out = new Sink();
  const err = new Sink();
  Object.assign(err, { columns: 80 });
  const events = new EventBus();
  const renderer = new TerminalRenderer(events, { stdout: out, stderr: err, tty: true });

  await events.emit("provider.started");
  await events.emit("provider.delta", { text: "**bo" });
  expect(out.value).toBe("");
  expect(visibleTerminal(err.value)).toContain("**bo");

  await events.emit("provider.delta", { text: "ld**\n" });
  expect(visibleTerminal(out.value)).toContain("bold\n");
  expect(visibleTerminal(err.value)).toContain("rendering…");

  await events.emit("provider.completed", {});
  renderer.dispose();
});
```

The first assertion must fail before implementation because `finishThinking()` stops the spinner and the buffered text is not shown.

- [ ] **Step 2: Write failing tests for fenced-code and width behavior**

Add:

```ts
it("previews the newest fenced-code line within terminal width", async () => {
  const out = new Sink();
  const err = new Sink();
  Object.assign(err, { columns: 18 });
  const events = new EventBus();
  const renderer = new TerminalRenderer(events, { stdout: out, stderr: err, tty: true });

  await events.emit("provider.started");
  await events.emit("provider.delta", { text: "```ts\nfirst completed code line\n" });
  expect(out.value).toBe("");
  expect(visibleTerminal(err.value)).toContain("…leted code line");

  await events.emit("provider.delta", { text: "second partial" });
  expect(visibleTerminal(err.value)).toContain("second partial");

  await events.emit("provider.delta", { text: "\n```\n" });
  expect(visibleTerminal(out.value)).toContain("first completed code line\nsecond partial");
  renderer.dispose();
});
```

With 18 terminal columns, the activity renderer reserves two columns for the spinner and space, leaving 16 display columns: one for the ellipsis and 15 for `leted code line`.

- [ ] **Step 3: Extend lifecycle tests to prove stale previews are discarded**

Add a test that exercises retry, failure, tool-start, and disposal cleanup:

```ts
it("does not revive assistant previews after lifecycle cleanup", async () => {
  vi.useFakeTimers();
  const out = new Sink();
  const err = new Sink();
  const events = new EventBus();
  const renderer = new TerminalRenderer(events, { stdout: out, stderr: err, tty: true });

  await events.emit("provider.started");
  await events.emit("provider.delta", { text: "stale retry text" });
  await events.emit("provider.retry", { attempt: 1 });
  const retryBoundary = err.value.length;
  await events.emit("provider.started");
  vi.advanceTimersByTime(80);
  expect(visibleTerminal(err.value.slice(retryBoundary))).not.toContain("stale retry text");

  await events.emit("provider.delta", { text: "stale failure text" });
  await events.emit("turn.failed", { message: "failed" });
  const failureBoundary = err.value.length;
  await events.emit("provider.started");
  vi.advanceTimersByTime(80);
  expect(visibleTerminal(err.value.slice(failureBoundary))).not.toContain("stale failure text");

  await events.emit("provider.delta", { text: "stale tool text" });
  await events.emit("tool.started", { name: "read", summary: "path: a.ts" });
  const toolBoundary = err.value.length;
  await events.emit("provider.started");
  vi.advanceTimersByTime(80);
  expect(visibleTerminal(err.value.slice(toolBoundary))).not.toContain("stale tool text");

  await events.emit("provider.started");
  await events.emit("provider.delta", { text: "stale disposed text" });
  renderer.dispose();
  const disposeBoundary = err.value.length;
  vi.advanceTimersByTime(80);
  expect(visibleTerminal(err.value.slice(disposeBoundary))).not.toContain("stale disposed text");
});
```

The existing Markdown renderer tests cover completion and direct buffer reset. This integration test ensures later timer ticks or provider attempts cannot revive text discarded at every other lifecycle boundary.

- [ ] **Step 4: Run the terminal tests and verify failures**

Run:

```bash
bun run test -- test/plugin-terminal.test.ts
```

Expected: the new partial-line and fenced-preview assertions FAIL because activity text does not yet consult `markdown.preview()`.

- [ ] **Step 5: Clear transient output before Markdown writes**

Add a focused helper to `TerminalRenderer`:

```ts
private clearActivityLine(): void {
  if (!this.tty) return;
  readline.clearLine(this.stderr, 0);
  readline.cursorTo(this.stderr, 0);
}
```

Refactor `stopSpinner()` to call this helper after clearing the timer:

```ts
private stopSpinner(): void {
  if (!this.spinner) return;
  clearInterval(this.spinner);
  this.spinner = undefined;
  this.clearActivityLine();
}
```

This keeps terminal cursor manipulation in one place and ensures stdout never commits rendered content on top of a transient stderr line.

- [ ] **Step 6: Repaint content activity around each TTY provider delta**

Replace the TTY branch in the `provider.delta` handler with:

```ts
if (this.tty) {
  this.clearActivityLine();
  this.markdown.push(text);
  if (text) {
    this.startSpinner();
    this.renderActivityLine();
  }
} else this.pendingText += text;
```

Before flushing final Markdown in the `provider.completed` handler, clear the transient line:

```ts
if (this.tty) {
  this.clearActivityLine();
  this.markdown.complete();
}
```

Keep the existing subsequent `endProviderAttempt()` call so completion still stops the timer and resets all state.

- [ ] **Step 7: Add content preview priority to the activity text**

In `currentActivityText(maxColumns)`, retain the active tool-call block first. Immediately after it, add:

```ts
if (this.contentStarted) {
  const preview = this.markdown.preview();
  return preview === undefined ? "rendering…" : this.truncateTail(preview, maxColumns);
}
```

Then leave reasoning and `thinking` handling unchanged:

```ts
const reasoning = this.normalizedReasoning();
return reasoning ? this.truncateTail(reasoning, maxColumns) : "thinking";
```

This ordering prevents assistant text from replacing active streamed tool arguments and prevents old reasoning from reappearing after formal content starts.

- [ ] **Step 8: Run focused tests**

Run:

```bash
bun run test -- test/markdown-terminal.test.ts test/plugin-terminal.test.ts
```

Expected: all tests PASS, including the exact 18-column `…leted code line` suffix assertion.

- [ ] **Step 9: Run full validation and package checks**

Run:

```bash
just check
just build
node dist/index.js --version
npm pack --dry-run
```

Expected:

- Biome check passes;
- strict TypeScript check passes;
- all non-live tests pass and live credential tests remain skipped;
- build succeeds;
- CLI prints the current package version;
- package dry run contains only the intended published files and no `src` files.

- [ ] **Step 10: Commit the terminal integration**

Run:

```bash
git add src/observability/terminal.ts test/plugin-terminal.test.ts
git commit -m "feat: preview pending assistant lines"
```

Expected: a clean working tree with the feature represented by two implementation commits after the design and plan commits.
