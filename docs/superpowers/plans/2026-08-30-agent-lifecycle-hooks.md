# CodeN Agent Lifecycle Hooks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Claude Code-style command hooks at CodeN's core Agent Loop lifecycle points, including permission notifications, controlled decisions, trusted project configuration, deterministic parallel merging, and safe process execution.

**Architecture:** A dedicated `HookEngine` owns matching, command dispatch, protocol validation, and deterministic aggregation; `EventBus` remains observability-only. `AgentRuntime`, `ToolExecutor`, permission handling, and CLI composition call the engine explicitly at lifecycle control points, while project hooks and project plugins share one realpath-based workspace trust boundary.

**Tech Stack:** TypeScript 5.9, Node.js standard APIs (`node:child_process`, streams, `AbortSignal`), Bun as the development command runner, Vitest, Biome, AJV through the existing `ToolRegistry`, and Just.

**Spec:** `docs/superpowers/specs/2026-08-30-agent-lifecycle-hooks-design.md`

## Global Constraints

- First release supports command hooks only; do not add HTTP, Prompt, Agent, or TypeScript callback handlers.
- Supported events are exactly `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PermissionRequest`, `PostToolUse`, `PostToolUseFailure`, `Notification`, `Stop`, and `SessionEnd`.
- Use user config `~/.config/coden/config.json` and project config `<workspace>/.coden/config.json`; merge by appending user hooks before project hooks.
- Project hooks execute only after explicit realpath-based workspace trust; `--auto` never creates trust and must no longer bypass project plugin trust.
- Hook commands receive one JSON object on stdin, run in the workspace, inherit the environment, and receive `CODEN_PROJECT_DIR`, `CODEN_SESSION_ID`, and `CODEN_HOOK_EVENT`.
- Default timeout is 10 seconds; accepted timeout range is 1–600 seconds.
- stdin is limited to 1 MiB; stdout and stderr are each limited to 10 KiB; at most 64 commands may be configured for one event after scope merging.
- Exit `0` means success, exit `2` is an explicit block only for controllable events, and all other failures are fail-open warnings unless the parent `AbortSignal` was cancelled.
- Matching hooks run concurrently; decisions merge as `deny > ask > allow > none`; one `updatedInput` is accepted and multiple updates conflict and fall back to the original input.
- Every modified tool input must be revalidated and reclassified, including realpath/workspace checks, before permission or execution.
- Trace events must never contain full hook stdin, stdout, stderr, tool input, updated input, additional context, or system messages.
- Hook-created context must be distinguishable from real user input in persistence and resume rendering.
- Do not use Bun-specific runtime APIs; the built `dist/index.js` must run under Node.
- The separate smart-approval design is not implemented in the current source baseline. Execute this Hooks plan first; a later smart-approval implementation should extend the permission assessment seam introduced in Task 5 rather than reverting it.

## File Structure

- `src/hooks/types.ts` — stable event, payload, configured-hook, execution-context, and aggregate-result contracts.
- `src/hooks/config.ts` — strict Hook config parser, event/matcher validation, scope flattening, and merged limits.
- `src/hooks/command-runner.ts` — shell child process, stdin JSON, bounded output, timeout, cancellation, and process-group termination.
- `src/hooks/engine.ts` — matcher selection, concurrent execution, event-aware protocol parsing, result aggregation, and redacted events.
- `src/config/config.ts` — load scoped hooks alongside existing config fields without losing user/project provenance.
- `src/permissions/policy.ts` — expose deterministic risk assessment separately from human prompting.
- `src/tools/executor.ts` — tool lifecycle Hook ordering, final input validation, permission Hook decisions, and post events.
- `src/core/runtime.ts` — user prompt, Stop, attention notification, and Hook-context lifecycle.
- `src/core/types.ts` — distinguish Hook-originated context messages from genuine user messages.
- `src/sessions/store.ts` — persist/recover effective Hook-modified tool inputs safely.
- `src/cli/agent-command.ts` — shared workspace trust, HookEngine composition, SessionStart/SessionEnd, and permission notifications.
- `src/cli/format.ts` — hide Hook-originated model context from the user transcript.
- `src/cli/index.ts` — correct `--auto` help text.
- `src/tools/plugin-loader.ts` — remove the `--auto` project-trust bypass.
- `src/observability/terminal.ts` — concise Hook diagnostics with verbose-only success output.
- `README.md` — event/config/protocol/security/macOS examples.

---

### Task 1: Define and Strictly Load Scoped Hook Configuration

**Files:**
- Create: `src/hooks/types.ts`
- Create: `src/hooks/config.ts`
- Modify: `src/config/config.ts`
- Create: `test/hooks-config.test.ts`
- Modify: `test/config.test.ts`

**Interfaces:**
- Produces: `HookEventName`, `HookScope`, `HookPermissionMode`, `HookPayloadMap`, `HookInvocationContext`, `ConfiguredCommandHook`, `HookAggregateResult`, `parseHookConfig()`, and `mergeConfiguredHooks()`.
- Produces: `CodeNConfig.hooks: ConfiguredCommandHook[]` for startup composition in Task 4.
- Consumes: existing user/project config loading and `ToolRisk`/`ToolResult` core types.

- [ ] **Step 1: Add failing tests for valid flattening, source order, matchers, defaults, and strict rejection**

Create `test/hooks-config.test.ts` with fixtures that call the parser directly and through `loadConfig`:

```ts
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadConfig } from "../src/config/config.js";
import { mergeConfiguredHooks, parseHookConfig } from "../src/hooks/config.js";

afterEach(() => vi.unstubAllEnvs());

describe("hook configuration", () => {
  it("flattens command groups with matcher, scope, timeout, and stable order", () => {
    const user = parseHookConfig(
      {
        PermissionRequest: [
          {
            matcher: "bash|write",
            hooks: [{ type: "command", command: "notify", timeout: 5 }],
          },
        ],
      },
      "user",
    );
    const project = parseHookConfig(
      {
        Stop: [{ hooks: [{ type: "command", command: "verify" }] }],
      },
      "project",
    );

    const hooks = mergeConfiguredHooks(user, project);
    expect(hooks.map(({ event, scope, order, matcherSource, timeoutMs }) => ({
      event,
      scope,
      order,
      matcherSource,
      timeoutMs,
    }))).toEqual([
      {
        event: "PermissionRequest",
        scope: "user",
        order: 0,
        matcherSource: "bash|write",
        timeoutMs: 5_000,
      },
      {
        event: "Stop",
        scope: "project",
        order: 1,
        matcherSource: "*",
        timeoutMs: 10_000,
      },
    ]);
    expect(hooks[0]?.matcher?.test("bash")).toBe(true);
  });

  it.each([
    [{ Unknown: [] }, "unsupported hook event"],
    [{ Stop: [{ matcher: "bash", hooks: [] }] }, "does not accept a matcher"],
    [{ PreToolUse: [{ matcher: "(", hooks: [] }] }, "invalid matcher"],
    [{ PreToolUse: [{ hooks: [{ type: "http", command: "x" }] }] }, "type"],
    [{ PreToolUse: [{ hooks: [{ type: "command", command: "", timeout: 10 }] }] }, "command"],
    [{ PreToolUse: [{ hooks: [{ type: "command", command: "x", timeout: 0 }] }] }, "timeout"],
    [{ PreToolUse: [{ extra: true, hooks: [] }] }, "unknown field"],
  ])("rejects invalid hook config %#", (raw, message) => {
    expect(() => parseHookConfig(raw, "user")).toThrow(message);
  });
});
```

Add a filesystem-backed `loadConfig` test proving user hooks precede project hooks and a generated case with 65 commands for one event proving the merged event limit is rejected.

- [ ] **Step 2: Run the focused tests and verify RED**

Run:

```bash
bun run test -- test/hooks-config.test.ts test/config.test.ts
```

Expected: FAIL because `src/hooks/config.ts`, Hook types, and `CodeNConfig.hooks` do not exist.

- [ ] **Step 3: Define exact lifecycle and aggregate contracts**

Create `src/hooks/types.ts` with these exported shapes:

```ts
import type { ToolResult, ToolRisk } from "../core/types.js";

export const HOOK_EVENT_NAMES = [
  "SessionStart",
  "UserPromptSubmit",
  "PreToolUse",
  "PermissionRequest",
  "PostToolUse",
  "PostToolUseFailure",
  "Notification",
  "Stop",
  "SessionEnd",
] as const;

export type HookEventName = (typeof HOOK_EVENT_NAMES)[number];
export type HookScope = "user" | "project";
export type HookPermissionMode = "manual" | "smart" | "auto";
export type HookPermissionDecision = "allow" | "ask" | "deny";
export type SessionEndReason = "completed" | "failed" | "cancelled" | "eof" | "quit";

export interface ConfiguredCommandHook {
  event: HookEventName;
  scope: HookScope;
  order: number;
  matcherSource: string;
  matcher?: RegExp;
  command: string;
  timeoutMs: number;
}

export interface HookInvocationContext {
  cwd: string;
  sessionId: string;
  permissionMode: HookPermissionMode;
  turnId?: string;
  signal?: AbortSignal;
}

export interface HookPayloadMap {
  SessionStart: { source: "startup" | "resume" };
  UserPromptSubmit: { prompt: string };
  PreToolUse: { toolName: string; callId: string; input: unknown; risk: ToolRisk };
  PermissionRequest: {
    toolName: string;
    callId: string;
    input: unknown;
    risk: ToolRisk;
    reason: "policy" | "hook";
  };
  PostToolUse: {
    toolName: string;
    callId: string;
    input: unknown;
    result: ToolResult;
    durationMs: number;
  };
  PostToolUseFailure: {
    toolName: string;
    callId: string;
    input: unknown;
    errorType: string;
    error: string;
    durationMs: number;
  };
  Notification: {
    notificationType: "permission_prompt" | "attention_required";
    title: string;
    message: string;
  };
  Stop: { answer: string; toolsExecuted: number; stopHookActive: boolean };
  SessionEnd: { reason: SessionEndReason };
}

export type HookInput<K extends HookEventName = HookEventName> = {
  schemaVersion: 1;
  hookEventName: K;
  sessionId: string;
  turnId?: string;
  cwd: string;
  permissionMode: HookPermissionMode;
} & HookPayloadMap[K];

export interface HookAggregateResult {
  blocked: boolean;
  blockReason?: string;
  permissionDecision?: HookPermissionDecision;
  permissionReason?: string;
  hasUpdatedInput: boolean;
  updatedInput?: unknown;
  inputConflict: boolean;
  additionalContext: string[];
  systemMessages: string[];
}
```

Keep `ToolResult` import type-only so the Hook protocol adds no runtime dependency.

- [ ] **Step 4: Implement strict parsing and scope-preserving merge**

In `src/hooks/config.ts`:

- use allowlists for every object level and reject unknown fields;
- require the root to be an object and each event value to be an array;
- allow specific matchers only for tool events, `Notification`, and `SessionStart`;
- treat absent or `"*"` matcher as `undefined` compiled matcher with `matcherSource: "*"`;
- compile other matcher strings with `new RegExp(source)`;
- flatten every command to one configured record;
- convert timeout seconds to integer milliseconds;
- assign global `order` after user/project concatenation;
- reject more than 64 flattened commands for any one event.

Export these exact signatures:

```ts
export type ParsedCommandHook = Omit<ConfiguredCommandHook, "order">;

export function parseHookConfig(raw: unknown, scope: HookScope): ParsedCommandHook[];

export function mergeConfiguredHooks(
  user: ParsedCommandHook[],
  project: ParsedCommandHook[],
): ConfiguredCommandHook[];
```

Keep public CLI `ConfigOverrides` free of a `hooks` field. Add an internal scoped shape and make `readJson()` receive the source scope:

```ts
type LoadedConfigOverrides = ConfigOverrides & { hooks?: ParsedCommandHook[] };

async function readJson(file: string, scope: HookScope): Promise<LoadedConfigOverrides>;
```

In `src/config/config.ts`, parse `raw.hooks` with that source scope, add `hooks: []` to defaults, make `stripEnv()` also omit internal `hooks`, and merge Hook records separately after the existing scalar merge:

```ts
const merged = {
  ...defaults,
  ...stripEnv(user),
  ...stripEnv(project),
  ...env,
  ...cli,
  env: mergedEnv,
};
merged.plugins = [...(user.plugins ?? []), ...(project.plugins ?? []), ...(cli.plugins ?? [])];
merged.hooks = mergeConfiguredHooks(user.hooks ?? [], project.hooks ?? []);
```

Do not allow CLI overrides to fabricate scoped Hook records.

- [ ] **Step 5: Run focused tests and format the touched files**

Run:

```bash
bun run test -- test/hooks-config.test.ts test/config.test.ts
bun run typecheck
bunx biome check src/hooks/types.ts src/hooks/config.ts src/config/config.ts test/hooks-config.test.ts test/config.test.ts
```

Expected: all commands PASS.

- [ ] **Step 6: Commit the configuration contract**

```bash
git add src/hooks/types.ts src/hooks/config.ts src/config/config.ts test/hooks-config.test.ts test/config.test.ts
git commit -m "feat: load scoped lifecycle hook configuration"
```

---

### Task 2: Execute Hook Commands with Bounded JSON I/O

**Files:**
- Create: `src/hooks/command-runner.ts`
- Create: `test/hook-command-runner.test.ts`

**Interfaces:**
- Consumes: `ConfiguredCommandHook`, `HookInput`, and `HookInvocationContext` from Task 1.
- Produces: `CommandHookRunResult`, `CommandHookRunner`, and `runCommandHook()` for Task 3.

- [ ] **Step 1: Write failing real-process tests for stdin, environment, limits, timeout, and cancellation**

Create `test/hook-command-runner.test.ts`. Build commands with a quoted `process.execPath`, and have the child read stdin using standard Node streams:

```ts
import { describe, expect, it } from "vitest";
import { runCommandHook } from "../src/hooks/command-runner.js";
import type { ConfiguredCommandHook, HookInput } from "../src/hooks/types.js";

const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
const node = quote(process.execPath);
const baseHook: ConfiguredCommandHook = {
  event: "Notification",
  scope: "user",
  order: 0,
  matcherSource: "*",
  command: "",
  timeoutMs: 1_000,
};
const input: HookInput<"Notification"> = {
  schemaVersion: 1,
  hookEventName: "Notification",
  sessionId: "session-1",
  cwd: process.cwd(),
  permissionMode: "manual",
  notificationType: "permission_prompt",
  title: "CodeN",
  message: "waiting",
};

describe("command hook runner", () => {
  it("writes JSON stdin and hook environment", async () => {
    const script = [
      "let s=''",
      "process.stdin.setEncoding('utf8')",
      "process.stdin.on('data', c => s += c)",
      "process.stdin.on('end', () => process.stdout.write(JSON.stringify({input:JSON.parse(s),event:process.env.CODEN_HOOK_EVENT})))",
    ].join(";");
    const result = await runCommandHook(
      { ...baseHook, command: `${node} -e ${quote(script)}` },
      input,
      { cwd: process.cwd(), sessionId: "session-1", permissionMode: "manual" },
    );
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      input: { hookEventName: "Notification", message: "waiting" },
      event: "Notification",
    });
  });

  it("marks stdout overflow and terminates the process", async () => {
    const result = await runCommandHook(
      { ...baseHook, command: `${node} -e ${quote("process.stdout.write('x'.repeat(11000))")}` },
      input,
      { cwd: process.cwd(), sessionId: "session-1", permissionMode: "manual" },
    );
    expect(result.outputExceeded).toBe(true);
    expect(Buffer.byteLength(result.stdout)).toBeLessThanOrEqual(10 * 1024);
  });

  it("times out and responds to parent cancellation", async () => {
    const command = `${node} -e ${quote("setInterval(() => {}, 1000)")}`;
    const timedOut = await runCommandHook(
      { ...baseHook, command, timeoutMs: 20 },
      input,
      { cwd: process.cwd(), sessionId: "session-1", permissionMode: "manual" },
    );
    expect(timedOut.timedOut).toBe(true);

    const controller = new AbortController();
    setTimeout(() => controller.abort(new Error("cancelled")), 20);
    const cancelled = await runCommandHook(
      { ...baseHook, command },
      input,
      {
        cwd: process.cwd(),
        sessionId: "session-1",
        permissionMode: "manual",
        signal: controller.signal,
      },
    );
    expect(cancelled.cancelled).toBe(true);
  });
});
```

Add explicit cases for exit `2` with stderr, invalid spawn command, stderr overflow, and a payload whose `Buffer.byteLength(JSON.stringify(input))` exceeds 1 MiB.

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
bun run test -- test/hook-command-runner.test.ts
```

Expected: FAIL because the command runner module does not exist.

- [ ] **Step 3: Implement the runner using only Node APIs**

Export:

```ts
export interface CommandHookRunResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
  cancelled: boolean;
  outputExceeded: boolean;
  inputExceeded: boolean;
  durationMs: number;
}

export type CommandHookRunner = (
  hook: ConfiguredCommandHook,
  input: HookInput,
  context: HookInvocationContext,
) => Promise<CommandHookRunResult>;

export const runCommandHook: CommandHookRunner;
```

Implementation rules:

- serialize stdin before spawning and return `inputExceeded: true` without spawning above `1024 * 1024` bytes;
- on POSIX spawn `/bin/sh` with `[-c, hook.command]`, `detached: true`, and kill `-pid` on timeout/cancel/overflow;
- on Windows spawn `process.env.ComSpec ?? "cmd.exe"` with `["/d", "/s", "/c", hook.command]` and kill the child directly;
- use `stdio: ["pipe", "pipe", "pipe"]`, write `${json}\n`, and end stdin;
- count UTF-8 bytes, retain at most `10 * 1024` bytes per output, set `outputExceeded`, and terminate the process when either stream crosses the limit;
- send SIGTERM then SIGKILL after 500 ms on POSIX;
- ensure all timers and abort listeners are removed exactly once;
- if the signal is already aborted, return a cancelled result without spawning.

- [ ] **Step 4: Run the runner tests and static checks**

Run:

```bash
bun run test -- test/hook-command-runner.test.ts
bun run typecheck
bunx biome check src/hooks/command-runner.ts test/hook-command-runner.test.ts
```

Expected: PASS, with no child process left running after the suite.

- [ ] **Step 5: Commit the bounded process runner**

```bash
git add src/hooks/command-runner.ts test/hook-command-runner.test.ts
git commit -m "feat: run command hooks with bounded JSON IO"
```

---

### Task 3: Match, Validate, and Deterministically Merge Hook Results

**Files:**
- Create: `src/hooks/engine.ts`
- Create: `test/hook-engine.test.ts`

**Interfaces:**
- Consumes: configured records from Task 1 and `CommandHookRunner` from Task 2.
- Produces: `HookDiagnosticSink`, `new HookEngine(hooks, events, runner?, diagnostics?)`, and `HookEngine.run(event, payload, context)` for Tasks 5–7.

- [ ] **Step 1: Write failing engine tests with an injected runner**

Create a runner fixture keyed by `hook.command`, with deferred promises to prove commands launch before either finishes. Cover matcher selection, stable aggregate ordering, decision precedence, exit-code behavior, output validation, and redacted events:

```ts
import { describe, expect, it, vi } from "vitest";
import { EventBus, type RuntimeEvent } from "../src/core/events.js";
import { HookEngine } from "../src/hooks/engine.js";
import type { CommandHookRunner } from "../src/hooks/command-runner.js";
import type { ConfiguredCommandHook } from "../src/hooks/types.js";

const result = (stdout = "", exitCode = 0) => ({
  stdout,
  stderr: "",
  exitCode,
  signal: null,
  timedOut: false,
  cancelled: false,
  outputExceeded: false,
  inputExceeded: false,
  durationMs: 2,
});

describe("HookEngine", () => {
  it("merges deny over ask and allow while retaining ordered context", async () => {
    const hooks: ConfiguredCommandHook[] = ["allow", "deny"].map((command, order) => ({
      event: "PreToolUse",
      scope: order === 0 ? "user" : "project",
      order,
      matcherSource: "bash",
      matcher: /bash/,
      command,
      timeoutMs: 10_000,
    }));
    const runner: CommandHookRunner = vi.fn(async (hook) =>
      result(JSON.stringify({
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: hook.command,
          additionalContext: `${hook.command}-context`,
        },
      })),
    );
    const engine = new HookEngine(hooks, new EventBus(), runner);
    const aggregate = await engine.run(
      "PreToolUse",
      { toolName: "bash", callId: "c1", input: { command: "pwd" }, risk: "modify" },
      { cwd: process.cwd(), sessionId: "s1", permissionMode: "manual" },
    );
    expect(aggregate.permissionDecision).toBe("deny");
    expect(aggregate.additionalContext).toEqual(["allow-context", "deny-context"]);
  });

  it("rejects multiple input updates and emits no sensitive values", async () => {
    const events = new EventBus();
    const seen: RuntimeEvent[] = [];
    events.on((event) => seen.push(event));
    const hooks: ConfiguredCommandHook[] = [0, 1].map((order) => ({
      event: "PreToolUse",
      scope: "user",
      order,
      matcherSource: "*",
      command: `update-${order}`,
      timeoutMs: 10_000,
    }));
    const runner: CommandHookRunner = async (_, input) =>
      result(JSON.stringify({
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          updatedInput: { command: `${JSON.stringify(input)}-secret` },
        },
      }));
    const aggregate = await new HookEngine(hooks, events, runner).run(
      "PreToolUse",
      { toolName: "bash", callId: "c1", input: { command: "private-command" }, risk: "modify" },
      { cwd: process.cwd(), sessionId: "s1", permissionMode: "manual" },
    );
    expect(aggregate.inputConflict).toBe(true);
    expect(aggregate.hasUpdatedInput).toBe(false);
    expect(JSON.stringify(seen)).not.toContain("private-command");
    expect(JSON.stringify(seen)).not.toContain("secret");
  });
});
```

Add cases for:

- exact event matcher targets;
- all matching runners being called before deferred completion;
- one `updatedInput` accepted;
- `PermissionRequest` `decision.behavior` parsing;
- `Stop` top-level `decision: "block"`;
- `UserPromptSubmit`, `PreToolUse`, `PermissionRequest`, and `Stop` exit `2` mappings;
- exit `2` on observation events producing a failure warning but no block;
- invalid JSON, wrong `hookEventName`, unsupported fields, timeout, overflow, and nonzero exit failing open;
- parent cancellation propagating instead of failing open;
- aggregate context capped at 10 KiB in stable order.

- [ ] **Step 2: Run the engine test and verify RED**

Run:

```bash
bun run test -- test/hook-engine.test.ts
```

Expected: FAIL because `HookEngine` does not exist.

- [ ] **Step 3: Implement matching, concurrent dispatch, and event-aware protocol parsing**

Create `src/hooks/engine.ts` with this public API:

```ts
export type HookDiagnosticSink = (message: string) => void;

export class HookEngine {
  constructor(
    hooks: ConfiguredCommandHook[],
    events: EventBus,
    runner: CommandHookRunner = runCommandHook,
    diagnostics: HookDiagnosticSink = () => {},
  );

  run<K extends HookEventName>(
    event: K,
    payload: HookPayloadMap[K],
    context: HookInvocationContext,
  ): Promise<HookAggregateResult>;
}
```

Implementation sequence:

1. derive the matcher target from event/payload;
2. filter configured hooks by event and matcher;
3. build the common `HookInput` without copying it into EventBus data;
4. emit `hook.started` with only event, scope, order, and matcher source;
5. dispatch all matching runners with `Promise.all`;
6. if the parent signal is aborted, throw `signal.reason` after children terminate;
7. parse only exit-0 stdout as a single JSON object;
8. map exit `2` only for controllable events;
9. validate allowed output keys for the current event;
10. emit `hook.completed`, `hook.failed`, `hook.blocked`, or `hook.input_conflict` with redacted booleans and timing;
11. sort parsed outcomes by configured `order` before aggregation;
12. send each validated `systemMessage` to the injected diagnostic sink exactly once in stable order, while also returning it in `HookAggregateResult.systemMessages`; callers must not print the returned copy again.

Use a restrictive-rank map:

```ts
const PERMISSION_RANK = { allow: 1, ask: 2, deny: 3 } as const;
```

For multiple updates, emit one conflict event and return `inputConflict: true`, `hasUpdatedInput: false`. Strip VT sequences and C0/C1 controls from every `systemMessage`, reason, and stderr-derived block reason. Fold every reason to one whitespace-normalized line and cap it at 500 Unicode code points; preserve ordinary newlines in `systemMessage` but cap each message at 2,000 Unicode code points. Do not emit those strings in EventBus data.

- [ ] **Step 4: Run engine and regression tests**

Run:

```bash
bun run test -- test/hook-engine.test.ts test/context-session.test.ts
bun run typecheck
bunx biome check src/hooks/engine.ts test/hook-engine.test.ts
```

Expected: PASS; event assertions prove no secret payload duplication.

- [ ] **Step 5: Commit the HookEngine**

```bash
git add src/hooks/engine.ts test/hook-engine.test.ts
git commit -m "feat: merge lifecycle hook decisions deterministically"
```

---

### Task 4: Unify Project Hook and Plugin Workspace Trust

**Files:**
- Modify: `src/tools/plugin-loader.ts`
- Modify: `src/cli/agent-command.ts`
- Modify: `src/cli/index.ts`
- Modify: `test/plugin-terminal.test.ts`
- Modify: `test/runtime.integration.test.ts`
- Modify: `test/cli.test.ts`

**Interfaces:**
- Consumes: `CodeNConfig.hooks` and each Hook record's `scope` from Task 1.
- Produces: a trusted Hook subset for HookEngine construction and one shared `ensureWorkspaceTrust()` path for local plugins, npm plugins, and project hooks.

- [ ] **Step 1: Add RED tests that `--auto` cannot bypass project executable trust**

Update plugin and CLI tests to assert:

```ts
it("does not let auto mode bypass project plugin trust", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "coden-plugin-"));
  const directory = path.join(root, "plugins");
  await mkdir(directory);
  await writeFile(
    path.join(directory, "hello.ts"),
    `export default { name: "hello", description: "hello", risk: "read", inputSchema: { type: "object" }, async execute() { return { content: "ok" }; } };\n`,
  );
  const loader = new PluginLoader(builtinTools(), new EventBus(), async () => false);
  const loaded = await loader.load([{ path: directory, project: true }]);
  expect(loaded.loaded).toEqual([]);
});
```

Add exported-helper tests around `ensureWorkspaceTrust()` proving:

- a trusted real workspace does not ask again;
- an affirmative answer persists the workspace realpath;
- refusal returns false and does not write trust;
- `--auto` is not an argument and cannot affect the result;
- project hooks are filtered out after refusal while user hooks remain;
- project npm plugins are unavailable rather than loaded after refusal.

Update `test/cli.test.ts` to expect the `--auto` help description to mention tool permission only, not project-plugin confirmations.

- [ ] **Step 2: Run focused tests and verify RED**

Run:

```bash
bun run test -- test/plugin-terminal.test.ts test/runtime.integration.test.ts test/cli.test.ts
```

Expected: FAIL because `PluginLoader` still accepts `auto` and startup still treats `options.auto` as project trust.

- [ ] **Step 3: Remove the plugin loader auto bypass**

Change the constructor to:

```ts
constructor(
  private readonly builtins: ToolDefinition[],
  private readonly events: EventBus,
  private readonly trust?: ProjectTrust,
  private readonly importer: PluginImporter = PluginLoader.defaultImporter,
) {}
```

For every `target.project`, require `trust?.(trustPath) === true`; otherwise emit `plugin.unavailable` and skip it. Update all call sites and tests to the new argument order. Tests that intentionally load project fixtures without trust must inject `async () => true`.

- [ ] **Step 4: Centralize workspace trust in CLI startup**

Export the existing callback type and the trust helper from `src/cli/agent-command.ts`:

```ts
export type Question = (message: string, signal?: AbortSignal) => Promise<string>;

export async function ensureWorkspaceTrust(
  trustStore: TrustStore,
  workspace: string,
  ask: Question,
  reason: "hooks" | "plugins" | "hooks-and-plugins",
): Promise<boolean>;
```

Remove the later private duplicate `Question` alias.

The helper must:

- canonicalize `workspace` with `realpath` through `TrustStore.isWorkspaceTrusted()`;
- use one warning saying project hooks/plugins run with full user permissions and can access files, network, and environment secrets;
- persist only after affirmative `yesNo` input;
- return false on refusal or EOF.

During `runAgentCommand`:

1. inspect `config.hooks` for project records;
2. resolve trust without consulting `options.auto`:

   ```ts
   let projectTrusted = await trustStore.isWorkspaceTrusted(workspace);
   if (!projectTrusted && config.hooks.some((hook) => hook.scope === "project")) {
     projectTrusted = await ensureWorkspaceTrust(trustStore, workspace, ask, "hooks");
   }
   ```

3. derive and retain the active set explicitly:

   ```ts
   const activeHooks = projectTrusted
     ? config.hooks
     : config.hooks.filter((hook) => hook.scope === "user");
   const hooks = new HookEngine(activeHooks, events);
   ```

4. make local project plugin trust callbacks check/trust the workspace, not treat `--auto` as trusted;
5. remove `options.auto ||` from project npm plugin loading;
6. if a project npm manifest exists and the workspace is untrusted, use the same helper before loading it;
7. keep global plugins and user hooks active after refusal.

Change CLI option text to:

```ts
.option("--auto", "skip tool permission confirmations", false)
```

- [ ] **Step 5: Run trust and full regression tests**

Run:

```bash
bun run test -- test/plugin-terminal.test.ts test/runtime.integration.test.ts test/cli.test.ts test/plugins/plugin-command.test.ts
bun run typecheck
bunx biome check src/tools/plugin-loader.ts src/cli/agent-command.ts src/cli/index.ts test/plugin-terminal.test.ts test/runtime.integration.test.ts test/cli.test.ts
```

Expected: PASS; no mode can load untrusted project code.

- [ ] **Step 6: Commit the unified trust boundary**

```bash
git add src/tools/plugin-loader.ts src/cli/agent-command.ts src/cli/index.ts test/plugin-terminal.test.ts test/runtime.integration.test.ts test/cli.test.ts
git commit -m "fix: require workspace trust for project extensions"
```

---

### Task 5: Integrate PreToolUse, PermissionRequest, Notification, and PostTool Hooks

**Files:**
- Modify: `src/permissions/policy.ts`
- Modify: `src/tools/executor.ts`
- Modify: `src/cli/agent-command.ts`
- Modify: `test/tools.test.ts`
- Modify: `test/runtime.integration.test.ts`
- Create: `test/tool-hooks.test.ts`

**Interfaces:**
- Consumes: `HookEngine.run()` from Task 3 and trusted engine composition from Task 4.
- Produces: `PermissionPolicy.assess()`, `PermissionPolicy.requestHuman()`, and `ToolExecutionOutcome` for Task 6.

- [ ] **Step 1: Write RED permission-policy tests for separated assessment and human prompting**

In `test/tools.test.ts`, replace direct assumptions that `authorize()` owns the entire flow with explicit assessment tests:

```ts
it("separates deterministic risk assessment from the human decision", async () => {
  const prompt = vi.fn(async () => "allow_session" as const);
  const policy = new PermissionPolicy(false, prompt);
  const tool = builtinTools().find((item) => item.name === "bash");
  if (!tool) throw new Error("bash fixture missing");
  const call = { callId: "b1", name: "bash", input: { command: "echo ok" } };

  expect(policy.assess(tool, call)).toEqual({ risk: "modify", outcome: "prompt" });
  await expect(policy.requestHuman(tool, call, "modify")).resolves.toBe(true);
  expect(policy.assess(tool, call)).toEqual({ risk: "modify", outcome: "allow" });
});
```

Cover read, auto, session allow, dangerous Bash overriding session allow, and missing prompt returning false.

- [ ] **Step 2: Write RED end-to-end tool Hook tests**

Create `test/tool-hooks.test.ts` with a fake HookEngine runner and real `ToolRegistry`/`ToolExecutor`. Cover this exact matrix:

- invalid original input never invokes `PreToolUse`;
- a single valid update becomes the actual executed input;
- an updated invalid Schema produces `hook.invalid_updated_input` and no execution;
- an updated structured path is resolved again and cannot escape the workspace;
- `PreToolUse deny` blocks in manual and auto modes;
- `PreToolUse ask` prompts in manual mode and returns an error in auto mode;
- `PreToolUse allow` bypasses ordinary human prompting but not hard workspace denial;
- `PermissionRequest allow`, deny, ask, and no-decision behavior;
- `Notification(permission_prompt)` occurs immediately before the human prompt;
- exactly one of `PostToolUse` and `PostToolUseFailure` runs for every non-cancelled call that passed tool lookup;
- Hook failures fail open while parent cancellation stops new Hook dispatch and propagates;
- Post events receive the final effective input and bounded result.

Use an ordered log assertion:

```ts
expect(order).toEqual([
  "PreToolUse",
  "PermissionRequest",
  "Notification:permission_prompt",
  "human-prompt",
  "tool-execute",
  "PostToolUse",
]);
```

- [ ] **Step 3: Run focused tests and verify RED**

Run:

```bash
bun run test -- test/tools.test.ts test/tool-hooks.test.ts test/runtime.integration.test.ts
```

Expected: FAIL because PermissionPolicy has no assessment seam and ToolExecutor has no HookEngine.

- [ ] **Step 4: Split permission assessment from the human prompt**

In `src/permissions/policy.ts`, export:

```ts
export interface PermissionAssessment {
  risk: ToolRisk;
  outcome: "allow" | "prompt";
}

export class PermissionPolicy {
  get isAuto(): boolean;
  get mode(): "manual" | "auto";
  classifyRisk(tool: ToolDefinition, call: ToolCall, riskOverride?: ToolRisk): ToolRisk;
  assess(tool: ToolDefinition, call: ToolCall, riskOverride?: ToolRisk): PermissionAssessment;
  requestHuman(
    tool: ToolDefinition,
    call: ToolCall,
    risk: ToolRisk,
    signal?: AbortSignal,
  ): Promise<boolean>;
}
```

`requestHuman()` must preserve existing `allow_once`, non-dangerous `allow_session`, and deny behavior. `assess()` must never perform I/O. Remove or stop using the old all-in-one `authorize()` method so every human prompt passes through the Hook-aware executor path.

- [ ] **Step 5: Return an internal tool execution outcome**

In `src/tools/executor.ts`, export:

```ts
export interface ToolExecutionOutcome {
  result: ToolResult;
  effectiveCall: ToolCall;
  inputChanged: boolean;
  additionalContext: string[];
}
```

Extend the constructor after existing arguments with optional Hook dependencies:

```ts
constructor(
  registry: ToolRegistry,
  permissions: PermissionPolicy,
  events: EventBus,
  workspace: string,
  timeoutMs = 60_000,
  allowOutsideWorkspace = false,
  hooks?: HookEngine,
  hookContext?: Omit<HookInvocationContext, "turnId" | "signal">,
)
```

Implement one private failure finalizer that emits `tool.completed`, runs `PostToolUseFailure`, and returns a `ToolExecutionOutcome`. Use it for PreTool denial, invalid updated input, hard workspace rejection, permission denial, timeout, and tool exceptions. If the parent signal is aborted, terminate active Hook children, emit the existing cancellation completion state, skip starting a new Post Hook, and preserve cancellation. Initial unknown-tool and invalid-original-input failures do not invoke `PreToolUse`, but must still invoke `PostToolUseFailure` when a HookEngine exists.

After a unique update, create a new `effectiveCall`; never mutate the model's original object inside ToolExecutor. Re-run registry validation, structured path resolution, `PermissionPolicy.classifyRisk()`, and every hard boundary using this call.

For permission:

- hard workspace denials execute before any Hook allow can take effect;
- `PreToolUse deny` returns failure;
- `PreToolUse ask` in auto returns `permission.hook_requires_interaction`;
- `PreToolUse allow` skips `assess().outcome === "prompt"`;
- otherwise assess policy;
- when prompting, run `PermissionRequest` with reason `"hook"` or `"policy"`;
- Hook deny fails, Hook allow succeeds, and ask/no decision runs `Notification` then `requestHuman()`;
- emit existing `permission.requested` exactly once with the final allowed boolean and risk.

On success, run the tool, truncate existing output, emit `tool.completed`, then run `PostToolUse`. Return all accepted PreTool `additionalContext` in the outcome.

- [ ] **Step 6: Compose tool Hook context in the CLI**

When constructing `ToolExecutor`, pass the trusted `HookEngine` and:

```ts
{
  cwd: workspace,
  sessionId: session.sessionId,
  permissionMode: options.auto ? "auto" : "manual",
}
```

Keep the human prompt formatter unchanged. The executor, not the terminal formatter, owns the Notification ordering.

- [ ] **Step 7: Run tool lifecycle tests and static checks**

Run:

```bash
bun run test -- test/tools.test.ts test/tool-hooks.test.ts test/runtime.integration.test.ts test/format.test.ts
bun run typecheck
bunx biome check src/permissions/policy.ts src/tools/executor.ts src/cli/agent-command.ts test/tools.test.ts test/tool-hooks.test.ts test/runtime.integration.test.ts
```

Expected: PASS, including path revalidation and auto-mode rejection tests.

- [ ] **Step 8: Commit the tool lifecycle integration**

```bash
git add src/permissions/policy.ts src/tools/executor.ts src/cli/agent-command.ts test/tools.test.ts test/tool-hooks.test.ts test/runtime.integration.test.ts
git commit -m "feat: run hooks around tool permissions and execution"
```

---

### Task 6: Integrate Session, Prompt, Stop, Context Persistence, and SessionEnd Hooks

**Files:**
- Modify: `src/core/types.ts`
- Modify: `src/core/runtime.ts`
- Modify: `src/sessions/store.ts`
- Modify: `src/cli/format.ts`
- Modify: `src/cli/agent-command.ts`
- Modify: `test/context-session.test.ts`
- Modify: `test/runtime.integration.test.ts`
- Modify: `test/cli.test.ts`
- Create: `test/runtime-hooks.test.ts`

**Interfaces:**
- Consumes: `ToolExecutionOutcome` from Task 5 and `HookEngine.run()` from Task 3.
- Produces: all nine lifecycle events, recoverable effective calls, hidden Hook context messages, and best-effort SessionEnd behavior.

- [ ] **Step 1: Add RED session persistence tests for Hook context and updated tool calls**

Extend `UserMessage` expectations with an optional source marker:

```ts
const hookContext = {
  role: "user" as const,
  source: "hook" as const,
  content: "[CodeN hook context: UserPromptSubmit]\nUse just test.",
};
```

In `test/context-session.test.ts`, verify:

- Hook-source messages survive recovery;
- session titles ignore Hook-source messages;
- resume transcript rendering excludes Hook-source messages;
- `appendToolCallUpdate("call-1", input)` patches the matching prior assistant call on recovery;
- an update for an unknown call ID is rejected as an invalid session record;
- crash repair uses the updated call but still adds a missing tool result.

- [ ] **Step 2: Add RED runtime lifecycle tests**

Create `test/runtime-hooks.test.ts` using `ScriptedProvider`, fake Hook runner outputs, and a real SessionStore. Cover:

1. `SessionStart` receives `startup` or `resume` once and its context reaches the system request;
2. blocked `UserPromptSubmit` creates no session, title, user message, or provider request;
3. allowed prompt context is sent after the real user message but hidden from resume transcript;
4. effective updated tool input is visible to the next provider request and survives recovery;
5. PreTool additional context is appended after the complete tool-call/result group;
6. Stop allow completes the turn normally;
7. Stop block appends a Hook-source feedback message and requests the model again with `stopHookActive: true`;
8. repeated Stop block reaches `runtime.step_limit` rather than looping forever;
9. runtime failure emits `Notification(attention_required)` unless the parent signal is cancelled;
10. SessionEnd receives completed, failed, cancelled, eof, and quit reasons without changing an existing failure.

Use an explicit sequence assertion for Stop:

```ts
expect(provider.requests[1]?.messages.at(-1)).toMatchObject({
  role: "user",
  source: "hook",
  content: expect.stringContaining("tests are missing"),
});
expect(stopPayloads.map((payload) => payload.stopHookActive)).toEqual([false, true]);
```

- [ ] **Step 3: Run focused tests and verify RED**

Run:

```bash
bun run test -- test/context-session.test.ts test/runtime-hooks.test.ts test/runtime.integration.test.ts test/cli.test.ts
```

Expected: FAIL because runtime/session types cannot represent or recover the required Hook state.

- [ ] **Step 4: Represent Hook context without impersonating the user**

Change `UserMessage` in `src/core/types.ts` to:

```ts
export interface UserMessage {
  role: "user";
  content: string;
  source?: "hook";
}
```

Add a runtime helper that produces bounded, marked context:

```ts
function hookContextMessage(event: HookEventName, content: string): UserMessage {
  return {
    role: "user",
    source: "hook",
    content: `[CodeN hook context: ${event}]\n${content}`,
  };
}
```

Providers continue mapping Hook-source messages as user-role model context. In `src/cli/format.ts`, only render user messages whose `source !== "hook"`. Update SessionStore `isMessage()` so `source` is accepted only when absent or exactly `"hook"`. In title fallback, never use Hook-source messages as a title; keep them in the message count because they are persisted model-context messages.

- [ ] **Step 5: Persist and recover Hook-modified tool calls**

Add:

```ts
appendToolCallUpdate(callId: string, input: unknown): Promise<void> {
  return this.append("tool.call.updated", { callId, input });
}
```

During recovery, find the latest preceding assistant call with that ID, replace its `input`, and reject missing/duplicate targets. Process the update record before crash repair. This keeps the original assistant message append crash-safe while making resumed model history reflect actual execution.

- [ ] **Step 6: Add HookEngine lifecycle methods to AgentRuntime**

Extend `AgentRuntime` constructor after `initialMessages` with optional Hook dependencies:

```ts
hooks?: HookEngine,
hookContext?: Omit<HookInvocationContext, "turnId" | "signal">,
```

Add:

```ts
async start(source: "startup" | "resume", signal?: AbortSignal): Promise<void>;
```

`start()` runs once, invokes `SessionStart`, joins accepted context in configuration order, and adds this exact marked system message when context is non-empty:

```ts
{
  role: "system",
  content: `[CodeN hook context: SessionStart]\n${result.additionalContext.join("\n\n")}`,
}
```

For a new inactive session, retain it in memory until the first accepted prompt; for a resumed active session, append it immediately. Update first-run persistence to write every leading system message rather than only `messages[0]`.

At the beginning of `run()`:

1. generate `turnId`;
2. invoke `UserPromptSubmit` before `sessions.create()` and `turn.started`;
3. on block, return a zero-usage `TurnResult` without persisting or calling the provider;
4. persist the genuine user text and set title from only that text;
5. append accepted Hook context as Hook-source messages.

When consuming `ToolExecutionOutcome`:

- replace the matching in-memory assistant call with `effectiveCall`;
- append `tool.call.updated` before the result when `inputChanged` is true;
- append result messages in existing order;
- collect PreTool context and append it only after all results for that assistant message.

Before normal final completion, invoke `Stop`. On block, append the marked Hook feedback and continue the loop. Set `stopHookActive` true on subsequent Stop invocations caused by a prior block.

In the runtime catch path, invoke `Notification(attention_required)` before `turn.failed` only when the parent signal is not aborted.

- [ ] **Step 7: Wire SessionStart and best-effort SessionEnd in CLI control flow**

After Runtime construction, call:

```ts
await runtime.start(typeof options.resume === "string" ? "resume" : "startup");
```

Change `runTurn()` to return `"completed" | "cancelled"`, and change `repl()` to return `"eof" | "quit"`. Track the final reason in `runAgentCommand`; in its outer `finally`, invoke `SessionEnd` before disposing the renderer and flushing trace. If the main operation already failed, catch SessionEnd Hook failures and preserve the original error/exit code.

Do not create a new session file only because SessionStart or SessionEnd ran; preserve the existing empty-REPL behavior.

- [ ] **Step 8: Run lifecycle tests and full static checks**

Run:

```bash
bun run test -- test/context-session.test.ts test/runtime-hooks.test.ts test/runtime.integration.test.ts test/cli.test.ts test/providers.test.ts
bun run typecheck
bunx biome check src/core/types.ts src/core/runtime.ts src/sessions/store.ts src/cli/format.ts src/cli/agent-command.ts test/context-session.test.ts test/runtime-hooks.test.ts test/runtime.integration.test.ts test/cli.test.ts
```

Expected: PASS, including resume, Stop-loop, cancellation, and empty-session behavior.

- [ ] **Step 9: Commit the Agent Runtime lifecycle**

```bash
git add src/core/types.ts src/core/runtime.ts src/sessions/store.ts src/cli/format.ts src/cli/agent-command.ts test/context-session.test.ts test/runtime-hooks.test.ts test/runtime.integration.test.ts test/cli.test.ts
git commit -m "feat: add session and turn lifecycle hooks"
```

---

### Task 7: Add Hook Diagnostics, Documentation, and Final Acceptance

**Files:**
- Modify: `src/observability/terminal.ts`
- Modify: `src/cli/agent-command.ts`
- Modify: `README.md`
- Modify: `test/plugin-terminal.test.ts`
- Modify: `test/context-session.test.ts`
- Create: `test/hook-terminal.test.ts`

**Interfaces:**
- Consumes: redacted `hook.*` events and the non-EventBus `HookDiagnosticSink` from Task 3.
- Produces: safe terminal diagnostics, documented public behavior, and release validation evidence.

- [ ] **Step 1: Write RED terminal and trace privacy tests**

Create `test/hook-terminal.test.ts` with TTY/non-TTY sinks. Emit redacted Hook events and assert:

- `hook.completed` is hidden by default and visible in verbose mode;
- `hook.failed`, `hook.blocked`, and `hook.input_conflict` are always visible;
- Hook labels include event, scope, and stable order but no command text;
- terminal control characters in diagnostics are stripped;
- print mode writes diagnostics only to stderr;
- system messages delivered through `HookDiagnosticSink` are displayed once and are not emitted into EventBus.

Extend the trace test to execute a fake Hook containing sentinel prompt, command, output, stderr, context, and updated input values, flush trace, and assert none of the sentinels occur in the trace file.

- [ ] **Step 2: Run focused tests and verify RED**

Run:

```bash
bun run test -- test/hook-terminal.test.ts test/context-session.test.ts test/plugin-terminal.test.ts
```

Expected: FAIL because TerminalRenderer does not render Hook lifecycle diagnostics.

- [ ] **Step 3: Render safe Hook diagnostics**

In `src/observability/terminal.ts`:

- show `hook completed: <event> <scope>#<order> (<duration>ms)` only under `verbose`;
- always show concise failed, blocked, and conflict lines;
- pass every label and reason through `sanitizeTerminalText()` and display-width truncation;
- never expect command text, Hook output, tool input, or context in event data.

Because trace must not receive `systemMessage`, pass a direct diagnostic sink when CLI constructs the engine:

```ts
const hooks = new HookEngine(
  activeHooks,
  events,
  undefined,
  (message) => process.stderr.write(`[coden] ${sanitizeTerminalText(message)}\n`),
);
```

The engine invokes this sink exactly once per validated `systemMessage` after restoring configuration order. Runtime and ToolExecutor must not print `HookAggregateResult.systemMessages` again. This path bypasses EventBus and therefore cannot enter the JSONL trace.

- [ ] **Step 4: Document configuration, protocol, security, and macOS examples**

Update `README.md` with:

1. the nine-event table and matcher targets;
2. user/project config locations and append ordering;
3. stdin common fields and event-specific payload summary;
4. exit-code and JSON-output rules;
5. decision precedence and multiple-update conflict behavior;
6. exact `--auto` interactions and shared project-extension trust boundary;
7. explicit warnings that hooks inherit API keys, receive full event data, and are not sandboxed;
8. restart requirement after config changes;
9. troubleshooting with `--verbose`.

Include this macOS notification example:

```json
{
  "hooks": {
    "PermissionRequest": [
      {
        "matcher": "bash|edit|write",
        "hooks": [
          {
            "type": "command",
            "command": "osascript -e 'display notification \"CodeN 正在等待授权\" with title \"CodeN\"'; afplay /System/Library/Sounds/Glass.aiff",
            "timeout": 5
          }
        ]
      }
    ]
  }
}
```

Also include one `PreToolUse` JSON approval script example and one Stop-block example, each reading stdin and writing one JSON object to stdout without interpolating untrusted fields into shell code.

- [ ] **Step 5: Run all focused and full project checks**

Run:

```bash
bun run test -- test/hooks-config.test.ts test/hook-command-runner.test.ts test/hook-engine.test.ts test/tool-hooks.test.ts test/runtime-hooks.test.ts test/hook-terminal.test.ts
just check
just build
git diff --check
```

Expected: all commands PASS. Confirm `dist/index.js` builds without a Bun runtime import and Hook tests use only Node APIs at runtime.

- [ ] **Step 6: Perform manual macOS acceptance when a GUI session is available**

Set a temporary `XDG_CONFIG_HOME` and create its `coden/config.json` with the documented `osascript`/`afplay` command; do not edit the developer's real user config. Start CodeN in manual mode, trigger a Bash approval, and confirm:

1. notification and sound occur before the terminal approval question;
2. rejecting the terminal prompt still returns `permission.denied` to the model;
3. replacing the Hook command with a sleeping command causes a timeout warning after the configured limit and still shows the terminal prompt;
4. a project Hook does not execute until the workspace is explicitly trusted;
5. `coden --auto` does not auto-trust the workspace.

If no macOS GUI session is available, record this manual check as not run; the automated command-runner and ordering tests remain mandatory.

- [ ] **Step 7: Inspect repository state and commit the public feature**

Run:

```bash
git status --short
git diff --stat
git diff --check
```

Ensure no `.coden/config.json`, API key, temporary Hook script, generated trace, or unintended `dist/` artifact is staged. Then commit:

```bash
git add src/observability/terminal.ts src/cli/agent-command.ts README.md test/plugin-terminal.test.ts test/context-session.test.ts test/hook-terminal.test.ts
git commit -m "docs: document lifecycle hooks and diagnostics"
```

- [ ] **Step 8: Final acceptance summary**

Record in the implementation handoff:

- all seven task commits;
- `just check`, `just build`, and `git diff --check` results;
- manual macOS result or explicit not-run reason;
- changed public configuration and protocol;
- residual risks: trusted commands have full user permissions, Windows process-tree termination is best-effort, and Hook configuration requires restart.
