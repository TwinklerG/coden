# CodeN Thinking Level Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a unified, dynamically switchable thinking level for OpenAI and Anthropic, persist it per session, and preserve Anthropic extended-thinking state across tools and resume.

**Architecture:** Define provider-neutral thinking semantics in core types, keep native parameter mapping in a focused Provider helper, and let `AgentRuntime` snapshot the selected level per turn. `AgentApplication` owns startup precedence and dynamic changes, while assistant messages carry JSON-safe provider state so Anthropic thinking blocks survive tool loops and session recovery.

**Tech Stack:** TypeScript 5.9, Bun, Vitest, Commander 14, OpenAI SDK 5, Anthropic SDK 0.61, Ink 7/React 19, Biome, Just.

**Spec:** `docs/superpowers/specs/2026-08-31-coden-thinking-level-design.md`

## Global Constraints

- The only accepted levels are `default | off | minimal | low | medium | high`.
- `default` is the default and must not add a Provider request parameter.
- Thinking level applies only to main Agent requests; compaction and Smart Approval requests must leave it unset.
- OpenAI maps `off` to `minimal` and displays `off→minimal`; no unsupported-model allowlist or silent fallback is allowed.
- Anthropic maps `minimal` to 1024 tokens and `low | medium | high` to 25% | 50% | 75% of `maxOutputTokens`, clamped to `[1024, maxOutputTokens - 1]`.
- Anthropic thinking remains inside `reservedOutputTokens`; enabled thinking requires `maxOutputTokens > 1024`.
- Resume precedence is explicit `--thinking` > saved session level > environment > project config > user config > `default`.
- `/thinking` changes the current process and session only; it must not modify user or project config files.
- Preserve Anthropic thinking, redacted-thinking, and signature data exactly enough to replay it after tool calls and resume.
- Do not upgrade the installed OpenAI or Anthropic SDK unless compilation proves the checked-in versions insufficient.
- Use Bun-compatible standard Node.js APIs only; do not introduce Bun-specific runtime APIs.
- Use `just` for project-level commands and Biome for TypeScript formatting/linting.
- Do not stage or modify the user-owned untracked file `docs/superpowers/plans/2026-08-30-agent-lifecycle-hooks.md`.

## File Structure

### New files

- `src/core/thinking.ts` — canonical levels, predicates, JSON-safe Provider state types and validation.
- `src/providers/thinking.ts` — pure OpenAI/Anthropic parameter mapping and effective-status description.
- `test/thinking.test.ts` — pure level parsing, mapping, budget, and launch-precedence tests.

### Modified files

- `src/core/types.ts` — add request level, assistant Provider state, and Provider-state stream event.
- `src/core/runtime.ts` — turn snapshot, main-request propagation, Provider-state accumulation, assistant persistence.
- `src/context/manager.ts` — allow `toModelRequest()` to receive the main-turn level.
- `src/config/config.ts` — config field, strict JSON/env validation, default and merge behavior.
- `src/providers/openai.ts` — add `reasoning_effort` mapping.
- `src/providers/anthropic.ts` — add thinking config, stream collection, and block replay.
- `src/sessions/store.ts` — append/recover session level and validate optional Provider state.
- `src/cli/agent-command.ts` — command option type and Commander parser.
- `src/cli/index.ts` — register `--thinking`.
- `src/cli/agent-application.ts` — resume precedence, metadata, dynamic switch API, session writes and change event.
- `src/cli/repl-command.ts` — classify, query, validate and execute `/thinking`.
- `src/tui/controller.ts` — pass shared thinking dependencies to the REPL command service.
- `src/tui/store.ts` — apply `thinking.changed` to metadata.
- `src/tui/components/status-bar.tsx` — render the effective thinking label.
- `src/i18n/locales/en.ts`, `src/i18n/locales/zh.ts` — CLI, REPL and status copy.
- `README.md` — usage, precedence, Provider mapping and reasoning-data privacy.
- `test/config.test.ts`, `test/cli.test.ts`, `test/providers.test.ts`, `test/runtime.integration.test.ts`, `test/context-session.test.ts`, `test/approval-reviewer.test.ts`, `test/repl-command.test.ts`, `test/tui-controller.test.ts`, `test/tui-store.test.ts`, `test/tui-components.test.tsx`, `test/tui-frame.test.tsx` — focused and regression coverage.

---

### Task 1: Canonical Levels, Mapping, and Configuration

**Files:**
- Create: `src/core/thinking.ts`
- Create: `src/providers/thinking.ts`
- Create: `test/thinking.test.ts`
- Modify: `src/config/config.ts:1-155`
- Modify: `src/cli/agent-command.ts:1-48,278-291`
- Modify: `test/config.test.ts:1-180`

**Interfaces:**
- Produces: `THINKING_LEVELS`, `ThinkingLevel`, `isThinkingLevel(value)`, `ProviderMessageState`, `isProviderMessageState(value)`.
- Produces: `ThinkingStatus`, `resolveThinkingStatus(provider, level, maxOutputTokens)`, `toOpenAIReasoningEffort(level)`, `toAnthropicThinkingConfig(level, maxOutputTokens)`.
- Produces: `CodeNConfig.thinkingLevel` and optional `AgentCommandOptions.thinking`.
- Consumes: existing `ProviderName` and Anthropic `ThinkingConfigParam` SDK type.

- [ ] **Step 1: Write failing pure mapping tests**

Create `test/thinking.test.ts` with table-driven assertions:

```ts
import { describe, expect, it } from "vitest";
import { THINKING_LEVELS } from "../src/core/thinking.js";
import {
  resolveThinkingStatus,
  toAnthropicThinkingConfig,
  toOpenAIReasoningEffort,
} from "../src/providers/thinking.js";

describe("thinking levels", () => {
  it("exposes the six canonical values", () => {
    expect(THINKING_LEVELS).toEqual([
      "default",
      "off",
      "minimal",
      "low",
      "medium",
      "high",
    ]);
  });

  it.each([
    ["default", undefined],
    ["off", "minimal"],
    ["minimal", "minimal"],
    ["low", "low"],
    ["medium", "medium"],
    ["high", "high"],
  ] as const)("maps OpenAI %s", (level, expected) => {
    expect(toOpenAIReasoningEffort(level)).toBe(expected);
  });

  it("maps Anthropic levels inside maxOutputTokens", () => {
    expect(toAnthropicThinkingConfig("default", 8192)).toBeUndefined();
    expect(toAnthropicThinkingConfig("off", 8192)).toEqual({ type: "disabled" });
    expect(toAnthropicThinkingConfig("minimal", 8192)).toEqual({
      type: "enabled",
      budget_tokens: 1024,
    });
    expect(toAnthropicThinkingConfig("low", 8192)).toEqual({
      type: "enabled",
      budget_tokens: 2048,
    });
    expect(toAnthropicThinkingConfig("medium", 8192)).toEqual({
      type: "enabled",
      budget_tokens: 4096,
    });
    expect(toAnthropicThinkingConfig("high", 8192)).toEqual({
      type: "enabled",
      budget_tokens: 6144,
    });
  });

  it("rejects an impossible Anthropic enabled budget", () => {
    expect(() => toAnthropicThinkingConfig("minimal", 1024)).toThrow(
      "requires maxOutputTokens greater than 1024",
    );
  });

  it("describes OpenAI off honestly", () => {
    expect(resolveThinkingStatus("openai", "off", 8192)).toMatchObject({
      level: "off",
      effectiveLevel: "minimal",
      displayLevel: "off→minimal",
    });
  });
});
```

- [ ] **Step 2: Run the pure mapping tests and verify the missing-module failure**

Run: `bun test test/thinking.test.ts`

Expected: FAIL because `src/core/thinking.ts` and `src/providers/thinking.ts` do not exist.

- [ ] **Step 3: Implement canonical types and pure mapping**

In `src/core/thinking.ts`, define the immutable values and recursive JSON validation:

```ts
export const THINKING_LEVELS = [
  "default",
  "off",
  "minimal",
  "low",
  "medium",
  "high",
] as const;

export type ThinkingLevel = (typeof THINKING_LEVELS)[number];
export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

export interface ProviderMessageState {
  provider: string;
  data: JsonValue;
}

export function isThinkingLevel(value: unknown): value is ThinkingLevel {
  return typeof value === "string" && THINKING_LEVELS.includes(value as ThinkingLevel);
}

export function isProviderMessageState(value: unknown): value is ProviderMessageState {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const state = value as Record<string, unknown>;
  return typeof state.provider === "string" && state.provider.length > 0 && isJsonValue(state.data);
}
```

Implement `isJsonValue()` recursively, accepting only finite numbers, strings, booleans, null, arrays, and plain enumerable objects.

In `src/providers/thinking.ts`, define these exact public results:

```ts
export interface ThinkingStatus {
  level: ThinkingLevel;
  effectiveLevel: ThinkingLevel;
  displayLevel: string;
  budgetTokens?: number;
}
```

Implement the OpenAI table directly. Implement Anthropic budgets with `Math.floor`, minimum 1024, and maximum `maxOutputTokens - 1`. Make `resolveThinkingStatus()` call the same mapping functions used by Provider requests so UI descriptions cannot drift from actual parameters.

- [ ] **Step 4: Write failing configuration precedence and validation tests**

Extend `test/config.test.ts` so the existing five-layer test gives user `low`, project `medium`, environment `high`, and CLI `off`, then asserts CLI wins. Add separate assertions for default and invalid JSON/env values:

```ts
expect(config.thinkingLevel).toBe("off");

const defaults = await loadConfig(emptyWorkspace);
expect(defaults.thinkingLevel).toBe("default");

vi.stubEnv("CODEN_THINKING_LEVEL", "extreme");
await expect(loadConfig(emptyWorkspace)).rejects.toThrow(
  "thinkingLevel must be default, off, minimal, low, medium, or high",
);
```

Also add `thinking?: ThinkingLevel` to `AgentCommandOptions` and export a Commander parser:

```ts
export function parseThinkingLevel(value: string): ThinkingLevel {
  if (!isThinkingLevel(value)) {
    throw new InvalidArgumentError(
      "must be default, off, minimal, low, medium, or high",
    );
  }
  return value;
}
```

- [ ] **Step 5: Run configuration tests and verify failure**

Run: `bun test test/config.test.ts test/thinking.test.ts`

Expected: FAIL because `CodeNConfig` does not yet load or default `thinkingLevel`.

- [ ] **Step 6: Implement configuration loading and strict validation**

Update `src/config/config.ts` to:

- import `ThinkingLevel` and `isThinkingLevel`;
- add required `thinkingLevel` to `CodeNConfig`;
- parse a present JSON `thinkingLevel` strictly in `pickOverrides()`;
- default it to `default`;
- parse a present `CODEN_THINKING_LEVEL` strictly instead of ignoring unknown values;
- retain the existing merge order.

Do not register the Commander option yet; Task 5 adds localized help and CLI integration in one passing change.

- [ ] **Step 7: Run focused tests and typecheck**

Run: `bun test test/thinking.test.ts test/config.test.ts && bun run typecheck`

Expected: PASS.

- [ ] **Step 8: Commit the foundation**

```bash
git add src/core/thinking.ts src/providers/thinking.ts src/config/config.ts src/cli/agent-command.ts test/thinking.test.ts test/config.test.ts
git commit -m "feat: define thinking levels and mappings"
```

---

### Task 2: Provider Request Parameters and Anthropic State Round-Trip

**Files:**
- Modify: `src/core/types.ts:14-64`
- Modify: `src/core/runtime.ts:252-405`
- Modify: `src/providers/openai.ts:1-74`
- Modify: `src/providers/anthropic.ts:1-124`
- Modify: `test/providers.test.ts:1-215`

**Interfaces:**
- Consumes: `ThinkingLevel`, `ProviderMessageState`, `toOpenAIReasoningEffort()`, `toAnthropicThinkingConfig()` from Task 1.
- Produces: `ModelRequest.thinkingLevel?: ThinkingLevel`.
- Produces: `AssistantMessage.providerState?: ProviderMessageState`.
- Produces: `ModelEvent` variant `{ type: "provider_state"; state: ProviderMessageState }`.
- Produces: `accumulateStream()` result with optional `providerState`.

- [ ] **Step 1: Write failing OpenAI request-body tests**

In `test/providers.test.ts`, capture the object passed to `client.chat.completions.create` and assert:

```ts
expect(await captureOpenAIRequest("default")).not.toHaveProperty("reasoning_effort");
expect(await captureOpenAIRequest("off")).toHaveProperty("reasoning_effort", "minimal");
expect(await captureOpenAIRequest("medium")).toHaveProperty("reasoning_effort", "medium");
```

The helper must instantiate `OpenAICompatibleProvider`, replace `client.chat.completions.create` with a function that records the first argument and returns an empty async iterable, and call `provider.stream()` to completion.

- [ ] **Step 2: Write failing Anthropic request and stream-state tests**

Add a capture helper for `client.messages.stream`, then assert `default` omits `thinking`, `off` sends disabled, and `high` with 8192 sends 6144.

Add a stream fixture containing:

```ts
[
  {
    type: "content_block_start",
    index: 0,
    content_block: { type: "thinking", thinking: "", signature: "" },
  },
  {
    type: "content_block_delta",
    index: 0,
    delta: { type: "thinking_delta", thinking: "inspect files" },
  },
  {
    type: "content_block_delta",
    index: 0,
    delta: { type: "signature_delta", signature: "signed" },
  },
  { type: "content_block_stop", index: 0 },
  {
    type: "content_block_start",
    index: 1,
    content_block: { type: "redacted_thinking", data: "opaque" },
  },
  { type: "content_block_stop", index: 1 },
]
```

Assert the normalized events contain one `reasoning_delta` and one final `provider_state` whose data preserves both blocks and signature.

- [ ] **Step 3: Write a failing message replay test**

Construct an assistant message with Anthropic Provider state and a tool call, pass it through `toAnthropicMessages()`, and assert exact ordering:

```ts
expect(converted.messages[1]).toMatchObject({
  role: "assistant",
  content: [
    { type: "thinking", thinking: "inspect files", signature: "signed" },
    { type: "redacted_thinking", data: "opaque" },
    { type: "tool_use", id: "c1" },
  ],
});
```

Add a malformed matching Anthropic state case that throws, and a state with `provider: "openai"` that is ignored.

- [ ] **Step 4: Run Provider tests and verify the new expectations fail**

Run: `bun test test/providers.test.ts`

Expected: FAIL because request types, parameter mapping, state events, and replay do not exist.

- [ ] **Step 5: Extend the core request, message, and stream contracts**

In `src/core/types.ts`:

```ts
export interface AssistantMessage {
  role: "assistant";
  content: string;
  toolCalls: ToolCall[];
  model?: string;
  usage?: Usage;
  providerState?: ProviderMessageState;
}

export interface ModelRequest {
  // existing fields
  thinkingLevel?: ThinkingLevel;
}
```

Add the Provider-state event to `ModelEvent` and import the Task 1 types.

In `accumulateStream()`, collect the last `provider_state` from a successful stream and return it only when present:

```ts
return {
  text,
  toolCalls,
  usage,
  ...(providerState ? { providerState } : {}),
};
```

Use `isProviderMessageState()` before accepting the event and throw `CodeNError` with code `provider.invalid_state` for malformed state.

- [ ] **Step 6: Implement OpenAI parameter mapping**

In `src/providers/openai.ts`, calculate the effort once and conditionally spread it into `chat.completions.create`:

```ts
const reasoningEffort = toOpenAIReasoningEffort(request.thinkingLevel ?? "default");

{
  model: request.model,
  // existing fields
  ...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {}),
}
```

Do not catch a 4xx error and resend without the field.

- [ ] **Step 7: Implement Anthropic parameter mapping and state collection**

In `src/providers/anthropic.ts`:

1. Resolve `thinking` from `request.thinkingLevel ?? "default"` and `request.maxOutputTokens`.
2. Conditionally spread it into `messages.stream()`.
3. Maintain a map keyed by content-block index for normalized thinking/redacted-thinking blocks.
4. Emit visible `reasoning_delta` only for `thinking_delta`.
5. Append signature deltas to the matching thinking block without displaying them.
6. Emit one `provider_state` before `done` when at least one reasoning block exists.
7. Decode matching assistant `providerState` with a strict local shape guard and prepend the recovered blocks in `toAnthropicMessages()`.

Use this stable Provider payload shape:

```ts
interface AnthropicProviderStateData {
  thinkingBlocks: Array<
    | { type: "thinking"; thinking: string; signature: string }
    | { type: "redacted_thinking"; data: string }
  >;
}
```

- [ ] **Step 8: Run Provider tests and typecheck**

Run: `bun test test/providers.test.ts && bun run typecheck`

Expected: PASS, including existing tool-call and finish-reason tests.

- [ ] **Step 9: Commit Provider support**

```bash
git add src/core/types.ts src/core/runtime.ts src/providers/openai.ts src/providers/anthropic.ts test/providers.test.ts
git commit -m "feat: map provider thinking requests"
```

---

### Task 3: Runtime Turn Snapshots and Session Persistence

**Files:**
- Modify: `src/context/manager.ts:177-193`
- Modify: `src/core/runtime.ts:14-205,252-334`
- Modify: `src/sessions/store.ts:10-218`
- Modify: `test/runtime.integration.test.ts:48-95,450-665`
- Modify: `test/context-session.test.ts:1-330`
- Modify: `test/approval-reviewer.test.ts:60-90`

**Interfaces:**
- Consumes: Task 2 `ModelRequest.thinkingLevel`, `providerState`, and accumulated result.
- Produces: `RuntimeOptions.thinkingLevel?: ThinkingLevel`.
- Produces: `AgentRuntime.thinkingLevel` getter and `updateThinkingLevel(level): void`.
- Produces: `SessionStore.appendThinkingLevel(level): Promise<void>`.
- Produces: `RecoveredSession.thinkingLevel?: ThinkingLevel`.

- [ ] **Step 1: Write failing Runtime propagation and isolation tests**

Extend the runtime harness with an optional `thinkingLevel` argument passed through `RuntimeOptions`. Add a tool-loop test whose scripted steps inspect both requests:

```ts
const provider = new ScriptedProvider([
  (request) => {
    expect(request.thinkingLevel).toBe("high");
    return scriptedTool("r", "read", { path: "file.txt" });
  },
  (request) => {
    expect(request.thinkingLevel).toBe("high");
    return scriptedText("done");
  },
]);
```

Add a retry assertion by recording every `request.thinkingLevel` in a fail-then-succeed Provider. Add a dynamic switch test:

```ts
expect(runtime.thinkingLevel).toBe("low");
runtime.updateThinkingLevel("high");
await runtime.run("next");
expect(provider.requests.at(-1)?.thinkingLevel).toBe("high");
```

In the existing proactive compaction test, assert the request with `tools: []` has `thinkingLevel === undefined`. In `test/approval-reviewer.test.ts`, assert reviewer requests also leave it undefined.

- [ ] **Step 2: Write failing Provider-state assistant persistence test**

Use a `ScriptedProvider` response containing `provider_state` and final text. Assert both `runtime.messages` and `session.recover().messages` contain the exact optional state on the assistant message.

- [ ] **Step 3: Write failing session-level record tests**

In `test/context-session.test.ts`, add:

```ts
await store.create(root);
await store.appendThinkingLevel("low");
await store.appendThinkingLevel("high");
expect((await store.recover()).thinkingLevel).toBe("high");
```

Append a complete `session.thinking` record with `level: "extreme"` and assert recovery rejects it. Add an assistant message with valid JSON Provider state and verify it round-trips; add a non-JSON-safe state record and assert `isMessage()` rejects it during recovery.

- [ ] **Step 4: Run focused tests and verify failure**

Run: `bun test test/runtime.integration.test.ts test/context-session.test.ts test/approval-reviewer.test.ts`

Expected: FAIL because Runtime does not propagate thinking level and sessions do not store it.

- [ ] **Step 5: Add main-request level propagation**

Update `toModelRequest()` to accept an optional final `thinkingLevel` and include it only when supplied. In `AgentRuntime`:

```ts
private currentThinkingLevel: ThinkingLevel;

get thinkingLevel(): ThinkingLevel {
  return this.currentThinkingLevel;
}

updateThinkingLevel(level: ThinkingLevel): void {
  this.currentThinkingLevel = level;
}
```

Initialize it from `options.thinkingLevel ?? "default"`. At the beginning of `run()`, snapshot it into a local constant before any awaited work. Pass that constant to both the normal `toModelRequest()` and emergency-compaction reconstruction. Do not pass it to `refineSummary()`.

Use the accumulated optional `providerState` when creating `AssistantMessage`:

```ts
const assistant: AssistantMessage = {
  role: "assistant",
  content: accumulated.text,
  toolCalls: accumulated.toolCalls,
  model: this.options.model,
  usage: accumulated.usage,
  ...(accumulated.providerState ? { providerState: accumulated.providerState } : {}),
};
```

- [ ] **Step 6: Persist the initial and changed session level**

Add `SessionStore.appendThinkingLevel(level)` as a typed wrapper around `append("session.thinking", { level })`.

At the start of `run()`:

```ts
const newSession = !this.sessions.isCreated;
await this.sessions.create();
if (newSession) await this.sessions.appendThinkingLevel(turnThinkingLevel);
```

This preserves the existing no-empty-session behavior and records the value selected by any `/thinking` command issued before the first turn.

In `recover()`, retain the last valid `session.thinking` across `session.reset`, add it to `RecoveredSession`, and validate it with `isThinkingLevel()`. Extend assistant-message validation so an absent state remains valid and a present state must pass `isProviderMessageState()`.

- [ ] **Step 7: Run focused tests and typecheck**

Run: `bun test test/runtime.integration.test.ts test/context-session.test.ts test/approval-reviewer.test.ts && bun run typecheck`

Expected: PASS. Confirm the existing test “does not persist a new session until the first turn” still passes and now finds `session.thinking` after the first run.

- [ ] **Step 8: Commit Runtime and session behavior**

```bash
git add src/context/manager.ts src/core/runtime.ts src/sessions/store.ts test/runtime.integration.test.ts test/context-session.test.ts test/approval-reviewer.test.ts
git commit -m "feat: persist session thinking level"
```

---

### Task 4: Application Startup Precedence and Atomic Switching

**Files:**
- Modify: `src/cli/agent-application.ts:45-125,250-325`
- Modify: `test/thinking.test.ts`
- Modify: `test/tui-controller.test.ts:11-57`
- Modify: `test/tui-components.test.tsx:20-31`
- Modify: `test/tui-frame.test.tsx:15-28`

**Interfaces:**
- Consumes: `RecoveredSession.thinkingLevel`, `ThinkingStatus`, mapping helpers, Runtime update method, session append method.
- Produces: `resolveInitialThinkingLevel(explicit, recovered, configured): ThinkingLevel`.
- Produces: metadata fields `thinkingLevel` and `thinkingDisplay`.
- Produces: `AgentApplication.getThinkingStatus(): ThinkingStatus` and `switchThinkingLevel(level): Promise<ThinkingStatus>`.

- [ ] **Step 1: Write failing launch-precedence tests**

Add pure tests to `test/thinking.test.ts` for an exported helper:

```ts
expect(resolveInitialThinkingLevel(undefined, "low", "high")).toBe("low");
expect(resolveInitialThinkingLevel("off", "low", "high")).toBe("off");
expect(resolveInitialThinkingLevel(undefined, undefined, "medium")).toBe("medium");
```

Add a focused application test using a temporary `XDG_DATA_HOME`, a pre-created `SessionStore`, and `CODEN_OPENAI_API_KEY=test`. Resume a session saved with `low` while config says `high`; assert application metadata and Runtime use `low`. Repeat with command `thinking: "off"`; assert the recovered session ends with `off`.

Use no-op interaction callbacks and always dispose the application in `finally`.

- [ ] **Step 2: Write failing dynamic-switch tests**

Subscribe to application events, call `switchThinkingLevel("high")`, and assert:

```ts
expect(application.runtime.thinkingLevel).toBe("high");
expect(application.metadata).toMatchObject({
  thinkingLevel: "high",
  thinkingDisplay: "high",
});
expect(observed).toContainEqual(
  expect.objectContaining({ type: "thinking.changed", data: expect.objectContaining({ level: "high" }) }),
);
expect((await application.session.recover()).thinkingLevel).toBe("high");
```

Call the same value again and assert the session file contains only one new `session.thinking` record.

- [ ] **Step 3: Run the tests and verify failure**

Run: `bun test test/thinking.test.ts`

Expected: FAIL because application resolution, metadata, and switch methods do not exist.

- [ ] **Step 4: Resolve startup status after session recovery**

In `createAgentApplication()`:

1. Pass optional `command.thinking` into `loadConfig()`.
2. Capture `recovered.thinkingLevel` during resume.
3. Resolve with `command.thinking ?? recoveredThinkingLevel ?? config.thinkingLevel`.
4. Call `resolveThinkingStatus(config.provider, resolvedLevel, config.reservedOutputTokens)` before constructing Runtime.
5. Wrap deterministic mapping/budget failures in `ConfigError`.
6. Pass the resolved level through `RuntimeOptions`.

Export the pure three-argument resolver for direct tests.

- [ ] **Step 5: Add metadata and switch API**

Create one mutable metadata object before returning the application:

```ts
const metadata: AgentApplicationMetadata = {
  provider: config.provider,
  model: config.model,
  workspace,
  workspaceId: workspaceHash(workspace),
  approvalMode: permissionMode,
  sessionId: session.sessionId,
  thinkingLevel: initialThinking.level,
  thinkingDisplay: initialThinking.displayLevel,
};
```

Implement `getThinkingStatus()` from the current Runtime value and shared mapping helper. Implement `switchThinkingLevel()` in this order:

1. Resolve and validate the next status without mutation.
2. Return immediately when the level is unchanged.
3. If the session exists, await `appendThinkingLevel()`.
4. Update Runtime and metadata.
5. Await `events.emit("thinking.changed", { level, effectiveLevel, displayLevel, budgetTokens? })`.
6. Return the next status.

After all startup initialization succeeds, append an explicit resume CLI override when it differs from the recovered value. Do not append ordinary config fallback over a saved session value.

- [ ] **Step 6: Update typed application fixtures**

Add `thinkingLevel: "default"` and `thinkingDisplay: "default"` to metadata fixtures in `test/tui-controller.test.ts`, `test/tui-components.test.tsx`, and `test/tui-frame.test.tsx`. Add no-op `getThinkingStatus` and `switchThinkingLevel` methods to fake `AgentApplication` objects so typecheck remains green before the command task.

- [ ] **Step 7: Run application-focused tests and typecheck**

Run: `bun test test/thinking.test.ts test/tui-controller.test.ts test/tui-components.test.tsx test/tui-frame.test.tsx && bun run typecheck`

Expected: PASS.

- [ ] **Step 8: Commit application coordination**

```bash
git add src/cli/agent-application.ts test/thinking.test.ts test/tui-controller.test.ts test/tui-components.test.tsx test/tui-frame.test.tsx
git commit -m "feat: resolve and switch application thinking"
```

---

### Task 5: CLI Option, Shared `/thinking` Command, and Localization

**Files:**
- Modify: `src/cli/index.ts:20-85`
- Modify: `src/cli/agent-command.ts:100-175,278-291`
- Modify: `src/cli/repl-command.ts:1-130`
- Modify: `src/tui/controller.ts:78-115`
- Modify: `src/i18n/locales/en.ts:1-65`
- Modify: `src/i18n/locales/zh.ts:1-65`
- Modify: `test/cli.test.ts:1-135`
- Modify: `test/repl-command.test.ts:1-90`
- Modify: `test/tui-controller.test.ts:1-110`
- Modify: `test/i18n.test.ts`

**Interfaces:**
- Consumes: `parseThinkingLevel`, application status/switch methods, `ThinkingStatus`.
- Produces: Commander option `--thinking <level>`.
- Produces: classified input `{ type: "thinking"; level?: string }`.
- Produces: localized `/thinking` query/change/error output.

- [ ] **Step 1: Write failing CLI help and validation tests**

In `test/cli.test.ts`, clear `CODEN_THINKING_LEVEL` in `baseEnv`, then extend the help test:

```ts
expect(help.stdout).toContain("--thinking <level>");
```

Add an invalid invocation:

```ts
const invalid = spawnSync("bun", [cli, "--thinking", "extreme", "task"], {
  encoding: "utf8",
  env: baseEnv,
  timeout: 30_000,
});
expect(invalid.status).toBe(1);
expect(invalid.stderr).toContain("default, off, minimal, low, medium, or high");
```

Commander parser failures are not `ConfigError`, so this invocation must exit with code 1 and must not be rerouted through the configuration-error exit code 2.

- [ ] **Step 2: Write failing shared command tests**

Extend the `dependencies()` helper in `test/repl-command.test.ts` with:

```ts
const getThinkingStatus = vi.fn(() => ({
  level: "medium" as const,
  effectiveLevel: "medium" as const,
  displayLevel: "medium",
}));
const switchThinkingLevel = vi.fn(async () => ({
  level: "off" as const,
  effectiveLevel: "minimal" as const,
  displayLevel: "off→minimal",
}));
```

Test classification and execution:

```ts
await expect(executeReplCommand("/thinking", deps.value)).resolves.toMatchObject({
  type: "output",
  text: expect.stringContaining("medium"),
});
await expect(executeReplCommand("/thinking off", deps.value)).resolves.toMatchObject({
  type: "output",
  text: expect.stringContaining("off→minimal"),
});
expect(deps.switchThinkingLevel).toHaveBeenCalledWith("off");
await expect(executeReplCommand("/thinking extreme", deps.value)).resolves.toMatchObject({
  type: "output",
  text: expect.stringContaining("Unsupported thinking level"),
});
```

Assert multiline `/thinking high\ntext` remains a normal message.

- [ ] **Step 3: Run CLI and command tests and verify failure**

Run: `bun test test/cli.test.ts test/repl-command.test.ts`

Expected: FAIL because the option and command are not registered.

- [ ] **Step 4: Register the startup option and wire config loading**

In `src/cli/index.ts`, register:

```ts
.option("--thinking <level>", m.thinking, parseThinkingLevel)
```

Ensure both `createAgentApplication()` and session-list config loading receive the optional value only when defined. Add `thinking` to English and Chinese CLI messages.

- [ ] **Step 5: Implement shared command classification and output**

Add a dedicated `thinking` classified-input variant, parallel to `/lang`, only for a single-line input beginning exactly with `/thinking`.

Extend `ReplCommandDependencies`:

```ts
getThinkingStatus(): ThinkingStatus;
switchThinkingLevel(level: ThinkingLevel): Promise<ThinkingStatus>;
```

Implement a `formatThinkingStatus(status, i18n)` helper that prints supported values, configured level, effective mapping, optional Anthropic token budget, and usage. On change, parse with `isThinkingLevel()`, call the shared switch method, and format the returned status. Catch switch failures and report them without terminating the REPL.

Update `/help` in both locales to include `/thinking` and add a top-level `thinking` message group containing:

- supported-values heading;
- current level formatter;
- effective mapping formatter;
- budget formatter;
- usage;
- changed formatter;
- invalid-value formatter;
- switch-failed formatter.

- [ ] **Step 6: Wire both CLI REPL and TUI controller to the shared application API**

Pass `application.getThinkingStatus` and `application.switchThinkingLevel` into `executeReplCommand()` in both `src/cli/agent-command.ts` and `src/tui/controller.ts`. Update fake application methods in controller tests to mutate their returned status and assert `/thinking high` adds an info transcript block instead of starting `runtime.run()`.

- [ ] **Step 7: Run command, CLI, controller and i18n tests**

Run: `bun test test/cli.test.ts test/repl-command.test.ts test/tui-controller.test.ts test/i18n.test.ts && bun run typecheck`

Expected: PASS in both English and Chinese message shapes.

- [ ] **Step 8: Commit user command support**

```bash
git add src/cli/index.ts src/cli/agent-command.ts src/cli/repl-command.ts src/tui/controller.ts src/i18n/locales/en.ts src/i18n/locales/zh.ts test/cli.test.ts test/repl-command.test.ts test/tui-controller.test.ts test/i18n.test.ts
git commit -m "feat: add thinking CLI and session command"
```

---

### Task 6: TUI Metadata Refresh and Status Display

**Files:**
- Modify: `src/tui/store.ts:35-250`
- Modify: `src/tui/components/status-bar.tsx:1-58`
- Modify: `test/tui-store.test.ts:1-210`
- Modify: `test/tui-components.test.tsx:20-315`
- Modify: `test/tui-frame.test.tsx`

**Interfaces:**
- Consumes: `AgentApplicationMetadata.thinkingLevel`, `thinkingDisplay`, and `thinking.changed` event.
- Produces: immediate metadata refresh in `TuiStore`.
- Produces: status segment `think <displayLevel>` before the phase segment.

- [ ] **Step 1: Write failing status formatting tests**

Update the metadata fixture to include `thinkingDisplay: "off→minimal"`. Assert a wide status contains:

```text
openai/gpt-test · workspace · smart · think off→minimal · thinking · context 42%
```

Retain the existing 18-column assertion that the model segment survives as the highest-priority fallback. Add a `default` fixture and assert `think default` is visible at a sufficient width.

- [ ] **Step 2: Write a failing store-event test**

After setting initial metadata on `TuiStore`, emit:

```ts
await events.emit("thinking.changed", {
  level: "off",
  effectiveLevel: "minimal",
  displayLevel: "off→minimal",
});
```

Assert `store.getSnapshot().metadata` now contains the changed level/display while preserving provider, model, workspace and session fields.

- [ ] **Step 3: Run focused TUI tests and verify failure**

Run: `bun test test/tui-components.test.tsx test/tui-store.test.ts test/tui-frame.test.tsx`

Expected: FAIL because status and store do not handle thinking metadata.

- [ ] **Step 4: Render thinking in status priority order**

In `formatStatus()`, insert:

```ts
`think ${metadata.thinkingDisplay}`,
```

between approval mode and phase. Keep provider/model first so the existing narrow-screen fallback remains stable. Do not include Anthropic token counts in the one-line status.

- [ ] **Step 5: Apply change events immutably in the store**

Add a `thinking.changed` case that copies the current metadata and updates only:

```ts
thinkingLevel: data.level as ThinkingLevel,
thinkingDisplay: String(data.displayLevel),
```

Guard against missing metadata and invalid event levels; malformed observation events must not corrupt the snapshot. Calling `update()` must produce a new snapshot so `useSyncExternalStore` repaints immediately.

- [ ] **Step 6: Run focused TUI tests and typecheck**

Run: `bun test test/tui-components.test.tsx test/tui-store.test.ts test/tui-frame.test.tsx && bun run typecheck`

Expected: PASS, including existing cursor, transcript and narrow-status expectations.

- [ ] **Step 7: Commit TUI display support**

```bash
git add src/tui/store.ts src/tui/components/status-bar.tsx test/tui-store.test.ts test/tui-components.test.tsx test/tui-frame.test.tsx
git commit -m "feat: show thinking level in TUI"
```

---

### Task 7: Documentation, Privacy Notes, and Full Regression Gate

**Files:**
- Modify: `README.md:35-105`
- Modify: any focused test file above only when the full gate exposes a missing acceptance case.

**Interfaces:**
- Consumes: all completed user-facing behavior.
- Produces: final documented configuration, mapping, persistence, privacy and validation evidence.

- [ ] **Step 1: Update README usage and option lists**

Add runnable examples:

```bash
coden --thinking high "分析并修复这个并发问题"
export CODEN_THINKING_LEVEL=medium
coden --resume <session-id>
```

Add `/thinking` to the shared REPL command list and `--thinking` to core options.

- [ ] **Step 2: Document config, precedence and Provider mappings**

Add `"thinkingLevel": "default"` to the JSON example and `CODEN_THINKING_LEVEL` to supported environment variables. Document:

```text
default | off | minimal | low | medium | high
```

State that resume uses saved session level unless explicit `--thinking` overrides it. Include the OpenAI `off→minimal` behavior and the Anthropic 1024/25%/50%/75% mapping, including that thinking consumes part of `reservedOutputTokens`.

- [ ] **Step 3: Document unsupported models and sensitive reasoning data**

State that CodeN does not maintain a model allowlist or silently remove rejected parameters. Add a privacy warning that session JSONL and trace files can contain thinking, redacted-thinking, signatures, user text and code fragments; retain the documented storage path and private filesystem permissions, and advise users to review before sharing.

- [ ] **Step 4: Run formatting and focused feature tests**

Run:

```bash
just fmt
bun test test/thinking.test.ts test/config.test.ts test/providers.test.ts test/runtime.integration.test.ts test/context-session.test.ts test/approval-reviewer.test.ts test/repl-command.test.ts test/cli.test.ts test/tui-controller.test.ts test/tui-store.test.ts test/tui-components.test.tsx test/tui-frame.test.tsx
```

Expected: PASS. Inspect `git status --short` after formatting and revert any formatter-only change outside the declared feature files.

- [ ] **Step 5: Run the full project gate**

Run:

```bash
just check
just build
node dist/index.js --help
git diff --check
git status --short
```

Expected:

- `just check` passes lint, typecheck and the complete Vitest suite;
- `just build` produces the Node 22-compatible artifact;
- built help contains `--thinking <level>`;
- `git diff --check` prints nothing;
- the only unrelated path remains the pre-existing untracked `docs/superpowers/plans/2026-08-30-agent-lifecycle-hooks.md`.

- [ ] **Step 6: Review final acceptance evidence**

Use `rg` to verify all wiring points:

```bash
rg -n "thinkingLevel|CODEN_THINKING_LEVEL|--thinking|/thinking|provider_state|session\.thinking" src test README.md
```

Confirm every design acceptance criterion has a corresponding implementation and passing test: default omission, main-only propagation, OpenAI mapping, Anthropic budget/state replay, session resume precedence, dynamic command, TUI display, errors and privacy documentation.

- [ ] **Step 7: Commit documentation and final corrections**

```bash
git add README.md \
  src/core/thinking.ts src/core/types.ts src/core/runtime.ts src/context/manager.ts \
  src/config/config.ts src/providers/thinking.ts src/providers/openai.ts src/providers/anthropic.ts \
  src/sessions/store.ts src/cli/index.ts src/cli/agent-command.ts \
  src/cli/agent-application.ts src/cli/repl-command.ts src/tui/controller.ts \
  src/tui/store.ts src/tui/components/status-bar.tsx src/i18n/locales/en.ts \
  src/i18n/locales/zh.ts test/thinking.test.ts test/config.test.ts test/cli.test.ts \
  test/providers.test.ts test/runtime.integration.test.ts test/context-session.test.ts \
  test/approval-reviewer.test.ts test/repl-command.test.ts test/tui-controller.test.ts \
  test/tui-store.test.ts test/tui-components.test.tsx test/tui-frame.test.tsx test/i18n.test.ts
git status --short
git commit -m "docs: document thinking level controls"
```

Before committing, verify the staged list contains only the paths above and does not contain `docs/superpowers/plans/2026-08-30-agent-lifecycle-hooks.md` or unrelated user files.
