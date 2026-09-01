# Web Plugin Tool Occurrence Ordering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep repeated third-party plugin tool calls in their real transcript positions even when the provider reuses `callId` values such as `call_0`.

**Architecture:** Separate runtime correlation identity (`WebBlock.callId`) from presentation occurrence identity (`WebBlock.id`). Allocate a unique tool block for every `provider.tool_call_start`, map later execution events to the newest occurrence, and apply the same identity model when reconstructing session history.

**Tech Stack:** TypeScript, Vitest, Bun, Biome

**Spec:** `docs/superpowers/specs/2026-09-01-web-plugin-tool-occurrence-ordering-design.md`

## Constraints

- Keep `WebBlock.callId` unchanged for runtime correlation.
- Do not change the Web protocol or browser reducer.
- Support repeated call IDs within one turn, across turns, and in recovered history.
- Preserve fallback behavior for tool execution events that lack a preceding provider preview.

### Task 1: Add failing repeated-plugin-call regression tests

**Files:**
- Modify: `test/web-store.test.ts`

**Interfaces:**
- Consumes runtime events through `EventBus` and recovered `AgentMessage[]` through `setRecoveredMessages`.
- Produces assertions over ordered, unique `WebBlock[]` tool occurrences.

- [ ] Add a test that emits two provider steps in the same turn. Each step emits assistant text, `provider.tool_call_start`, `tool.started`, and `tool.result` for plugin tool `plugin_search`, reusing `callId: "call_0"`.
- [ ] Assert the exact block order is `user, assistant, tool, assistant, tool`.
- [ ] Assert the two tool blocks have distinct IDs and preserve outputs `first result` and `second result`; the second result must not overwrite the first block.
- [ ] Add a recovery test with two assistant/tool-result pairs reusing `call_0` and assert two ordered tool blocks with unique IDs and independent outputs.
- [ ] Run `bun run vitest run test/web-store.test.ts` and confirm both tests fail against the current global-callId identity behavior.

### Task 2: Allocate unique tool occurrence IDs

**Files:**
- Modify: `src/web/store.ts`
- Test: `test/web-store.test.ts`

**Interfaces:**
- Extends the private presentation ID allocator to accept `"tool"`.
- Keeps `#toolBlocks` as a correlation map from call ID to the newest occurrence block ID.

- [ ] Extend `nextBlockId` to allocate assistant, thinking, and tool presentation IDs.
- [ ] In `provider.tool_call_start`, always allocate and append a new tool block; remove the `#toolBlocks.has(callId)` guard.
- [ ] In `upsertTool`, allocate a unique tool ID when no preview block exists instead of using `tool-${callId}`.
- [ ] In `setRecoveredMessages`, assign a unique ID to every tool-call block and orphan result block while retaining the local call-ID map used to complete the latest occurrence.
- [ ] Run `bun run vitest run test/web-store.test.ts`; expect all ordering, identity, retry, and recovery tests to pass.
- [ ] Run `bun x biome check src/web/store.ts test/web-store.test.ts` and `bun run typecheck`.

### Task 3: Validate and commit

**Files:**
- Add: `docs/superpowers/plans/2026-09-01-web-plugin-tool-occurrence-ordering.md`
- Modify: `src/web/store.ts`
- Modify: `test/web-store.test.ts`

- [ ] Run `cd src/webui && bun run check`.
- [ ] Run `bun run vitest run test/web-store.test.ts test/web-router.test.ts test/web-controller.test.ts test/web-protocol.test.ts`.
- [ ] Run `just check` and `git diff --check`.
- [ ] Review the diff to ensure no protocol or client-side ordering changes were introduced.
- [ ] Commit with `fix(web): preserve plugin tool call order` and verify the worktree is clean.
