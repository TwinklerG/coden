# Tool Call Delta Terminal Display Implementation Plan

<!-- markdownlint-disable MD013 -->

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Display streamed tool-call arguments as a temporary dim TTY status line so long tool payloads do not make CodeN appear stuck.

**Architecture:** Extend `accumulateStream` with one provider-neutral tool-call lifecycle callback and have `AgentRuntime` forward those events through the existing event bus. Keep all preview accumulation, truncation, and cleanup inside `TerminalRenderer`, with no tool arguments written by the renderer in non-TTY mode.

**Tech Stack:** TypeScript 5.9, Node.js readline streams, picocolors, Vitest 3, Bun, Biome, Just

**Spec:** `docs/superpowers/specs/2026-08-29-tool-call-delta-terminal-design.md`

## Global Constraints

- Do not use Bun-specific APIs; use Bun only as the JS/TS toolchain.
- Use Biome for TypeScript linting and formatting.
- Do not change tool-call JSON assembly, parsing, execution, permission checks, or persistence.
- Show tool-call argument previews only on interactive TTY stderr.
- Keep non-TTY stdout/stderr behavior unchanged and never print streamed arguments there.
- Render one ephemeral dim line, normalize whitespace, and truncate to terminal width.
- Clear transient tool-call state on end, formal text, completion, retry, failure, tool start, and disposal.
- Do not add dependencies or user-facing configuration.

## File Structure

- Modify `src/core/runtime.ts` to define a tool-call stream callback, invoke it during assembly, and emit lifecycle runtime events.
- Modify `src/observability/terminal.ts` to own ephemeral per-index tool previews and integrate them with the existing spinner/reasoning line.
- Modify `test/providers.test.ts` to verify callback order without changing assembled calls.
- Modify `test/runtime.integration.test.ts` to verify event-bus forwarding and turn IDs.
- Modify `test/plugin-terminal.test.ts` to verify TTY rendering, truncation, cleanup, and non-TTY isolation.

---

### Task 1: Forward the streamed tool-call lifecycle

**Files:**

- Modify: `src/core/runtime.ts:248-273,298-365`
- Test: `test/providers.test.ts:126-147`
- Test: `test/runtime.integration.test.ts:284-315`

**Interfaces:**

- Consumes: existing `ModelEvent` variants `tool_call_start`, `tool_call_delta`, and `tool_call_end`.
- Produces: exported type `ToolCallStreamEvent = Extract<ModelEvent, { type: "tool_call_start" | "tool_call_delta" | "tool_call_end" }>`.
- Produces: `accumulateStream(stream, onText?, onReasoning?, onToolCall?)`, where `onToolCall` has type `(event: ToolCallStreamEvent) => void | Promise<void>`.
- Produces: runtime events `provider.tool_call_start`, `provider.tool_call_delta`, and `provider.tool_call_end`, preserving event fields in `data` and the active `turnId`.
- Preserves: the result shape `{ text: string; toolCalls: ToolCall[]; usage: Usage }` and all existing validation errors.

- [ ] **Step 1: Extend the stream assembly test with lifecycle observations**

Replace the existing `"assembles streamed tool arguments"` test in `test/providers.test.ts` with:

```ts
it("assembles streamed tool arguments and reports their lifecycle", async () => {
  const toolEvents: ModelEvent[] = [];
  const result = await accumulateStream(
    events([
      { type: "text_delta", text: "checking" },
      { type: "tool_call_start", index: 0, callId: "c1", name: "read" },
      { type: "tool_call_delta", index: 0, argumentsDelta: '{"path":' },
      { type: "tool_call_delta", index: 0, argumentsDelta: '"a"}' },
      { type: "tool_call_end", index: 0 },
      { type: "usage", usage: { inputTokens: 10, outputTokens: 3 } },
      { type: "done" },
    ]),
    undefined,
    undefined,
    (event) => {
      toolEvents.push(event);
    },
  );

  expect(toolEvents).toEqual([
    { type: "tool_call_start", index: 0, callId: "c1", name: "read" },
    { type: "tool_call_delta", index: 0, argumentsDelta: '{"path":' },
    { type: "tool_call_delta", index: 0, argumentsDelta: '"a"}' },
    { type: "tool_call_end", index: 0 },
  ]);
  expect(result).toEqual({
    text: "checking",
    toolCalls: [{ callId: "c1", name: "read", input: { path: "a" } }],
    usage: { inputTokens: 10, outputTokens: 3 },
  });
});
```

- [ ] **Step 2: Add a failing runtime event-forwarding test**

Add this test near the reasoning forwarding test in `test/runtime.integration.test.ts`:

```ts
it("forwards streamed tool-call lifecycle events with one turn ID", async () => {
  const provider = new ScriptedProvider([
    scriptedTool("w", "write", { path: "a.txt", content: "hello" }),
    scriptedText("done"),
  ]);
  const h = await harness(provider);
  const lifecycle: Array<{
    type: string;
    turnId?: string;
    data?: Record<string, unknown>;
  }> = [];
  h.events.on((event) => {
    if (event.type.startsWith("provider.tool_call_")) lifecycle.push(event);
  });

  await h.runtime.run("write a file");

  expect(lifecycle.map(({ type, data }) => ({ type, data }))).toEqual([
    {
      type: "provider.tool_call_start",
      data: { index: 0, callId: "w", name: "write" },
    },
    {
      type: "provider.tool_call_delta",
      data: { index: 0, argumentsDelta: '{"path":"a.txt","content":"hello"}' },
    },
    { type: "provider.tool_call_end", data: { index: 0 } },
  ]);
  expect(lifecycle[0]?.turnId).toBeTruthy();
  expect(new Set(lifecycle.map((event) => event.turnId)).size).toBe(1);
});
```

- [ ] **Step 3: Run the focused tests and verify they fail**

Run:

```bash
bun run test -- test/providers.test.ts test/runtime.integration.test.ts \
  -t "tool-call lifecycle|reports their lifecycle"
```

Expected: FAIL because `accumulateStream` accepts no tool-call callback and the runtime emits no `provider.tool_call_*` events.

- [ ] **Step 4: Define the lifecycle callback and invoke it after stream validation**

Add this exported type immediately before `accumulateStream` in `src/core/runtime.ts`:

```ts
export type ToolCallStreamEvent = Extract<
  ModelEvent,
  { type: "tool_call_start" | "tool_call_delta" | "tool_call_end" }
>;
```

Extend the function signature:

```ts
export async function accumulateStream(
  stream: AsyncIterable<ModelEvent>,
  onText?: (text: string) => void | Promise<void>,
  onReasoning?: (text: string) => void | Promise<void>,
  onToolCall?: (event: ToolCallStreamEvent) => void | Promise<void>,
): Promise<{ text: string; toolCalls: ToolCall[]; usage: Usage }> {
```

Replace the three tool-call branches in the event loop with braced branches that preserve current builder mutations and then invoke the callback:

```ts
} else if (event.type === "tool_call_start") {
  builders.set(event.index, {
    callId: event.callId,
    name: event.name,
    json: "",
    ended: false,
  });
  await onToolCall?.(event);
} else if (event.type === "tool_call_delta") {
  const builder = builders.get(event.index);
  if (!builder)
    throw new CodeNError(
      "provider",
      "provider.invalid_stream",
      "Tool arguments arrived before tool start",
    );
  builder.json += event.argumentsDelta;
  await onToolCall?.(event);
} else if (event.type === "tool_call_end") {
  const builder = builders.get(event.index);
  if (builder) {
    builder.ended = true;
    await onToolCall?.(event);
  }
} else if (event.type === "usage") {
```

Do not invoke the callback for an invalid delta-before-start or an end with no known builder. Existing errors and result assembly remain unchanged.

- [ ] **Step 5: Forward lifecycle events from `requestWithRetry`**

Pass a fourth callback in the existing `accumulateStream` call in `requestWithRetry`:

```ts
const result = await accumulateStream(
  this.provider.stream(request),
  async (text) => {
    await this.events.emit("provider.delta", { text }, turnId);
  },
  async (text) => {
    await this.events.emit("provider.reasoning_delta", { text }, turnId);
  },
  async (event) => {
    if (event.type === "tool_call_start") {
      await this.events.emit(
        "provider.tool_call_start",
        { index: event.index, callId: event.callId, name: event.name },
        turnId,
      );
    } else if (event.type === "tool_call_delta") {
      await this.events.emit(
        "provider.tool_call_delta",
        { index: event.index, argumentsDelta: event.argumentsDelta },
        turnId,
      );
    } else {
      await this.events.emit("provider.tool_call_end", { index: event.index }, turnId);
    }
  },
);
```

Leave the summary-refinement `accumulateStream` call without callbacks so its internal activity is not rendered as part of the user turn.

- [ ] **Step 6: Format and run provider/runtime tests**

Run:

```bash
bun run format
bun run test -- test/providers.test.ts test/runtime.integration.test.ts
```

Expected: both test files pass. Assembly still returns the parsed `read` call, and the integration test observes start, delta, and end under one non-empty turn ID.

- [ ] **Step 7: Commit runtime lifecycle forwarding**

```bash
git add src/core/runtime.ts test/providers.test.ts test/runtime.integration.test.ts
git commit -m "feat: forward tool call stream events"
```

---

### Task 2: Render and clean up the ephemeral TTY preview

**Files:**

- Modify: `src/observability/terminal.ts:14-158`
- Test: `test/plugin-terminal.test.ts:145-260,352-403`

**Interfaces:**

- Consumes: `provider.tool_call_start` data `{ index, callId, name }`, `provider.tool_call_delta` data `{ index, argumentsDelta }`, and `provider.tool_call_end` data `{ index }` from Task 1.
- Produces: a dim TTY stderr activity line `⠋ preparing <name>… <argument-tail>`.
- Maintains: `Map<number, { name: string; argumentsText: string }>` and one active index so interleaved calls remain independent.
- Preserves: existing reasoning display, `thought for x.xs`, stdout streaming, non-TTY buffering, and retry semantics.

- [ ] **Step 1: Add a failing TTY preview and width test**

Add this test after the reasoning display tests in `test/plugin-terminal.test.ts`:

```ts
it("renders streamed tool arguments as a bounded TTY activity line", async () => {
  vi.useFakeTimers();
  const out = new Sink();
  const err = new Sink();
  Object.assign(err, { columns: 38 });
  const events = new EventBus();
  const renderer = new TerminalRenderer(events, { stdout: out, stderr: err, tty: true });

  await events.emit("provider.started");
  await events.emit("provider.tool_call_start", {
    index: 0,
    callId: "w",
    name: "write",
  });
  expect(err.value).toContain("preparing write…");

  const beforeDelta = err.value.length;
  await events.emit("provider.tool_call_delta", {
    index: 0,
    argumentsDelta: '{"path":"src/a.ts",\n"content":"a deliberately long payload"}',
  });
  const latestRender = err.value.slice(beforeDelta);
  expect(latestRender).toContain("preparing write…");
  expect(latestRender).toContain("…");
  expect(latestRender).not.toContain("\n\"content");
  expect(out.value).toBe("");

  renderer.dispose();
});
```

The assertion checks semantic output rather than ANSI escape sequences; `pc.dim` may be disabled by the test environment.

- [ ] **Step 2: Add failing lifecycle cleanup and non-TTY isolation tests**

Add these tests to the same describe block:

```ts
it("clears tool argument previews across terminal lifecycle boundaries", async () => {
  vi.useFakeTimers();
  const out = new Sink();
  const err = new Sink();
  const events = new EventBus();
  const renderer = new TerminalRenderer(events, { stdout: out, stderr: err, tty: true });

  await events.emit("provider.started");
  await events.emit("provider.tool_call_start", { index: 0, callId: "w", name: "write" });
  await events.emit("provider.tool_call_delta", {
    index: 0,
    argumentsDelta: '{"content":"secret-end"}',
  });
  await events.emit("provider.tool_call_end", { index: 0 });
  const afterEnd = err.value.length;
  vi.advanceTimersByTime(100);
  expect(err.value.slice(afterEnd)).not.toContain("secret-end");

  await events.emit("provider.tool_call_start", { index: 1, callId: "e", name: "edit" });
  await events.emit("provider.tool_call_delta", {
    index: 1,
    argumentsDelta: '{"newText":"secret-text"}',
  });
  await events.emit("provider.delta", { text: "answer" });
  const afterText = err.value.length;
  vi.advanceTimersByTime(100);
  expect(err.value.slice(afterText)).not.toContain("secret-text");

  await events.emit("provider.started");
  await events.emit("provider.tool_call_start", { index: 2, callId: "b", name: "bash" });
  await events.emit("provider.tool_call_delta", {
    index: 2,
    argumentsDelta: '{"command":"secret-retry"}',
  });
  await events.emit("provider.retry", { attempt: 1 });
  const afterRetry = err.value.length;
  vi.advanceTimersByTime(100);
  expect(err.value.slice(afterRetry)).not.toContain("secret-retry");

  await events.emit("provider.started");
  await events.emit("provider.tool_call_start", { index: 3, callId: "r", name: "read" });
  await events.emit("provider.tool_call_delta", {
    index: 3,
    argumentsDelta: '{"path":"secret-tool-start"}',
  });
  await events.emit("tool.started", { name: "read" });
  const afterToolStart = err.value.length;
  vi.advanceTimersByTime(100);
  expect(err.value.slice(afterToolStart)).not.toContain("secret-tool-start");

  await events.emit("provider.started");
  await events.emit("provider.tool_call_start", { index: 4, callId: "r2", name: "read" });
  await events.emit("provider.tool_call_delta", {
    index: 4,
    argumentsDelta: '{"path":"secret-dispose"}',
  });
  renderer.dispose();
  const afterDispose = err.value.length;
  vi.advanceTimersByTime(100);
  expect(err.value.slice(afterDispose)).not.toContain("secret-dispose");
});

it("never renders streamed tool arguments in non-TTY mode", async () => {
  const out = new Sink();
  const err = new Sink();
  const events = new EventBus();
  const renderer = new TerminalRenderer(events, { stdout: out, stderr: err, tty: false });

  await events.emit("provider.started");
  await events.emit("provider.tool_call_start", { index: 0, callId: "w", name: "write" });
  await events.emit("provider.tool_call_delta", {
    index: 0,
    argumentsDelta: '{"content":"must-not-leak"}',
  });
  await events.emit("provider.tool_call_end", { index: 0 });
  await events.emit("provider.completed", {});

  expect(out.value).toBe("");
  expect(err.value).not.toContain("write");
  expect(err.value).not.toContain("must-not-leak");
  renderer.dispose();
});
```

Existing tests already cover provider completion and turn failure clearing the active spinner. The implementation in later steps resets tool preview state through the same `endProviderAttempt()` path, so those tests remain regression coverage for both states.

- [ ] **Step 3: Run focused terminal tests and verify they fail**

Run:

```bash
bun run test -- test/plugin-terminal.test.ts \
  -t "streamed tool arguments|tool argument previews"
```

Expected: FAIL because `TerminalRenderer` ignores all `provider.tool_call_*` events.

- [ ] **Step 4: Add per-index transient tool state and lifecycle handlers**

Add these fields beside the existing reasoning state in `TerminalRenderer`:

```ts
private readonly toolCallPreviews = new Map<
  number,
  { name: string; argumentsText: string }
>();
private activeToolCallIndex: number | undefined;
```

Add guarded event branches in `render()` after `provider.reasoning_delta` and before `provider.delta`:

```ts
if (event.type === "provider.tool_call_start" && this.tty) {
  const index = Number(event.data?.index);
  const name = String(event.data?.name ?? "tool");
  if (Number.isInteger(index)) this.startToolCallPreview(index, name);
}
if (event.type === "provider.tool_call_delta" && this.tty) {
  const index = Number(event.data?.index);
  const text = String(event.data?.argumentsDelta ?? "");
  if (Number.isInteger(index) && text) this.appendToolCallPreview(index, text);
}
if (event.type === "provider.tool_call_end" && this.tty) {
  const index = Number(event.data?.index);
  if (Number.isInteger(index)) this.endToolCallPreview(index);
}
```

Add lifecycle helpers:

```ts
private startToolCallPreview(index: number, name: string): void {
  this.toolCallPreviews.set(index, { name, argumentsText: "" });
  this.activeToolCallIndex = index;
  this.startSpinner();
  this.renderActivityLine();
}

private appendToolCallPreview(index: number, text: string): void {
  const preview = this.toolCallPreviews.get(index);
  if (!preview) return;
  preview.argumentsText += text;
  this.activeToolCallIndex = index;
  this.renderActivityLine();
}

private endToolCallPreview(index: number): void {
  if (!this.toolCallPreviews.delete(index)) return;
  if (this.activeToolCallIndex === index) {
    this.activeToolCallIndex = [...this.toolCallPreviews.keys()].at(-1);
  }
  if (this.activeToolCallIndex === undefined && this.contentStarted) {
    this.stopSpinner();
    return;
  }
  this.renderActivityLine();
}

private clearToolCallPreviews(): void {
  this.toolCallPreviews.clear();
  this.activeToolCallIndex = undefined;
}
```

Out-of-order deltas and ends are ignored by these helpers. `accumulateStream` remains responsible for rejecting invalid provider streams.

- [ ] **Step 5: Generalize the existing thinking renderer into one activity line**

Replace `renderThinkingLine()` with:

```ts
private renderActivityLine(): void {
  if (!this.tty || this.providerStartedAt === undefined) return;
  const columns =
    (this.stderr as NodeJS.WritableStream & { columns?: number }).columns ?? 80;
  const maxColumns = Math.max(0, columns - 2);
  const frame = SPINNER_FRAMES[this.frame++ % SPINNER_FRAMES.length] ?? "";
  const visible = this.currentActivityText(maxColumns);
  readline.clearLine(this.stderr, 0);
  readline.cursorTo(this.stderr, 0);
  this.stderr.write(pc.dim(`${frame} ${visible}`));
}

private currentActivityText(maxColumns: number): string {
  const active =
    this.activeToolCallIndex === undefined
      ? undefined
      : this.toolCallPreviews.get(this.activeToolCallIndex);
  if (active) {
    const label = `preparing ${active.name}…`;
    const normalizedArguments = active.argumentsText.replace(/\s+/g, " ").trim();
    if (!normalizedArguments) return this.truncateTail(label, maxColumns);
    const argumentColumns = Math.max(0, maxColumns - this.displayWidth(label) - 1);
    if (argumentColumns === 0) return this.truncateTail(label, maxColumns);
    return `${label} ${this.truncateTail(normalizedArguments, argumentColumns)}`;
  }
  const reasoning = this.normalizedReasoning();
  return reasoning ? this.truncateTail(reasoning, maxColumns) : "thinking";
}

private displayWidth(text: string): number {
  return Array.from(text).reduce(
    (sum, character) => sum + ((character.codePointAt(0) ?? 0) <= 0xff ? 1 : 2),
    0,
  );
}
```

Update `truncateTail()` to call `this.displayWidth(text)` for the total while retaining its existing backwards loop and one-column ellipsis budget.

Replace existing `renderThinkingLine()` calls in the reasoning branch and spinner interval with `renderActivityLine()`. The spinner interval becomes:

```ts
this.spinner = setInterval(() => {
  this.renderActivityLine();
}, 80);
```

This preserves the current reasoning tail when there is no active tool preview and gives the active tool preview priority when one exists.

- [ ] **Step 6: Connect preview cleanup to every terminal boundary**

In `endProviderAttempt()`, clear previews after stopping the spinner:

```ts
private endProviderAttempt(): void {
  this.stopSpinner();
  this.clearToolCallPreviews();
  this.providerStartedAt = undefined;
  this.reasoningText = "";
  this.contentStarted = false;
}
```

At the start of `finishThinking()`, clear tool previews before stopping the spinner:

```ts
private finishThinking(): void {
  const startedAt = this.providerStartedAt;
  const hadReasoning = Boolean(this.normalizedReasoning());
  this.clearToolCallPreviews();
  this.stopSpinner();
  this.contentStarted = true;
```

Keep the existing elapsed-time status behavior unchanged. Because completion, retry, failure, `tool.started`, and `dispose()` already call `endProviderAttempt()`, they now clear tool previews without separate branches.

- [ ] **Step 7: Format and run the complete terminal test file**

Run:

```bash
bun run format
bun run test -- test/plugin-terminal.test.ts
```

Expected: all terminal tests pass. TTY stderr contains `preparing write…`, long arguments are single-line and tail-truncated, lifecycle boundaries prevent later spinner frames from redisplaying stale arguments, and non-TTY output contains no tool name or payload.

- [ ] **Step 8: Run project-wide verification**

Run:

```bash
just check
```

Expected: Biome lint passes, strict TypeScript typechecking passes, all offline Vitest tests pass, and live tests remain skipped unless credentials are explicitly configured.

- [ ] **Step 9: Commit the terminal behavior**

```bash
git add src/observability/terminal.ts test/plugin-terminal.test.ts
git commit -m "feat: display streamed tool arguments"
```

---

## Final Verification

- [ ] Run `git status --short` and confirm no uncommitted source, test, or formatting changes remain.
- [ ] Run `git log -3 --oneline` and confirm the two implementation commits follow the committed design and plan documents.
- [ ] Run `just run` in a real TTY with a prompt that causes a large `write` call; confirm one dim `preparing write…` line changes while arguments stream and disappears before tool execution. This manual check is optional when provider credentials are unavailable and must not block offline acceptance.
