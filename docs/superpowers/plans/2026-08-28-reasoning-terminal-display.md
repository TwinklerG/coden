# Reasoning Terminal Display Implementation Plan

<!-- markdownlint-disable MD013 -->

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Display OpenAI-compatible `reasoning_content` as a temporary dim TTY line, then replace it with `thought for x.xs` when formal content starts.

**Architecture:** Add a reasoning-only event to the provider model stream, forward it through the runtime event bus without accumulating it into the assistant answer, and render it only as ephemeral stderr state in `TerminalRenderer`. Keep stdout, session history, retries, and non-TTY behavior isolated from reasoning data.

**Tech Stack:** TypeScript 5.9, OpenAI SDK 5, Node.js readline streams, picocolors, Vitest 3, Bun, Biome, Just

**Spec:** `docs/superpowers/specs/2026-08-28-reasoning-terminal-display-design.md`

## Global Constraints

- Do not use Bun-specific APIs; use Bun only as the JS/TS toolchain.
- Use Biome for TypeScript linting and formatting.
- Reasoning must never enter the final assistant text, session history, model context, or non-TTY pipeline output.
- Only TTY stderr may show temporary reasoning and the final dim `thought for x.xs` line.
- Measure elapsed time from `provider.started` to the first non-empty formal content delta.
- Once formal content starts, ignore later reasoning UI updates for that provider attempt.
- Do not add dependencies or user-facing configuration.
- Do not add Anthropic thinking-block support in this change.

## File Structure

- Modify `src/core/types.ts` to define the provider-neutral `reasoning_delta` model event.
- Modify `src/providers/openai.ts` to adapt OpenAI-compatible `reasoning_content` chunks into that event.
- Modify `src/core/runtime.ts` to expose a separate reasoning callback and emit `provider.reasoning_delta`.
- Modify `src/observability/terminal.ts` to own the ephemeral reasoning/spinner state machine.
- Modify `test/providers.test.ts` for provider adaptation and stream accumulation tests.
- Modify `test/runtime.integration.test.ts` for runtime event forwarding and answer isolation.
- Modify `test/plugin-terminal.test.ts` for TTY timing, late-reasoning, cleanup, and non-TTY behavior.

---

### Task 1: Normalize OpenAI-compatible reasoning chunks

**Files:**

- Modify: `src/core/types.ts:64-71`
- Modify: `src/providers/openai.ts:1-58`
- Test: `test/providers.test.ts:1-58`

**Interfaces:**

- Consumes: OpenAI-compatible streaming chunks whose choice delta may contain `reasoning_content?: string | null`.
- Produces: `ModelEvent` variant `{ type: "reasoning_delta"; text: string }`.
- Produces: `OpenAICompatibleProvider.stream(request)` yields non-empty reasoning deltas without converting them to `text_delta`.

- [ ] **Step 1: Write the failing OpenAI stream adaptation test**

Add an async chunk helper near the existing `events()` helper in
`test/providers.test.ts`:

```ts
async function* chunks(items: unknown[]) {
  for (const item of items) yield item;
}
```

Add this test in the `providers` describe block:

```ts
it("normalizes OpenAI-compatible reasoning content separately", async () => {
  const provider = new OpenAICompatibleProvider({ apiKey: "test" });
  const client = (
    provider as unknown as {
      client: {
        chat: {
          completions: {
            create: () => Promise<AsyncIterable<unknown>>;
          };
        };
      };
    }
  ).client;
  client.chat.completions.create = async () =>
    chunks([
      { choices: [{ delta: { reasoning_content: "inspect " } }] },
      { choices: [{ delta: { reasoning_content: "files" } }] },
      { choices: [{ delta: { content: "done" } }] },
    ]);

  const streamed: ModelEvent[] = [];
  for await (const event of provider.stream({
    model: "test",
    messages: [],
    tools: [],
    maxOutputTokens: 128,
  })) {
    streamed.push(event);
  }

  expect(streamed).toEqual([
    { type: "reasoning_delta", text: "inspect " },
    { type: "reasoning_delta", text: "files" },
    { type: "text_delta", text: "done" },
    { type: "done" },
  ]);
});
```

- [ ] **Step 2: Run the focused test and verify the type/event failure**

Run:

```bash
bun run test -- test/providers.test.ts -t "normalizes OpenAI-compatible reasoning"
```

Expected: FAIL because `reasoning_delta` is not a valid `ModelEvent` and the
provider currently drops `reasoning_content`.

- [ ] **Step 3: Add the provider-neutral model event**

Extend the `ModelEvent` union in `src/core/types.ts`:

```ts
export type ModelEvent =
  | { type: "reasoning_delta"; text: string }
  | { type: "text_delta"; text: string }
  | { type: "tool_call_start"; index: number; callId: string; name: string }
  | { type: "tool_call_delta"; index: number; argumentsDelta: string }
  | { type: "tool_call_end"; index: number }
  | { type: "usage"; usage: Usage }
  | { type: "done" };
```

- [ ] **Step 4: Adapt the OpenAI-compatible extension field**

In `src/providers/openai.ts`, define a narrow local extension type after the
options interface:

```ts
type ReasoningDelta = {
  reasoning_content?: string | null;
};
```

In the chunk loop, read the extension without weakening the public types:

```ts
const delta = chunk.choices[0]?.delta;
const reasoning = (delta as (typeof delta & ReasoningDelta) | undefined)
  ?.reasoning_content;
if (reasoning) yield { type: "reasoning_delta", text: reasoning };
if (delta?.content) yield { type: "text_delta", text: delta.content };
```

Leave tool-call, usage, and completion behavior unchanged.

- [ ] **Step 5: Format and run the provider test file**

Run:

```bash
bun run format
bun run test -- test/providers.test.ts
```

Expected: `test/providers.test.ts` passes, including the new event-order
assertion.

- [ ] **Step 6: Commit the normalized provider event**

```bash
git add src/core/types.ts src/providers/openai.ts test/providers.test.ts
git commit -m "feat: normalize provider reasoning deltas"
```

---

### Task 2: Forward reasoning without accumulating it into answers

**Files:**

- Modify: `src/core/runtime.ts:218-228,252-264,296-355`
- Test: `test/providers.test.ts:59-81`
- Test: `test/runtime.integration.test.ts:45-73,91-126`

**Interfaces:**

- Consumes: `ModelEvent` variant `{ type: "reasoning_delta"; text: string }` from Task 1.
- Produces: `accumulateStream(stream, onText?, onReasoning?)`, where both callbacks have type `(text: string) => void | Promise<void>`.
- Produces: runtime event `provider.reasoning_delta` with data `{ text: string }` and the active `turnId`.
- Preserves: `accumulateStream()` result shape `{ text: string; toolCalls: ToolCall[]; usage: Usage }`; reasoning is excluded from `text`.

- [ ] **Step 1: Write the failing stream separation test**

Add this test to `test/providers.test.ts`:

```ts
it("reports reasoning separately from accumulated assistant text", async () => {
  const text: string[] = [];
  const reasoning: string[] = [];

  const result = await accumulateStream(
    events([
      { type: "reasoning_delta", text: "inspect " },
      { type: "reasoning_delta", text: "files" },
      { type: "text_delta", text: "final answer" },
      { type: "done" },
    ]),
    (delta) => text.push(delta),
    (delta) => reasoning.push(delta),
  );

  expect(reasoning).toEqual(["inspect ", "files"]);
  expect(text).toEqual(["final answer"]);
  expect(result.text).toBe("final answer");
});
```

- [ ] **Step 2: Write the failing runtime forwarding test**

Add a test to `test/runtime.integration.test.ts`:

```ts
it("forwards reasoning events without adding them to the answer", async () => {
  const provider = new ScriptedProvider([
    [
      { type: "reasoning_delta", text: "private analysis" },
      { type: "text_delta", text: "public answer" },
      { type: "reasoning_delta", text: "late analysis" },
      { type: "done" },
    ],
  ]);
  const h = await harness(provider);
  const reasoning: string[] = [];
  h.events.on((event) => {
    if (event.type === "provider.reasoning_delta")
      reasoning.push(String(event.data?.text ?? ""));
  });

  const result = await h.runtime.run("hello");

  expect(reasoning).toEqual(["private analysis", "late analysis"]);
  expect(result.answer).toBe("public answer");
});
```

- [ ] **Step 3: Run both focused tests and verify they fail**

Run:

```bash
bun run test -- test/providers.test.ts test/runtime.integration.test.ts \
  -t "reasoning"
```

Expected: FAIL because `accumulateStream` has no reasoning callback and the
runtime emits no `provider.reasoning_delta` event.

- [ ] **Step 4: Extend `accumulateStream` with an isolated reasoning callback**

Change its signature in `src/core/runtime.ts` to:

```ts
export async function accumulateStream(
  stream: AsyncIterable<ModelEvent>,
  onText?: (text: string) => void | Promise<void>,
  onReasoning?: (text: string) => void | Promise<void>,
): Promise<{ text: string; toolCalls: ToolCall[]; usage: Usage }> {
```

Handle reasoning before formal text in the event loop:

```ts
for await (const event of stream) {
  if (event.type === "reasoning_delta") {
    await onReasoning?.(event.text);
  } else if (event.type === "text_delta") {
    text += event.text;
    await onText?.(event.text);
  } else if (event.type === "tool_call_start")
    builders.set(event.index, {
      callId: event.callId,
      name: event.name,
      json: "",
      ended: false,
    });
```

The existing `tool_call_delta`, `tool_call_end`, and `usage` branches follow
this branch unchanged.

Do not append `event.text` from `reasoning_delta` to the local `text`
variable.

- [ ] **Step 5: Forward the runtime event in `requestWithRetry`**

Change the existing provider call to pass both callbacks:

```ts
const result = await accumulateStream(
  this.provider.stream(request),
  async (text) => {
    await this.events.emit("provider.delta", { text }, turnId);
  },
  async (text) => {
    await this.events.emit("provider.reasoning_delta", { text }, turnId);
  },
);
```

Leave the summary-refinement call without callbacks so compaction reasoning is
not rendered as a user turn.

- [ ] **Step 6: Format and run provider/runtime tests**

Run:

```bash
bun run format
bun run test -- test/providers.test.ts test/runtime.integration.test.ts
```

Expected: both files pass. The integration answer is exactly `public answer`,
while both reasoning events are observable on the event bus.

- [ ] **Step 7: Commit runtime reasoning isolation**

```bash
git add src/core/runtime.ts test/providers.test.ts test/runtime.integration.test.ts
git commit -m "feat: forward runtime reasoning events"
```

---

### Task 3: Render ephemeral TTY reasoning and folded elapsed time

**Files:**

- Modify: `src/observability/terminal.ts:12-96`
- Test: `test/plugin-terminal.test.ts:1-180`

**Interfaces:**

- Consumes: `provider.started`, `provider.reasoning_delta`, `provider.delta`, `provider.retry`, `provider.completed`, `tool.started`, and `turn.failed` runtime events.
- Produces: temporary dim TTY stderr line containing spinner plus normalized reasoning tail.
- Produces: one dim TTY stderr line `thought for x.xs` immediately before the first non-empty formal content is written to stdout.
- Preserves: non-TTY buffering and retry semantics; reasoning never reaches stdout.

- [ ] **Step 1: Import Vitest timer controls and add focused TTY tests**

Change the Vitest import in `test/plugin-terminal.test.ts` to:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
```

Add timer cleanup near the `Sink` class:

```ts
afterEach(() => {
  vi.useRealTimers();
});
```

Add the primary behavior test:

```ts
it("folds temporary TTY reasoning when formal content starts", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-08-28T00:00:00.000Z"));
  const out = new Sink();
  const err = new Sink();
  Object.assign(err, { columns: 40 });
  const events = new EventBus();
  const renderer = new TerminalRenderer(events, { stdout: out, stderr: err, tty: true });

  await events.emit("provider.started");
  await events.emit("provider.reasoning_delta", { text: "reviewing\n  project files" });
  expect(err.value).toContain("reviewing project files");
  const beforeLongDelta = err.value.length;
  await events.emit("provider.reasoning_delta", {
    text: " while checking a deliberately long additional detail",
  });
  const latestRender = err.value.slice(beforeLongDelta);
  expect(latestRender).toContain("…");
  expect(latestRender).not.toContain("\n  ");

  vi.advanceTimersByTime(3_200);
  await events.emit("provider.delta", { text: "Answer" });

  expect(err.value).toContain("thought for 3.2s");
  expect(out.value).toBe("Answer");
  renderer.dispose();
});
```

Add a late-reasoning test:

```ts
it("ignores reasoning after formal TTY content starts", async () => {
  const out = new Sink();
  const err = new Sink();
  const events = new EventBus();
  const renderer = new TerminalRenderer(events, { stdout: out, stderr: err, tty: true });

  await events.emit("provider.started");
  await events.emit("provider.reasoning_delta", { text: "first thought" });
  await events.emit("provider.delta", { text: "answer" });
  const afterContent = err.value;
  await events.emit("provider.reasoning_delta", { text: "must not appear" });

  expect(err.value).toBe(afterContent);
  expect(err.value).not.toContain("must not appear");
  renderer.dispose();
});
```

- [ ] **Step 2: Add cleanup and non-TTY regression tests**

Add these tests to the same describe block:

```ts
it("clears failed-attempt reasoning without folding it", async () => {
  vi.useFakeTimers();
  const out = new Sink();
  const err = new Sink();
  const events = new EventBus();
  const renderer = new TerminalRenderer(events, { stdout: out, stderr: err, tty: true });

  await events.emit("provider.started");
  await events.emit("provider.reasoning_delta", { text: "discard me" });
  await events.emit("provider.retry", { attempt: 1 });
  const afterRetry = err.value;
  vi.advanceTimersByTime(200);

  expect(err.value).toBe(afterRetry);
  expect(err.value).not.toContain("thought for");
  renderer.dispose();
});

it("does not expose reasoning in non-TTY output", async () => {
  const out = new Sink();
  const err = new Sink();
  const events = new EventBus();
  const renderer = new TerminalRenderer(events, { stdout: out, stderr: err, tty: false });

  await events.emit("provider.started");
  await events.emit("provider.reasoning_delta", { text: "hidden chain of thought" });
  await events.emit("provider.delta", { text: "public answer" });
  await events.emit("provider.completed", {});

  expect(out.value).toBe("public answer");
  expect(err.value).not.toContain("hidden chain of thought");
  expect(err.value).not.toContain("thought for");
  renderer.dispose();
});
```

Add direct tool-start and dispose cleanup coverage:

```ts
it("cleans active reasoning on tool start and dispose", async () => {
  vi.useFakeTimers();
  const out = new Sink();
  const err = new Sink();
  const events = new EventBus();
  const renderer = new TerminalRenderer(events, { stdout: out, stderr: err, tty: true });

  await events.emit("provider.started");
  await events.emit("provider.reasoning_delta", { text: "calling a tool" });
  await events.emit("tool.started", { name: "read" });
  const afterToolStart = err.value;
  vi.advanceTimersByTime(200);
  expect(err.value).toBe(afterToolStart);
  expect(err.value).not.toContain("thought for");

  await events.emit("provider.started");
  await events.emit("provider.reasoning_delta", { text: "active at dispose" });
  renderer.dispose();
  const afterDispose = err.value;
  vi.advanceTimersByTime(200);
  expect(err.value).toBe(afterDispose);
});
```

The existing completion and failure tests continue to cover
`provider.completed` and `turn.failed` cleanup.

- [ ] **Step 3: Run the terminal tests and verify they fail**

Run:

```bash
bun run test -- test/plugin-terminal.test.ts -t "reasoning|failed-attempt"
```

Expected: FAIL because reasoning events are ignored and no folded duration is
written.

- [ ] **Step 4: Add provider-attempt state to `TerminalRenderer`**

Add these fields beside `frame`:

```ts
private providerStartedAt: number | undefined;
private reasoningText = "";
private contentStarted = false;
```

Replace the `provider.started` branch with a method call that resets stale
attempt state, records `Date.now()`, and starts the spinner:

```ts
if (event.type === "provider.started") this.startProviderAttempt();
```

Add:

```ts
private startProviderAttempt(): void {
  this.endProviderAttempt();
  this.providerStartedAt = Date.now();
  this.startSpinner();
}

private endProviderAttempt(): void {
  this.stopSpinner();
  this.providerStartedAt = undefined;
  this.reasoningText = "";
  this.contentStarted = false;
}
```

Use `endProviderAttempt()` for retry, completion, tool start, failure, and
disposal. Keep formal non-TTY text flushing in `provider.completed` before
resetting the attempt.

- [ ] **Step 5: Render a normalized one-line reasoning tail**

Add a reasoning branch in `render()`:

```ts
if (event.type === "provider.reasoning_delta") {
  const text = String(event.data?.text ?? "");
  if (
    this.tty &&
    this.providerStartedAt !== undefined &&
    !this.contentStarted &&
    text
  ) {
    this.reasoningText += text;
    this.renderThinkingLine();
  }
}
```

Move the frame list to file scope:

```ts
const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"] as const;
```

Add private helpers that normalize whitespace, estimate terminal cell width,
and retain the newest visible tail:

```ts
private renderThinkingLine(): void {
  const normalized = this.reasoningText.replace(/\s+/g, " ").trim();
  if (!normalized) return;
  const columns =
    (this.stderr as NodeJS.WritableStream & { columns?: number }).columns ?? 80;
  const frame = SPINNER_FRAMES[this.frame++ % SPINNER_FRAMES.length] ?? "";
  const visible = this.truncateTail(normalized, Math.max(0, columns - 2));
  readline.clearLine(this.stderr, 0);
  readline.cursorTo(this.stderr, 0);
  this.stderr.write(pc.dim(`${frame} ${visible}`));
}

private truncateTail(text: string, maxColumns: number): string {
  if (maxColumns <= 0) return "";
  const characters = Array.from(text);
  const width = (character: string) => (/^[\u0000-\u00ff]$/.test(character) ? 1 : 2);
  const total = characters.reduce((sum, character) => sum + width(character), 0);
  if (total <= maxColumns) return text;
  const kept: string[] = [];
  let used = 1;
  for (let index = characters.length - 1; index >= 0; index--) {
    const character = characters[index];
    if (character === undefined || used + width(character) > maxColumns) break;
    kept.unshift(character);
    used += width(character);
  }
  return `…${kept.join("")}`;
}
```

In the spinner callback, call `renderThinkingLine()` when normalized reasoning
is non-empty. Otherwise render
`` `${SPINNER_FRAMES[this.frame++ % SPINNER_FRAMES.length]} thinking` `` using
the existing clear-line and cursor-to-zero calls.

- [ ] **Step 6: Fold elapsed time on the first formal content delta**

Before writing a non-empty `provider.delta`, call a new method:

```ts
if (event.type === "provider.delta") {
  const text = String(event.data?.text ?? "");
  if (text && !this.contentStarted) this.finishThinking();
  if (this.tty) this.stdout.write(text);
  else this.pendingText += text;
}
```

Implement:

```ts
private finishThinking(): void {
  const startedAt = this.providerStartedAt;
  const hadReasoning = Boolean(this.reasoningText.replace(/\s+/g, " ").trim());
  this.stopSpinner();
  this.contentStarted = true;
  if (this.tty && startedAt !== undefined && hadReasoning) {
    const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);
    this.stderr.write(`${pc.dim(`thought for ${seconds}s`)}\n`);
  }
}
```

Do not reset `contentStarted` until the attempt ends; that flag suppresses all
later reasoning events. If a provider emits only tool calls or completes after
reasoning, cleanup removes the temporary line without calling
`finishThinking()` and therefore without a folded status.

- [ ] **Step 7: Run the complete terminal test file**

Run:

```bash
bun run format
bun run test -- test/plugin-terminal.test.ts
```

Expected: all terminal tests pass. The fake-timer test contains
`thought for 3.2s`, late reasoning does not change stderr, retry stops future
spinner writes, and non-TTY output contains only `public answer`.

- [ ] **Step 8: Run project-wide verification**

Run:

```bash
just check
```

Expected: Biome lint passes, TypeScript reports no errors, all offline Vitest
tests pass, and live tests remain skipped unless credentials are explicitly
configured.

- [ ] **Step 9: Commit the terminal behavior**

```bash
git add src/observability/terminal.ts test/plugin-terminal.test.ts
git commit -m "feat: display temporary model reasoning"
```

---

## Final Verification

- [ ] Run `git status --short` and confirm no uncommitted source, test, or formatting changes remain.
- [ ] Run `git log -3 --oneline` and confirm the three implementation commits are present in task order.
- [ ] Manually inspect one TTY run against a reasoning-capable OpenAI-compatible endpoint when credentials are available; this is optional and must not block offline acceptance.
