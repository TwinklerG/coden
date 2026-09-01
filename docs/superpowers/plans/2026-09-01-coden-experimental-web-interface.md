# CodeN Experimental Web Interface Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an experimental local Web interface that preserves CodeN's existing Agent behavior while providing streaming chat, tool details, approval, cancellation, single-controller ownership, and idle-only session switching.

**Architecture:** Keep `AgentApplication` and `AgentRuntime` authoritative. A Node `http` server exposes JSON actions and an SSE state stream backed by a serial `WebController` and immutable `WebStore`; a separately built React application consumes the shared protocol. Loopback mode is tokenless but origin/host constrained, while every non-loopback bind requires a process-lifetime token exchanged for an HttpOnly cookie.

**Tech Stack:** TypeScript, Node.js 22 `http`, React 19, Server-Sent Events, Bun build tooling, marked, DOMPurify, Vitest, Testing Library, jsdom, Biome, Just

**Spec:** `docs/superpowers/specs/2026-09-01-coden-experimental-web-interface-design.md`

## Execution Record

Implemented inline on 2026-09-01. At the user’s request, the independent browser package lives at `src/webui/` beside the Node adapter at `src/web/`; it retains its own package and lockfile. The visual implementation follows the restrained purple-black documentation system in `website/src/styles/docs.css`: NJU purple accents, 32px grid, 2px borders, system sans, and monospace operational labels.

Validation evidence:

- `just check`: 490 passed, 2 skipped.
- `just web-check`: 9 passed; browser lint, typecheck, sanitized-Markdown tests, React tests, and production build passed.
- `just website-check`: 83 passed; 54 bilingual documents, 60 built pages, Pagefind, and built-link validation passed.
- `just build` and `node dist/index.js --help`: passed; Web flags are present in the Node artifact.
- Loopback artifact smoke: `/api/health` and packaged `/` returned 200; SIGTERM exited 0.
- Non-loopback artifact smoke: unauthenticated state returned 401, token exchange returned 303, authenticated state returned 200, and terminal emitted the mandatory no-TLS/no-sandbox warning.
- `npm pack --dry-run`: package inventory includes `dist/index.js`, `dist/plugin/index.js`, `dist/plugin/index.d.ts`, and `dist/web/` HTML/JS/CSS assets.

Residual validation note: the complete browser-driven manual scenario with a live paid Provider (streaming a real task, invoking a real tool, approving it, cancelling another turn, refreshing, and taking over from a private window) was not run because no real model request should be issued during repository verification. The same state transitions are covered by Runtime, controller, router, security, reducer, and React tests; loopback and non-loopback published-artifact transport was exercised manually.

## Global Constraints

- `coden --web` is experimental and must not change the default CLI, TUI, or print routing.
- Default bind is `127.0.0.1`; default port is `0`; browser opening defaults on and is disabled by `--no-open`.
- Every non-loopback host, including `0.0.0.0` and `::`, requires a random 32-byte process-lifetime token; no flag may disable it.
- The server owns exactly one `AgentApplication`, one foreground turn, one pending interaction, and one controlling browser client.
- Disconnecting or refreshing a browser never cancels the active turn. Only explicit cancel or process shutdown aborts it.
- New/resume session operations are accepted only while idle and never create background Agents.
- Provider, model, thinking level, approval mode, and language are inherited and read-only in Web UI.
- Model, tool, file, plugin, and Markdown output is untrusted. No raw model HTML, remote CDN, inline script, `eval`, or plugin UI is allowed.
- Node runtime code must not use Bun-only APIs. Bun is allowed only as package manager, command runner, and build tool.
- `website/` remains a static product/documentation site and must not host the Agent runtime UI.
- Follow TDD, keep existing tests green, and commit after every task.

## File Structure

### New server files

- `src/web/protocol.ts`: JSON-safe snapshot, block, patch, viewer, request, response, and runtime validators.
- `src/web/store.ts`: authoritative immutable presentation state and RuntimeEvent projection.
- `src/web/controller.ts`: application lifecycle, ownership, turn serialization, interaction promises, and session switching.
- `src/web/security.ts`: loopback detection, token exchange, cookies, Host/Origin checks, and security headers.
- `src/web/static-assets.ts`: bounded static asset inventory, MIME types, and cache policy.
- `src/web/router.ts`: HTTP route dispatch, JSON limits, API errors, SSE clients, and slow-client handling.
- `src/web/server.ts`: native HTTP server lifecycle and controller/router composition.
- `src/web/browser.ts`: best-effort macOS/Linux/Windows browser opener.
- `src/web/command.ts`: `runWebCommand()` startup, URL reporting, initial prompt, signals, and shutdown.

### New browser package

- `src/webui/package.json`, `src/webui/bun.lock`: isolated browser dependencies and scripts.
- `src/webui/tsconfig.json`, `src/webui/biome.webui.json`, `src/webui/vitest.config.ts`: browser project tooling.
- `src/webui/index.html`: CSP-compatible HTML entry.
- `src/webui/src/main.tsx`: React mount.
- `src/webui/src/api.ts`: state fetch, SSE connection, JSON actions, and reconnection.
- `src/webui/src/state.ts`: revision-checked snapshot/patch reducer.
- `src/webui/src/i18n.ts`: fixed Chinese/English labels selected by snapshot language.
- `src/webui/src/markdown.tsx`: marked + DOMPurify rendering policy.
- `src/webui/src/app.tsx`: application shell and state/action wiring.
- `src/webui/src/components/status-header.tsx`: read-only runtime and connection metadata.
- `src/webui/src/components/session-sidebar.tsx`: session list, new/resume, and narrow-screen drawer.
- `src/webui/src/components/transcript.tsx`: block list, follow behavior, and return-to-latest control.
- `src/webui/src/components/tool-card.tsx`: collapsed summary and expanded input/output.
- `src/webui/src/components/interaction-card.tsx`: permission/trust actions.
- `src/webui/src/components/composer.tsx`: multiline submit/cancel and read-only ownership state.
- `src/webui/src/styles.css`: desktop-first responsive visual system.

### New tests

- `test/web-protocol.test.ts`
- `test/web-store.test.ts`
- `test/web-controller.test.ts`
- `test/web-security.test.ts`
- `test/web-router.test.ts`
- `test/web-command.test.ts`
- `src/webui/test/state.test.ts`
- `src/webui/test/api.test.ts`
- `src/webui/test/markdown.test.tsx`
- `src/webui/test/app.test.tsx`

### Existing files to modify

- `src/core/runtime.ts`, `src/tools/executor.ts`: emit complete interface-neutral tool presentation events.
- `src/cli/agent-command.ts`, `src/cli/interface-mode.ts`, `src/cli/index.ts`: Web options and routing.
- `src/i18n/locales/zh.ts`, `src/i18n/locales/en.ts`: CLI Web labels and warnings.
- `package.json`, `bun.lock`, `justfile`: Web build, package contents, and command runners.
- `README.md`, `README.en.md`: experimental usage and security boundary.
- `website/src/content/docs/{zh,en}/docs/start/overview.mdx`: interface overview.
- `website/src/content/docs/{zh,en}/docs/reference/cli.mdx`: flags and examples.
- `website/src/content/docs/{zh,en}/docs/safety/security-boundaries.mdx`: browser/token limitations.
- `test/cli.test.ts`, `test/interface-mode.test.ts`, `test/i18n.test.ts`, `test/runtime.integration.test.ts`: regression coverage.

---

### Task 1: Define the Web protocol and emit complete tool detail events

**Files:**
- Create: `src/web/protocol.ts`
- Create: `test/web-protocol.test.ts`
- Modify: `src/tools/executor.ts`
- Modify: `src/core/runtime.ts`
- Modify: `test/runtime.integration.test.ts`

**Interfaces:**
- Produces: `WEB_PROTOCOL_VERSION`, `WebSnapshot`, `WebBlock`, `WebPatch`, `WebStreamEnvelope`, `WebStateResponse`, `WebViewer`, `WebApiError`, `parseWebActionBody()`.
- Changes `tool.started` data to include `input` and `risk`.
- Produces a `tool.result` RuntimeEvent after the tool message has been appended to the session.

- [x] **Step 1: Write failing protocol validation tests**

Create `test/web-protocol.test.ts` with concrete valid/invalid request cases:

```ts
import { describe, expect, it } from "vitest";
import { parseWebActionBody, WEB_PROTOCOL_VERSION } from "../src/web/protocol.js";

describe("Web protocol", () => {
  it("accepts a bounded turn request", () => {
    expect(parseWebActionBody("turn", { text: "fix tests" })).toEqual({ text: "fix tests" });
    expect(WEB_PROTOCOL_VERSION).toBe(1);
  });

  it("rejects blank, oversized, and extra turn fields", () => {
    expect(() => parseWebActionBody("turn", { text: "   " })).toThrow("non-empty");
    expect(() => parseWebActionBody("turn", { text: "x".repeat(100_001) })).toThrow("100000");
    expect(() => parseWebActionBody("turn", { text: "ok", extra: true })).toThrow("unknown");
  });

  it("accepts only declared interaction and session decisions", () => {
    expect(parseWebActionBody("interaction", { decision: "allow_once" })).toEqual({
      decision: "allow_once",
    });
    expect(parseWebActionBody("resume", { sessionId: "session-1" })).toEqual({
      sessionId: "session-1",
    });
    expect(() => parseWebActionBody("interaction", { decision: "always" })).toThrow();
    expect(() => parseWebActionBody("resume", { sessionId: "../escape" })).toThrow();
  });
});
```

Define test fixtures for every `WebBlock` variant and assert `JSON.stringify()` contains no `undefined`, `bigint`, provider state, or signature field.

- [x] **Step 2: Run the protocol test and verify RED**

Run: `bun run vitest run test/web-protocol.test.ts`

Expected: FAIL because `src/web/protocol.ts` does not exist.

- [x] **Step 3: Implement the JSON-safe protocol types and validators**

Use explicit discriminated unions and exact-key checks; do not import Node-only modules:

```ts
export const WEB_PROTOCOL_VERSION = 1;
export const MAX_PROMPT_CHARS = 100_000;

export type WebPhase =
  | "starting"
  | "idle"
  | "thinking"
  | "rendering"
  | "tool"
  | "reviewing"
  | "failed";

export type WebBlock =
  | { id: string; kind: "user"; text: string }
  | { id: string; kind: "assistant"; markdown: string }
  | {
      id: string;
      kind: "tool";
      callId: string;
      name: string;
      status: "preparing" | "running" | "succeeded" | "failed" | "cancelled";
      input?: unknown;
      risk?: "read" | "modify" | "dangerous";
      output?: string;
      durationMs?: number;
      summary?: string;
    }
  | {
      id: string;
      kind: "interaction";
      interaction: "permission" | "confirm";
      status: "pending" | "resolved" | "cancelled";
      message?: string;
      toolName?: string;
      risk?: "read" | "modify" | "dangerous";
      input?: unknown;
      allowSession: boolean;
      decision?: string;
    }
  | { id: string; kind: "info" | "error"; text: string };

export type WebPatch =
  | { op: "append_blocks"; blocks: WebBlock[] }
  | { op: "update_block"; id: string; block: WebBlock }
  | {
      op: "merge";
      value: Partial<
        Pick<
          WebSnapshot,
          | "phase"
          | "running"
          | "metadata"
          | "sessionId"
          | "sessions"
          | "pendingInteractionId"
          | "control"
          | "contextPercent"
          | "turnUsage"
          | "startupWarnings"
          | "fatalError"
        >
      >;
    };
```

`WebSnapshot` includes `revision`, `language`, blocks, sessions, metadata, control, pending interaction ID, usage, warnings, and optional fatal error. `WebStreamEnvelope` is either `{ type: "snapshot", revision, data: WebStateResponse }` or `{ type: "patch", revision, data: WebPatch }`. `WebStateResponse` contains `{ protocolVersion, snapshot, viewer }`.

- [x] **Step 4: Write failing tool event tests**

Extend `test/runtime.integration.test.ts` so a scripted provider invokes a tool and capture EventBus events. Assert:

```ts
expect(events.find((event) => event.type === "tool.started")?.data).toMatchObject({
  callId: "call-1",
  name: "read",
  risk: "read",
  input: { path: "README.md" },
});
expect(events.find((event) => event.type === "tool.result")?.data).toMatchObject({
  callId: "call-1",
  name: "read",
  content: expect.any(String),
  isError: false,
});
```

Also assert `tool.result` occurs after the corresponding tool message is present in `runtime.messages` and does not contain `providerState`.

- [x] **Step 5: Run the focused runtime test and verify RED**

Run: `bun run vitest run test/runtime.integration.test.ts -t "tool detail events"`

Expected: FAIL because `tool.started` lacks input/risk and `tool.result` is not emitted.

- [x] **Step 6: Emit final tool input, risk, and result without changing execution semantics**

In `ToolExecutor.execute()`, extend the existing `tool.started` payload only after hooks, validation, path resolution, and permission produce the effective call:

```ts
await this.events.emit(
  "tool.started",
  {
    name: effectiveCall.name,
    callId: effectiveCall.callId,
    summary: display.summary,
    input: effectiveCall.input,
    risk: finalRisk,
  },
  turnId,
);
```

In `AgentRuntime.run()`, after `appendMessage(message)` succeeds, emit:

```ts
await this.events.emit(
  "tool.result",
  {
    callId: result.effectiveCall.callId,
    name: result.effectiveCall.name,
    content: result.content,
    isError: result.isError ?? false,
  },
  turnId,
);
```

Do not emit Provider reasoning state or signatures.

- [x] **Step 7: Verify protocol and runtime tests GREEN**

Run:

```bash
bun run vitest run test/web-protocol.test.ts test/runtime.integration.test.ts test/tools.test.ts test/tool-hooks.test.ts
bun run typecheck
```

Expected: all pass.

- [x] **Step 8: Commit**

```bash
git add src/web/protocol.ts src/tools/executor.ts src/core/runtime.ts test/web-protocol.test.ts test/runtime.integration.test.ts
git commit -m "feat: define Web protocol and tool events"
```

---

### Task 2: Build the authoritative Web presentation store

**Files:**
- Create: `src/web/store.ts`
- Create: `test/web-store.test.ts`

**Interfaces:**
- Consumes: `RuntimeEvent`, recovered `AgentMessage[]`, and protocol types from Task 1.
- Produces: `WebStore`, `WebStore.subscribe()`, `snapshot()`, `setApplication()`, `setRecoveredMessages()`, `applyRuntimeEvent()`, `openPermission()`, `openConfirm()`, `resolveInteraction()`, `cancelInteraction()`, `setOwner()`, and `setSessions()`.
- Every mutation produces exactly one strictly increasing revision and one `WebPatch`; subscribers may request the current full snapshot independently.

- [x] **Step 1: Write failing event-projection and revision tests**

Create `test/web-store.test.ts` using a real `EventBus`:

```ts
const store = new WebStore("zh");
const patches: Array<{ revision: number; patch: WebPatch }> = [];
store.subscribe((revision, patch) => patches.push({ revision, patch }));

await store.connect(events);
await events.emit("turn.started", { input: "fix tests" }, "turn-1");
await events.emit("provider.delta", { text: "first" }, "turn-1");
await events.emit("provider.delta", { text: " second" }, "turn-1");
await events.emit("turn.completed", {
  inputTokens: 10,
  outputTokens: 4,
  durationMs: 25,
  contextTokens: 100,
  tools: 0,
}, "turn-1");

expect(store.snapshot().blocks).toEqual([
  expect.objectContaining({ kind: "user", text: "fix tests" }),
  expect.objectContaining({ kind: "assistant", markdown: "first second" }),
]);
expect(patches.map((entry) => entry.revision)).toEqual([1, 2, 3, 4]);
```

Add separate tests for Provider retry discarding only the active partial assistant, context percentage clamping, plugin warnings, fatal errors, the normal `tool.started → tool.completed → tool.result` sequence, reordered completion/result delivery, and recovered message projection by call ID.

- [x] **Step 2: Write failing interaction settlement tests**

Test exact fail-closed behavior:

```ts
const pending = store.openPermission(tool, call, "dangerous");
expect(store.snapshot().pendingInteractionId).toBeTruthy();
expect(() => store.resolveInteraction(pending.id, "allow_session")).toThrow("dangerous");
store.resolveInteraction(pending.id, "deny");
await expect(pending.promise).resolves.toBe("deny");
expect(() => store.resolveInteraction(pending.id, "deny")).toThrow("no longer pending");
```

Cover confirm true/false, AbortSignal cancellation, store close, only one pending interaction, and resolved interaction blocks remaining in transcript.

- [x] **Step 3: Run store tests and verify RED**

Run: `bun run vitest run test/web-store.test.ts`

Expected: FAIL because `src/web/store.ts` does not exist.

- [x] **Step 4: Implement immutable snapshot commits and block indexing**

Implement one commit primitive and a `Map<blockId, index>` so updates do not scan unrelated state:

```ts
private commit(patch: WebPatch, update: (current: WebSnapshot) => WebSnapshot): void {
  const revision = this.#snapshot.revision + 1;
  this.#snapshot = { ...update(this.#snapshot), revision };
  for (const listener of this.#listeners) listener(revision, patch);
}
```

Use stable IDs based on turn/call IDs where available. Sanitize terminal control characters before storing display strings. Never put system messages, hook-only user messages, provider state, redacted thinking, or signatures into Web blocks.

- [x] **Step 5: Implement RuntimeEvent projection and recovered transcript**

Use the same semantic phases as TUI but do not import `TuiStore`. Merge tool events by `callId`; a `tool.result` supplies output/error and `tool.completed` supplies duration/cancelled status regardless of event order. On Provider retry, remove the current attempt's partial assistant and tool preview without removing prior completed blocks.

Keep reasoning as a transient phase/status only. Do not add full reasoning text to blocks.

- [x] **Step 6: Implement interaction promises and application metadata setters**

`openPermission()` and `openConfirm()` append pending blocks and return `{ id, promise }`. Settlement updates the same block, clears `pendingInteractionId`, removes abort listeners, and resolves exactly once. `close()` resolves permission as `deny` and confirm as `false`.

`setApplication(metadata, sessionId, warnings)` and `setSessions(sessions)` update read-only state; `setRecoveredMessages()` replaces transcript blocks during application switching.

- [x] **Step 7: Verify store tests GREEN**

Run:

```bash
bun run vitest run test/web-store.test.ts test/tui-store.test.ts test/tui-transcript.test.ts
bun run typecheck
bun run biome check --config-path . src/web test/web-store.test.ts
```

Expected: all pass.

- [x] **Step 8: Commit**

```bash
git add src/web/store.ts test/web-store.test.ts
git commit -m "feat: project Agent state for Web clients"
```

---

### Task 3: Implement controller ownership, turns, interactions, and sessions

**Files:**
- Create: `src/web/controller.ts`
- Create: `test/web-controller.test.ts`

**Interfaces:**
- Consumes: `WebStore`, `CreateAgentApplicationOptions`, `AgentCommandOptions`, and an injected application factory.
- Produces: `WebController.bootstrap()`, `connectClient()`, `takeover()`, `submit()`, `cancel()`, `answerInteraction()`, `newSession()`, `resumeSession()`, `shutdown()`, and `dispose()`.
- Produces owner errors with stable codes: `web.not_owner`, `web.busy`, `web.not_ready`, `web.interaction_stale`, `web.invalid_session`.

- [x] **Step 1: Write failing ownership tests with an injected fake application**

Create a fake application whose runtime exposes controllable `run()` and messages. Assert:

```ts
expect(controller.connectClient("client-a")).toEqual({ clientId: "client-a", isOwner: true });
expect(controller.connectClient("client-b")).toEqual({ clientId: "client-b", isOwner: false });
await expect(controller.submit("client-b", "task")).rejects.toMatchObject({ code: "web.not_owner" });
controller.takeover("client-b");
await controller.submit("client-b", "task");
await expect(controller.submit("client-a", "second")).rejects.toMatchObject({ code: "web.not_owner" });
```

Disconnect client B and assert an unresolved fake `run()` is not aborted. Reconnect B with the same client ID and assert it remains owner.

- [x] **Step 2: Write failing lifecycle and session-switch tests**

Cover:

- server/store exists before factory creation, allowing startup confirm to remain pending;
- initial resume ID is passed to the first factory call;
- only one run starts; a second submit returns `web.busy`;
- cancel requires owner and aborts exactly once;
- new/resume while running returns `web.busy` and does not call factory;
- idle switch disposes old app before creating the new one;
- failed new app creation produces failed state and never reuses disposed old app;
- shutdown aborts run, denies interaction, calls `end("cancelled")`, and disposes once.

- [x] **Step 3: Run controller tests and verify RED**

Run: `bun run vitest run test/web-controller.test.ts`

Expected: FAIL because `src/web/controller.ts` does not exist.

- [x] **Step 4: Implement ownership and serial turn execution**

Define a small stable error class:

```ts
export class WebControllerError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: 400 | 403 | 409 | 500,
  ) {
    super(message);
  }
}
```

`connectClient()` assigns owner only when no owner exists. `takeover()` atomically calls `store.setOwner(clientId)`. Every mutation calls `requireOwner(clientId)` immediately before changing state. `submit()` trims only for emptiness but passes the original text to `runtime.run()`.

Keep `#activeController` and `#activeTurn`; do not await browser connection state. Cancellation aborts the controller but does not dispose the application.

- [x] **Step 5: Adapt permissions and project confirmations to WebStore promises**

Pass this interaction port to the application factory:

```ts
interaction: {
  permission: (tool, call, risk, signal) =>
    this.#store.openPermission(tool, call, risk, signal).promise,
  confirm: (message, signal) => this.#store.openConfirm(message, signal).promise,
},
```

`answerInteraction(clientId, id, decision)` checks owner, exact pending ID, interaction kind, and dangerous-risk session allowance before settling.

- [x] **Step 6: Implement idle-only application replacement**

Centralize first bootstrap, new session, and resume in `replaceApplication(resumeId?: string)`. Disconnect the old EventBus subscription, end/dispose the old app, reset application-specific store fields, clone the original command with `resume: resumeId`, and create the replacement. After success, import metadata/recovered messages/warnings and refresh `session.list()`.

Do not mutate Provider/model/thinking/approval options. If creation fails, set a sanitized fatal error and retain no old app reference.

- [x] **Step 7: Verify controller and existing application tests GREEN**

Run:

```bash
bun run vitest run test/web-controller.test.ts test/runtime.integration.test.ts test/tui-controller.test.ts
bun run typecheck
```

Expected: all pass.

- [x] **Step 8: Commit**

```bash
git add src/web/controller.ts test/web-controller.test.ts
git commit -m "feat: control Web Agent lifecycle"
```

---

### Task 4: Implement loopback and remote-bind security policy

**Files:**
- Create: `src/web/security.ts`
- Create: `test/web-security.test.ts`

**Interfaces:**
- Produces: `isLoopbackHost()`, `createAccessToken()`, `WebSecurityPolicy`, `ensureAllowedHost()`, `ensureAuthenticated()`, `ensureMutationOrigin()`, `exchangeQueryToken()`, `setClientCookie()`, and `securityHeaders()`.
- Consumes: Node `IncomingMessage`, configured bind host, actual port, and enumerated interface addresses.

- [x] **Step 1: Write failing loopback and token tests**

Cover exact host classifications:

```ts
expect(isLoopbackHost("127.0.0.1")).toBe(true);
expect(isLoopbackHost("127.99.2.3")).toBe(true);
expect(isLoopbackHost("::1")).toBe(true);
expect(isLoopbackHost("localhost")).toBe(true);
expect(isLoopbackHost("0.0.0.0")).toBe(false);
expect(isLoopbackHost("::")).toBe(false);
expect(isLoopbackHost("192.168.1.10")).toBe(false);
```

Assert a remote policy creates a 64-character lowercase hex token, a loopback policy has no access token, and token comparison rejects altered length/value without throwing.

- [x] **Step 2: Write failing request-policy tests**

Build minimal fake `IncomingMessage` values and assert:

- loopback GET/static succeeds without auth;
- loopback mutation requires exact `Origin: http://127.0.0.1:<port>`;
- missing or foreign mutation Origin is rejected;
- no CORS allow-origin header is emitted;
- remote static/state/SSE/API without access cookie returns 401;
- valid `/?token=...` yields a 303 target `/` and `HttpOnly; SameSite=Strict; Path=/` cookie;
- token and client cookies are separate;
- allowed Host includes bound loopback or enumerated local IP plus exact port and rejects attacker domains;
- security headers include CSP, no-referrer, nosniff, frame deny, and no-store for API.

- [x] **Step 3: Run security tests and verify RED**

Run: `bun run vitest run test/web-security.test.ts`

Expected: FAIL because `src/web/security.ts` does not exist.

- [x] **Step 4: Implement host normalization and constant-time token checks**

Use `node:net` for IP detection and `timingSafeEqual` only after equal-length Buffer checks:

```ts
export function secureTokenEqual(expected: string, supplied: string): boolean {
  const left = Buffer.from(expected, "utf8");
  const right = Buffer.from(supplied, "utf8");
  return left.length === right.length && timingSafeEqual(left, right);
}
```

Normalize bracketed IPv6 and lower-case DNS names. In wildcard mode, allow loopback aliases and IP literals returned by `networkInterfaces()`; reject arbitrary domain Host headers. Require the actual listening port in Host and Origin.

- [x] **Step 5: Implement cookie/token exchange and response headers**

Use `randomBytes(32).toString("hex")`. Access cookies are process-lifetime, HttpOnly, SameSite=Strict, Path=/, and omit Secure because the built-in server is HTTP. Client identity cookies use a separate random value and the same restrictions.

Strip token from the redirect target. Never include it in an error message, store snapshot, trace event, or request log.

- [x] **Step 6: Verify security tests GREEN**

Run:

```bash
bun run vitest run test/web-security.test.ts
bun run typecheck
bun run biome check --config-path . src/web/security.ts test/web-security.test.ts
```

Expected: all pass.

- [x] **Step 7: Commit**

```bash
git add src/web/security.ts test/web-security.test.ts
git commit -m "feat: secure local and remote Web access"
```

---

### Task 5: Build the static asset server, JSON router, and SSE transport

**Files:**
- Create: `src/web/static-assets.ts`
- Create: `src/web/router.ts`
- Create: `src/web/server.ts`
- Create: `test/web-router.test.ts`

**Interfaces:**
- Consumes: `WebController`, `WebStore`, `WebSecurityPolicy`, and a static asset root.
- Produces: `loadStaticAssets(root)`, `createWebRouter(options)`, and `startWebServer(options): Promise<WebServerHandle>`.
- `WebServerHandle` exposes `origin`, `port`, `accessUrl`, `close()`, and the composed controller.

- [x] **Step 1: Write failing static asset inventory tests**

Create a temporary directory with `index.html`, hashed JS/CSS, a nested asset, a symlink, and a file outside the root. Assert `loadStaticAssets()`:

- inventories only regular files under the root;
- maps `/` to `index.html`;
- never follows the symlink;
- assigns HTML no-store and hashed JS/CSS immutable caching;
- returns correct MIME types;
- rejects encoded traversal and unknown paths.

- [x] **Step 2: Write failing HTTP and SSE integration tests**

Start a real server on `127.0.0.1:0` with a fake controller/store. Use Node `fetch()` and an HTTP stream parser to assert:

```ts
const state = await fetch(`${handle.origin}/api/state`, { headers: { Cookie: clientCookie } });
expect(state.status).toBe(200);
expect(await state.json()).toMatchObject({ protocolVersion: 1 });

const turn = await fetch(`${handle.origin}/api/turn`, {
  method: "POST",
  headers: {
    Cookie: clientCookie,
    Origin: handle.origin,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({ text: "fix tests" }),
});
expect(turn.status).toBe(202);
```

Cover every route, owner 403, busy 409, bad JSON 400, wrong content type 400, body over 1 MiB 413, unknown route 404, no stack in 500 response, SSE initial snapshot, ordered patch IDs, heartbeat, disconnect cleanup, and absent CORS headers.

- [x] **Step 3: Run router tests and verify RED**

Run: `bun run vitest run test/web-router.test.ts`

Expected: FAIL because router/server modules do not exist.

- [x] **Step 4: Implement bounded static asset loading**

At startup, recursively inventory regular files with `lstat()` and store exact URL-to-file mappings. Serve only entries in that map. Never concatenate request paths into filesystem paths during a request. Use streaming `createReadStream()` and handle HEAD without a body.

- [x] **Step 5: Implement JSON routing and stable error mapping**

Use one `readJsonBody(request, 1_048_576)` helper that counts raw bytes, aborts on overflow, requires `application/json`, and passes parsed values through `parseWebActionBody()`. Return `{ error: { code, message, retryable } }` for all API failures.

Route control actions to exact controller methods. Return 202 for accepted turn/cancel, 204 for accepted interaction/takeover/session action, and 200 for reads.

- [x] **Step 6: Implement SSE clients with bounded queues**

On `/api/events`, authenticate, assign/read client cookie, call `controller.connectClient(clientId)`, then send a `snapshot` envelope with contextual viewer. Subscribe to store patches and write `id: <revision>`, `event: state`, and JSON `data` lines.

Each client has a bounded pending-byte count of 1 MiB. If `response.write()` backpressures, queue only up to the bound; exceeding it destroys that response so the browser reconnects from a fresh snapshot. Send comment heartbeat every 15 seconds. Remove listeners/timers on close.

- [x] **Step 7: Compose and close the native Node server**

`startWebServer()` creates `http.createServer(router)`, listens, derives actual origin/port, finalizes security policy, and returns an idempotent `close()` that stops accepting connections, closes SSE clients, shuts down the controller, and closes idle/all HTTP connections.

- [x] **Step 8: Verify router tests GREEN**

Run:

```bash
bun run vitest run test/web-router.test.ts test/web-security.test.ts test/web-controller.test.ts
bun run typecheck
```

Expected: all pass with no leaked handles reported by Vitest.

- [x] **Step 9: Commit**

```bash
git add src/web/static-assets.ts src/web/router.ts src/web/server.ts test/web-router.test.ts
git commit -m "feat: serve Web API and SSE state"
```

---

### Task 6: Add CLI Web routing, browser opening, and process lifecycle

**Files:**
- Create: `src/web/browser.ts`
- Create: `src/web/command.ts`
- Create: `test/web-command.test.ts`
- Modify: `src/cli/agent-command.ts`
- Modify: `src/cli/interface-mode.ts`
- Modify: `src/cli/index.ts`
- Modify: `src/i18n/locales/zh.ts`
- Modify: `src/i18n/locales/en.ts`
- Modify: `test/interface-mode.test.ts`
- Modify: `test/cli.test.ts`
- Modify: `test/i18n.test.ts`

**Interfaces:**
- Produces: Web option fields on `AgentCommandOptions`: `web`, `webHost`, `webPort`, and `open`.
- Extends `AgentInterfaceMode` with `"web"`.
- Produces: `openBrowser(url, platform?)` and `runWebCommand(initialPrompt, command, i18n)`.

- [x] **Step 1: Write failing mode and option tests**

Extend `test/interface-mode.test.ts`:

```ts
expect(resolveInterfaceMode({ tui: false, cli: false, print: false, web: true }, tty)).toEqual({
  mode: "web",
});
expect(() => resolveInterfaceMode({ tui: true, cli: false, print: false, web: true }, tty)).toThrow();
expect(() => resolveInterfaceMode({ tui: false, cli: false, print: true, web: true }, tty)).toThrow();
```

Extend `test/cli.test.ts` to assert help includes all four Web flags, default options become `127.0.0.1`, `0`, and open=true, non-Web use of host/port/no-open exits 2, invalid ports exit 1 during Commander parsing, and bare `--resume` still lists sessions without a Provider key.

- [x] **Step 2: Run focused CLI tests and verify RED**

Run: `bun run vitest run test/interface-mode.test.ts test/cli.test.ts test/i18n.test.ts`

Expected: FAIL because Web flags and labels are absent.

- [x] **Step 3: Add deterministic Web option parsing and routing**

Add Commander options:

```ts
.option("--web", m.web, false)
.option("--web-host <host>", m.webHost, "127.0.0.1")
.option("--web-port <port>", m.webPort, parsePort, 0)
.option("--no-open", m.noOpen)
```

Commander stores `--no-open` as `open: false`. `parsePort()` accepts integers from 0 through 65535. Track whether host/port/no-open were explicitly supplied so default values do not falsely trigger the “requires --web” error; use Commander option value sources or a pure exported validation helper covered by tests.

Resolve bare resume before interface startup exactly as today. Web mode does not require a TTY.

- [x] **Step 4: Write failing browser opener and command lifecycle tests**

In `test/web-command.test.ts`, inject spawn and server factories. Assert platform commands are:

- macOS: `open <url>`;
- Linux: `xdg-open <url>`;
- Windows: `cmd /c start "" <url>` with `shell: false`.

Assert browser failure only writes a warning. Assert command startup prints actual URL, includes a token warning for non-loopback, auto-submits initial prompt once after bootstrap, `--no-open` never spawns, and two signals still close once.

- [x] **Step 5: Run command tests and verify RED**

Run: `bun run vitest run test/web-command.test.ts`

Expected: FAIL because browser/command modules do not exist.

- [x] **Step 6: Implement safe browser opening and Web command orchestration**

Use `spawn()` argument arrays with `shell: false`, detached child, ignored stdio, and `unref()`. Do not interpolate URL into a shell string.

`runWebCommand()` resolves `dist/web` relative to the built entry with a development override, starts the server before bootstrapping the Agent, prints the actual access URL, opens it if enabled, awaits controller bootstrap/initial prompt, and then remains alive until a termination signal or server failure. Register and remove signal listeners exactly once.

For wildcard binds, auto-open a loopback URL containing the token; print a second remote URL template and the no-TLS warning.

- [x] **Step 7: Add localized operational copy**

Add equivalent zh/en keys for the experimental flag, host, port, no-open, started URL, browser-open failure, remote token requirement, no-TLS warning, and Web option conflicts. Keep copy concise and explicit that tools retain current user permissions.

- [x] **Step 8: Verify CLI and command tests GREEN**

Run:

```bash
bun run vitest run test/interface-mode.test.ts test/cli.test.ts test/i18n.test.ts test/web-command.test.ts
bun run typecheck
```

Expected: all pass; existing TUI/CLI mode tests remain unchanged except for the new mode field.

- [x] **Step 9: Commit**

```bash
git add src/web/browser.ts src/web/command.ts src/cli/agent-command.ts src/cli/interface-mode.ts src/cli/index.ts src/i18n test/interface-mode.test.ts test/cli.test.ts test/i18n.test.ts test/web-command.test.ts
git commit -m "feat: launch experimental Web interface"
```

---

### Task 7: Create the browser package, state reducer, transport, and safe Markdown

**Files:**
- Create: `src/webui/package.json`
- Create: `src/webui/bun.lock`
- Create: `src/webui/tsconfig.json`
- Create: `src/webui/biome.webui.json`
- Create: `src/webui/vitest.config.ts`
- Create: `src/webui/index.html`
- Create: `src/webui/src/main.tsx`
- Create: `src/webui/src/api.ts`
- Create: `src/webui/src/state.ts`
- Create: `src/webui/src/i18n.ts`
- Create: `src/webui/src/markdown.tsx`
- Create: `src/webui/test/state.test.ts`
- Create: `src/webui/test/api.test.ts`
- Create: `src/webui/test/markdown.test.tsx`

**Interfaces:**
- Consumes type-only protocol exports from `../src/web/protocol.ts`.
- Produces: `applyEnvelope()`, `CodeNWebApi`, `connectStateStream()`, `messagesFor(language)`, and `MarkdownContent`.
- Browser build outputs only self-hosted files under `dist/web/`.

- [x] **Step 1: Scaffold the isolated package and install exact dependency families**

Create scripts:

```json
{
  "scripts": {
    "build": "rm -rf ../../dist/web && bun build ./index.html --target=browser --outdir=../../dist/web --minify",
    "build:watch": "bun build ./index.html --target=browser --outdir=../../dist/web --watch",
    "typecheck": "tsc --noEmit",
    "lint": "biome check --config-path . .",
    "test": "vitest run",
    "check": "bun run lint && bun run typecheck && bun run test && bun run build"
  }
}
```

Run inside `src/webui/`:

```bash
bun add react@^19.2.0 react-dom@^19.2.0 marked@^18.0.11 dompurify@^3.2.6
bun add -d typescript@^5.9.2 @types/react@^19.2.0 @types/react-dom@^19.2.0 @biomejs/biome@^2.5.10 vitest@^4.1.0 jsdom@^27.0.0 @testing-library/react@^16.3.0 @testing-library/jest-dom@^6.9.1 @testing-library/user-event@^14.6.1
```

Use `index.html` as the Bun browser entry so generated JS/CSS names are rewritten automatically. Include only an external module entry and stylesheet; do not add inline scripts.

- [x] **Step 2: Write failing reducer tests**

In `src/webui/test/state.test.ts`, assert snapshot initialization, ordered patch application, append/update/merge behavior, stale duplicate ignore, and gap detection:

```ts
const first = applyEnvelope(undefined, snapshotEnvelope);
expect(first.snapshot.revision).toBe(4);
expect(() => applyEnvelope(first, { ...patchEnvelope, revision: 6 })).toThrow("revision gap");
expect(applyEnvelope(first, { ...patchEnvelope, revision: 4 })).toBe(first);
```

Assert update of a missing block throws and does not silently invent state.

- [x] **Step 3: Write failing API/reconnect tests**

Mock `fetch` and `EventSource`. Assert all actions use same-origin URLs, JSON content type, exact bodies, and parse `WebApiError`. On stream error, close the source, fetch `/api/state`, and reconnect with capped exponential delays of 250ms, 500ms, 1s, 2s, then 5s. A revision gap triggers immediate state refetch without replaying an action.

- [x] **Step 4: Write failing Markdown security tests**

Assert model content containing `<script>`, `<img onerror>`, `javascript:` links, iframe, inline style, and event attributes does not survive. Assert fenced code, tables, lists, safe `https:` links, and plain raw HTML text render correctly. External links must have `target="_blank"` and `rel="noreferrer noopener"`.

- [x] **Step 5: Run browser tests and verify RED**

Run: `cd src/webui && bun run test`

Expected: FAIL because state, API, and Markdown modules do not exist.

- [x] **Step 6: Implement revision-safe reducer and transport**

`applyEnvelope()` replaces state on snapshot. Patch revision must equal `current.revision + 1`; lower/equal revisions return the existing object; higher gaps throw a typed `WebRevisionGapError`.

`CodeNWebApi` exposes `takeover`, `submit`, `cancel`, `answerInteraction`, `newSession`, and `resumeSession`. `connectStateStream()` owns one EventSource, one retry timer, and an AbortController for state refetch; `dispose()` closes all three.

- [x] **Step 7: Implement bilingual labels and sanitized Markdown**

Provide complete zh/en dictionaries for connection, ownership, session, phase, tool, approval, input, cancel, retry, and error labels. Select only by `snapshot.language`; do not inspect browser locale.

Configure marked with raw model HTML escaped or removed, then sanitize with an explicit DOMPurify allowlist. Render sanitized output with `dangerouslySetInnerHTML` only inside `MarkdownContent`; no other component may use it.

- [x] **Step 8: Verify browser foundations GREEN and build output exists**

Run:

```bash
cd src/webui
bun run check
find ../dist/web -maxdepth 2 -type f -print
```

Expected: tests/typecheck/lint pass; output contains one HTML entry and self-hosted JS/CSS assets with no `http://` or `https://` script/style imports.

- [x] **Step 9: Commit**

```bash
git add webui
git commit -m "feat: add Web client transport foundation"
```

---

### Task 8: Implement the desktop-first React Agent interface

**Files:**
- Create: `src/webui/src/app.tsx`
- Create: `src/webui/src/components/status-header.tsx`
- Create: `src/webui/src/components/session-sidebar.tsx`
- Create: `src/webui/src/components/transcript.tsx`
- Create: `src/webui/src/components/tool-card.tsx`
- Create: `src/webui/src/components/interaction-card.tsx`
- Create: `src/webui/src/components/composer.tsx`
- Create: `src/webui/src/styles.css`
- Create: `src/webui/test/app.test.tsx`
- Modify: `src/webui/src/main.tsx`

**Interfaces:**
- Consumes: `CodeNWebApi`, stream connection, `WebStateResponse`, protocol blocks, Markdown renderer, and i18n labels.
- Produces: complete `App` with no business-state duplication outside reducer state and local UI-only state.

- [x] **Step 1: Write failing application behavior tests**

Use Testing Library with a fake API and snapshots. Cover:

- starting, connected, reconnecting, and fatal states;
- provider/model/approval/thinking/workspace/context rendered read-only;
- first owner has active composer; non-owner sees read-only and takeover;
- Enter submits, Shift+Enter inserts newline, blank input does not submit;
- running state disables session switches and shows cancel;
- session click resumes only while idle; new session calls exact action;
- permission card supports allow once/session/deny, with session option absent for dangerous risk;
- confirm supports confirm/reject;
- resolved interactions remain visible but disabled;
- tool details start collapsed and reveal JSON input/text output;
- failed tool and API errors are visible in the transcript, not toast-only;
- narrow viewport opens/closes a labelled session drawer.

- [x] **Step 2: Write failing transcript follow tests**

Mock scroll metrics. Assert appended deltas follow only when the user is within 32px of bottom; scrolling upward pauses follow and shows “return to latest”; clicking it scrolls to bottom. Updating an existing streaming assistant must not reset user scroll when follow is paused.

- [x] **Step 3: Run application tests and verify RED**

Run: `cd src/webui && bun run vitest run test/app.test.tsx`

Expected: FAIL because UI components do not exist.

- [x] **Step 4: Implement the application shell and ownership wiring**

`App` subscribes once to `connectStateStream()`, stores only reducer state plus connection status, and delegates actions to `CodeNWebApi`. Derive `isOwner` from contextual viewer client ID and `snapshot.control.ownerClientId`; never trust a client-side owner boolean for server authorization.

Keep pending button state local per request, clear it on response/snapshot settlement, and render stable API errors inline.

- [x] **Step 5: Implement focused transcript and action components**

Use semantic elements:

- `<aside aria-label>` for sessions;
- `<main>` and an `aria-live="polite"` activity label, not the entire high-frequency transcript;
- `<article>` per user/assistant block;
- `<details>` for tool cards;
- real `<button>` controls for approvals, takeover, cancel, and sessions;
- labelled `<textarea>` for composer.

Pretty-print tool input with `JSON.stringify(input, null, 2)` inside `<pre>` and output as text. Do not use HTML injection for tool data.

- [x] **Step 6: Implement the intentional desktop-first visual system**

Use CSS custom properties with a quiet code-workbench direction:

```css
:root {
  color-scheme: light dark;
  --bg: #0f1115;
  --surface: #171a21;
  --line: #2a2f3a;
  --text: #e6e9ef;
  --muted: #9299a8;
  --accent: #8b7cf6;
  --success: #6fcf97;
  --warning: #e5b567;
  --danger: #ef6b73;
}
```

Use system UI for controls and a system monospace stack for code/tool metadata. Avoid gradients, marketing Hero elements, decorative card grids, and remote fonts. Keep one narrow session rail, one transcript column, restrained borders, and clear focus rings.

At `max-width: 760px`, move the sidebar into an overlay drawer while keeping transcript/composer/approval usable. Respect `prefers-reduced-motion` and disable smooth scrolling/animations there.

- [x] **Step 7: Verify UI tests, accessibility basics, and production build GREEN**

Run:

```bash
cd src/webui
bun run test
bun run typecheck
bun run lint
bun run build
```

Expected: all pass. Inspect built HTML to confirm it has one root, no inline script, and references only self-hosted assets.

- [x] **Step 8: Commit**

```bash
git add src/webui/src src/webui/test/app.test.tsx
git commit -m "feat: build experimental Web Agent UI"
```

---

### Task 9: Integrate packaging, Just commands, source development, and installed artifacts

**Files:**
- Create: `src/webui/scripts/dev.mjs`
- Modify: `package.json`
- Modify: `bun.lock`
- Modify: `justfile`
- Modify: `test/web-command.test.ts`
- Modify: `.github/workflows/ci.yml`
- Modify: `.github/workflows/release.yml`

**Interfaces:**
- `just web-dev` builds once, starts browser build watch, and runs source `coden --web` with clean child shutdown.
- `just web-check` installs from the frozen `src/webui/bun.lock` and runs its complete check.
- `just build` always emits `dist/index.js`, plugin artifacts, and `dist/web/`.

- [x] **Step 1: Write failing built-asset resolution and package assertions**

Extend `test/web-command.test.ts` to assert:

- source execution finds `dist/web` after a Web build;
- built `dist/index.js` resolves sibling `dist/web` independent of cwd;
- `CODEN_WEB_ASSETS_DIR` is accepted only by the internal test/development resolver and does not appear as a public CLI flag;
- missing assets produce a `ConfigError` only in Web mode.

Add a package script test or shell assertion that `npm pack --dry-run --json` lists `dist/web/index.html` plus JS/CSS, and still lists existing plugin artifacts.

- [x] **Step 2: Run packaging assertions and verify RED**

Run:

```bash
bun run vitest run test/web-command.test.ts
just build
npm pack --dry-run --json
```

Expected: focused tests or package listing fail because build/package scripts do not include Web assets.

- [x] **Step 3: Update root build and package contents**

Change root scripts so build order is:

```text
rm dist → mkdir dist/plugin → webui build → CLI bundle → plugin bundle/types → shebang normalization
```

Add `dist/web` to `package.json.files`. Do not add `src/webui/node_modules`, source files, tests, or development config to the npm package.

- [x] **Step 4: Add Just and development orchestration**

`src/webui/scripts/dev.mjs` uses only `node:child_process` and signal handling. It runs a one-shot Web build, starts `bun run build:watch`, starts root `bun run src/cli/index.ts --web`, forwards additional arguments, and terminates both children on SIGINT/SIGTERM or either child failure.

Add:

```make
web-dev *args:
  node src/webui/scripts/dev.mjs {{args}}

web-check:
  cd src/webui && bun install --frozen-lockfile && bun run check
```

Keep `just check` focused on the root package; CI runs both `just check` and `just web-check` explicitly.

- [x] **Step 5: Update CI and release artifact checks**

In CI, run `just web-check` before `just build`, then execute a Node 22 no-browser Web smoke using a temporary config/workspace and poll `/api/health`. In release, verify `dist/web/index.html` exists before npm publish and run `npm pack --dry-run`.

The smoke must start with `--web --no-open --web-port 0`, parse the printed URL, fetch health, send SIGTERM, and assert exit 0 without sending a model request.

- [x] **Step 6: Verify package and installed artifact behavior GREEN**

Run:

```bash
just web-check
just build
node dist/index.js --help
npm pack --dry-run --json > /tmp/coden-pack.json
python3 - <<'PY'
import json
files={item['path'] for item in json.load(open('/tmp/coden-pack.json'))[0]['files']}
assert 'dist/web/index.html' in files
assert 'dist/index.js' in files
assert 'dist/plugin/index.js' in files
PY
```

Then install the produced tarball into a temporary directory and start its Node CLI in `--web --no-open` mode. Expected: health and `/` return 200 without access to repository `src/`.

- [x] **Step 7: Commit**

```bash
git add src/webui/scripts/dev.mjs package.json bun.lock justfile test/web-command.test.ts .github/workflows/ci.yml .github/workflows/release.yml
git commit -m "build: package experimental Web assets"
```

---

### Task 10: Document the experimental contract and complete acceptance coverage

**Files:**
- Modify: `README.md`
- Modify: `README.en.md`
- Modify: `website/src/content/docs/zh/docs/start/overview.mdx`
- Modify: `website/src/content/docs/en/docs/start/overview.mdx`
- Modify: `website/src/content/docs/zh/docs/reference/cli.mdx`
- Modify: `website/src/content/docs/en/docs/reference/cli.mdx`
- Modify: `website/src/content/docs/zh/docs/safety/security-boundaries.mdx`
- Modify: `website/src/content/docs/en/docs/safety/security-boundaries.mdx`
- Modify: `website/test/docs-content.test.ts`
- Modify: `docs/superpowers/plans/2026-09-01-coden-experimental-web-interface.md`

**Interfaces:**
- Consumes the completed feature.
- Produces bilingual user-facing contract and final automated/manual evidence.

- [x] **Step 1: Add failing documentation drift assertions**

Extend `website/test/docs-content.test.ts` and root tests to assert both languages include:

- `coden --web` and `--no-open`;
- default `127.0.0.1` behavior;
- non-loopback mandatory temporary token;
- token does not provide TLS or sandboxing;
- Web Provider/model/thinking are read-only;
- CLI/TUI/print behavior remains available.

Keep bilingual code blocks byte-identical, including comments, as required by existing website content tests.

- [x] **Step 2: Run documentation tests and verify RED**

Run:

```bash
cd website && bun run vitest run test/docs-content.test.ts
cd .. && bun run vitest run test/cli.test.ts test/i18n.test.ts
```

Expected: FAIL because Web documentation is absent.

- [x] **Step 3: Update README and website documentation**

Add concise examples:

```bash
coden --web
coden --web --no-open
coden --web --web-host 0.0.0.0
coden --web --resume <session-id>
```

State explicitly:

- experimental, local single-workspace UI;
- default browser opening and random port;
- one controller, read-only extra tabs, explicit takeover;
- idle-only session switching;
- remote token is temporary access control, not encryption;
- tools/Hooks/plugins execute with current user permissions;
- prefer SSH tunnel or trusted proxy over direct untrusted-network exposure.

Do not describe Web as a hosted service or sandbox.

- [x] **Step 4: Run complete automated acceptance**

Run:

```bash
just check
just web-check
just website-check
just build
node dist/index.js --help
npm pack --dry-run

git diff --check
```

Expected: all checks pass. Root suite includes Web protocol/store/controller/security/router/command tests; browser suite includes reducer/API/Markdown/UI tests; website suite preserves bilingual links and code parity.

- [ ] **Step 5: Run loopback and non-loopback manual smoke**

Loopback:

1. Start `coden --web --no-open` in a disposable workspace with a harmless test Provider configuration.
2. Open printed URL and verify no token is requested.
3. Submit a task, observe streaming assistant/tool blocks, expand tool details, answer one approval, and cancel one running task.
4. Refresh during a running task and verify it continues without duplicate execution.
5. Open a second private window, verify read-only state, take over, and verify the old window becomes read-only.
6. Verify new/resume controls are disabled during a turn and work while idle.

Non-loopback:

1. Start `coden --web --web-host 0.0.0.0 --no-open`.
2. Verify the terminal prints a token URL and no-TLS warning.
3. Verify `/api/state` without the auth cookie returns 401.
4. Visit the token URL, verify redirect removes the query token, then verify UI access.
5. Verify a POST with a foreign Origin returns 403.

Record results in the final response; do not commit credentials, tokens, traces, or screenshots containing source.

- [x] **Step 6: Update plan execution record and commit documentation**

After implementation, add an `Execution Record` below this plan header containing actual command results, test counts, artifact smoke outcome, and any accepted residual risk. Mark only completed checkboxes as `[x]`.

```bash
git add README.md README.en.md website/src/content/docs website/test/docs-content.test.ts docs/superpowers/plans/2026-09-01-coden-experimental-web-interface.md
git commit -m "docs: publish experimental Web interface guidance"
```

- [x] **Step 7: Final repository integrity check**

Run:

```bash
git status --short
git log --oneline -12
git diff --check HEAD~1
```

Expected: clean working tree, no staged files, design and implementation plan commits present, and all feature commits visible.
