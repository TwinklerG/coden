# Web Transcript Step Ordering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ensure final assistant and thinking blocks from later provider steps render after intervening tool cards in the Web transcript.

**Architecture:** Treat every `provider.started` event as a new provider-segment boundary in `WebStore`. Keep active block pointers scoped to that segment and allocate unique presentation IDs for every streamed assistant/thinking block, while leaving the Web protocol and browser rendering unchanged.

**Tech Stack:** TypeScript, Vitest, Bun, Biome

**Spec:** `docs/superpowers/specs/2026-09-01-web-transcript-step-ordering-design.md`

## Global Constraints

- Do not change `WebBlock`, SSE patch shapes, or `WEB_PROTOCOL_VERSION`.
- Do not add browser-side sorting or timestamp compensation.
- Retry must remove only the current provider attempt's temporary assistant/thinking blocks.
- Keep the change focused on provider-step assistant/thinking lifecycle and identity.

---

### Task 1: Reproduce multi-step transcript ordering and retry isolation

**Files:**
- Modify: `test/web-store.test.ts`

**Interfaces:**
- Consumes: `EventBus.emit(type, data, turnId)` and `WebStore.snapshot().blocks`.
- Produces: Regression assertions for provider-step ordering, unique block IDs, correct thinking updates, and retry isolation.

- [ ] **Step 1: Add a failing multi-step ordering test**

Add a test that emits:

```ts
await events.emit("turn.started", { input: "inspect" }, "turn-1");
await events.emit("provider.started", { attempt: 0 }, "turn-1");
await events.emit("provider.reasoning_delta", { text: "first thought" }, "turn-1");
await events.emit("provider.delta", { text: "I will inspect." }, "turn-1");
await events.emit(
  "provider.tool_call_start",
  { name: "read", callId: "call-1" },
  "turn-1",
);
await events.emit(
  "tool.started",
  { name: "read", callId: "call-1", input: { path: "a.ts" }, risk: "read" },
  "turn-1",
);
await events.emit(
  "tool.result",
  { name: "read", callId: "call-1", content: "body", isError: false },
  "turn-1",
);
await events.emit("provider.started", { attempt: 0 }, "turn-1");
await events.emit("provider.reasoning_delta", { text: "second " }, "turn-1");
await events.emit("provider.reasoning_delta", { text: "thought" }, "turn-1");
await events.emit("provider.delta", { text: "Final answer." }, "turn-1");
```

Assert block kinds are exactly:

```ts
["user", "thinking", "assistant", "tool", "thinking", "assistant"]
```

Assert assistant markdown values are `"I will inspect."` and `"Final answer."`, thinking values are `"first thought"` and `"second thought"`, and `new Set(blocks.map(({ id }) => id)).size === blocks.length`.

- [ ] **Step 2: Add a failing retry-isolation test**

Create one completed assistant segment, start a second provider step, stream `"discard me"`, emit `provider.retry`, and assert the earlier assistant remains while only the current segment is removed:

```ts
expect(
  store.snapshot().blocks.filter((block) => block.kind === "assistant"),
).toEqual([expect.objectContaining({ markdown: "keep me" })]);
```

- [ ] **Step 3: Run the focused tests and verify failure**

Run:

```bash
bun run vitest run test/web-store.test.ts
```

Expected: the multi-step test fails because the final text is merged into the first assistant block; the unique-ID assertion also exposes repeated thinking IDs. The retry test fails because retry removes the reused earlier assistant block.

### Task 2: Scope streamed blocks to provider steps

**Files:**
- Modify: `src/web/store.ts`
- Test: `test/web-store.test.ts`

**Interfaces:**
- Consumes: `provider.started`, `provider.delta`, `provider.reasoning_delta`, and `provider.retry` runtime events.
- Produces: `private nextBlockId(kind: "assistant" | "thinking", turnId: string): string`, unique streamed block IDs, and provider-step-scoped active pointers.

- [ ] **Step 1: Add a monotonic presentation ID allocator**

Add a private counter and helper to `WebStore`:

```ts
#blockSequence = 0;

private nextBlockId(kind: "assistant" | "thinking", turnId: string): string {
  this.#blockSequence += 1;
  return `${kind}-${turnId}-${this.#blockSequence}`;
}
```

Use this helper whenever a new assistant or thinking block is appended instead of `assistant-${turnId}` or `thinking-${turnId}`.

- [ ] **Step 2: Establish the provider-step boundary**

Change `provider.started` handling to finalize any stale active thinking and clear the active assistant pointer before entering the new thinking phase:

```ts
case "provider.started":
  this.finishThinking();
  this.#activeAssistantId = undefined;
  this.merge({ phase: "thinking", running: true });
  return;
```

`finishThinking()` already clears `#activeThinkingId`. Do not remove blocks from prior successful steps.

- [ ] **Step 3: Run the focused tests**

Run:

```bash
bun run vitest run test/web-store.test.ts
```

Expected: all WebStore tests pass, including exact multi-step ordering, unique IDs, correct second-thinking accumulation, and retry isolation.

- [ ] **Step 4: Run formatting and static checks**

Run:

```bash
bun x biome check src/web/store.ts test/web-store.test.ts
bun run typecheck
```

Expected: both commands pass without diagnostics.

### Task 3: Validate the complete Web surface and commit

**Files:**
- Modify: `docs/superpowers/plans/2026-09-01-web-transcript-step-ordering.md` only if validation reveals a documented command correction.

**Interfaces:**
- Consumes: the completed WebStore fix and regression tests.
- Produces: repository validation evidence and the final implementation commit.

- [ ] **Step 1: Run the Web UI package checks**

Run:

```bash
cd src/webui && bun run check
```

Expected: Biome, TypeScript, Vitest, and browser build all pass.

- [ ] **Step 2: Run root Web checks**

Run:

```bash
bun run vitest run test/web-store.test.ts test/web-router.test.ts test/web-controller.test.ts test/web-protocol.test.ts
```

Expected: all selected Web tests pass.

- [ ] **Step 3: Run repository formatting validation**

Run:

```bash
git diff --check
git status --short
```

Expected: no whitespace errors; only the implementation plan, WebStore, and WebStore test changes are pending.

- [ ] **Step 4: Commit the implementation**

Run:

```bash
git add docs/superpowers/plans/2026-09-01-web-transcript-step-ordering.md src/web/store.ts test/web-store.test.ts
git commit -m "fix(web): preserve provider step transcript order"
```

- [ ] **Step 5: Verify the committed tree**

Run:

```bash
git status --short
git log -2 --oneline
```

Expected: the worktree is clean and the latest two commits are the implementation and its design document.
