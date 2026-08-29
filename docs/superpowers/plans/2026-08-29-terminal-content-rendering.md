# Terminal Content Rendering Implementation Plan

<!-- markdownlint-disable MD013 -->

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render common Markdown cleanly in interactive assistant output and display structured, bounded inputs for every built-in or third-party tool while preserving raw non-TTY output.

**Architecture:** Add pure terminal-text and schema-aware tool-input formatters, then reuse them in permission prompts, tool lifecycle events, and `TerminalRenderer`. Add a line-buffered Markdown stream renderer backed by `marked`; `TerminalRenderer` uses it only for TTY responses and leaves the existing retry-safe non-TTY buffer unchanged.

**Tech Stack:** TypeScript 5.9, Node.js streams/readline/util, marked 18, picocolors, Vitest 3, Bun, Biome, Just

**Spec:** `docs/superpowers/specs/2026-08-29-terminal-content-rendering-design.md`

## Global Constraints

- Do not use Bun-specific APIs; Bun remains only the JS/TS toolchain.
- Use Biome for TypeScript linting and formatting.
- Interactive TTY output supports headings, emphasis, inline code, lists, quotes, links, and fenced code blocks; source-code syntax highlighting is out of scope.
- Buffer incomplete Markdown lines and fenced blocks; clear uncommitted state on retry, failure, and disposal.
- `--print`, `NO_COLOR`, CI, redirected output, and explicit non-TTY rendering keep raw assistant Markdown and existing generic tool statuses.
- Format all tools generically from their JSON Schema and runtime input; do not branch on `read`, `write`, `edit`, `bash`, or third-party tool names.
- Tool displays are bounded to 20 lines, 2,000 characters per value, and four nested levels, with explicit omission markers.
- Add only a bounded summary to `tool.started`; do not copy complete tool input into lifecycle events.
- Strip unsafe terminal controls from TTY assistant text and tool displays without changing persisted model messages or tool inputs.
- Permission and tool execution semantics must remain unchanged.

## File Structure

- Create `src/observability/terminal-text.ts` for control-character removal, display-width measurement, and width-aware truncation.
- Create `src/observability/tool-input.ts` for schema-aware, bounded, generic tool input formatting and one-line summaries.
- Create `src/observability/markdown.ts` for line/fence buffering, `marked` token rendering, and stream lifecycle state.
- Modify `src/cli/format.ts` to build a structured permission question from generic tool display data.
- Modify `src/cli/agent-command.ts` to use the structured permission question.
- Modify `src/tools/executor.ts` to add only a bounded invocation summary to `tool.started`.
- Modify `src/observability/terminal.ts` to render Markdown and concise TTY tool lifecycle lines while preserving non-TTY behavior.
- Modify `package.json` and `bun.lock` to add `marked`.
- Create `test/tool-input-display.test.ts` for generic nested inputs, limits, schema order, controls, and circular-reference defense.
- Create `test/markdown-terminal.test.ts` for supported Markdown, streaming boundaries, fences, fallback, controls, and cleanup.
- Modify `test/format.test.ts`, `test/runtime.integration.test.ts`, and `test/plugin-terminal.test.ts` for permission, event, and terminal integration coverage.

---

### Task 1: Build safe generic tool input formatting

**Files:**

- Create: `src/observability/terminal-text.ts`
- Create: `src/observability/tool-input.ts`
- Create: `test/tool-input-display.test.ts`

**Interfaces:**

- Produces: `sanitizeTerminalText(text: string): string`.
- Produces: `displayWidth(text: string): number` and `truncateDisplay(text: string, maxColumns: number, mode?: "head" | "tail"): string`.
- Produces: `ToolDisplayRequest = { name: string; risk: ToolRisk; inputSchema: JsonSchema; input: unknown }`.
- Produces: `ToolInputDisplay = { lines: string[]; summary: string }`.
- Produces: `formatToolInput(request: ToolDisplayRequest, limits?: Partial<ToolDisplayLimits>): ToolInputDisplay`.
- Default limits: `{ maxLines: 20, maxValueChars: 2_000, maxDepth: 4, maxSummaryColumns: 120 }`.

- [ ] **Step 1: Write failing tests for schema order, nested values, and real newlines**

Create `test/tool-input-display.test.ts` with:

```ts
import { describe, expect, it } from "vitest";
import { formatToolInput } from "../src/observability/tool-input.js";
import { sanitizeTerminalText, truncateDisplay } from "../src/observability/terminal-text.js";

const request = (input: unknown, inputSchema: Record<string, unknown> = { type: "object" }) => ({
  name: "third_party_tool",
  risk: "modify" as const,
  inputSchema,
  input,
});

describe("tool input display", () => {
  it("uses schema property order and renders multiline strings as real lines", () => {
    const result = formatToolInput(
      request(
        {
          content: "line 1\nline 2",
          path: "src/a.ts",
          target: { environment: "production", regions: ["ap-east-1", "eu-west-1"] },
        },
        {
          type: "object",
          properties: {
            path: { type: "string" },
            content: { type: "string" },
            target: {
              type: "object",
              properties: {
                environment: { type: "string" },
                regions: { type: "array", items: { type: "string" } },
              },
            },
          },
        },
      ),
    );

    expect(result.lines).toEqual([
      "path: src/a.ts",
      "content:",
      "  line 1",
      "  line 2",
      "target:",
      "  environment: production",
      "  regions:",
      "    - ap-east-1",
      "    - eu-west-1",
    ]);
    expect(result.lines.join("\n")).not.toContain("\\n");
    expect(result.summary).toContain("path: src/a.ts");
  });

  it("renders arrays, null, booleans, and empty collections without JSON noise", () => {
    const result = formatToolInput(
      request({ values: [1, null, true, { key: "value" }], empty: [], none: {} }),
    );
    expect(result.lines).toContain("values:");
    expect(result.lines).toContain("  - 1");
    expect(result.lines).toContain("  - null");
    expect(result.lines).toContain("  - true");
    expect(result.lines).toContain("empty: []");
    expect(result.lines).toContain("none: {}");
  });
});
```

- [ ] **Step 2: Add failing tests for bounds, cycles, and terminal controls**

Append:

```ts
it("bounds value size, depth, total lines, and circular references", () => {
  const circular: Record<string, unknown> = { text: "x".repeat(30), deep: { a: { b: { c: 1 } } } };
  circular.self = circular;
  const result = formatToolInput(request(circular), {
    maxLines: 6,
    maxValueChars: 10,
    maxDepth: 2,
    maxSummaryColumns: 18,
  });

  expect(result.lines.length).toBeLessThanOrEqual(6);
  expect(result.lines.join("\n")).toContain("omitted");
  expect(result.lines.join("\n")).toMatch(/\[max depth\]|\[circular\]/);
  expect(result.summary.length).toBeLessThanOrEqual(18);
});

it("removes terminal controls and truncates wide text by display columns", () => {
  expect(sanitizeTerminalText("safe\u001b[31mred\u001b[0m\u0007\nnext")).toBe("safered\nnext");
  expect(truncateDisplay("ab中文cd", 7)).toBe("ab中文…");
  expect(truncateDisplay("abcdef", 4, "tail")).toBe("…def");
});
```

- [ ] **Step 3: Run the new test and verify it fails**

Run:

```bash
bun run test -- test/tool-input-display.test.ts
```

Expected: FAIL because both observability modules are missing.

- [ ] **Step 4: Implement terminal-safe text primitives**

Create `src/observability/terminal-text.ts`. Use Node's `stripVTControlCharacters` before removing remaining C0/C1 controls, preserving newline and tab:

```ts
import { stripVTControlCharacters } from "node:util";

export function sanitizeTerminalText(text: string): string {
  return stripVTControlCharacters(text).replace(
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g,
    "",
  );
}

export function characterWidth(character: string): number {
  const point = character.codePointAt(0) ?? 0;
  return point <= 0xff ? 1 : 2;
}

export function displayWidth(text: string): number {
  return Array.from(text).reduce((sum, character) => sum + characterWidth(character), 0);
}

export function truncateDisplay(
  text: string,
  maxColumns: number,
  mode: "head" | "tail" = "head",
): string {
  if (maxColumns <= 0) return "";
  if (displayWidth(text) <= maxColumns) return text;
  if (maxColumns === 1) return "…";
  const source = Array.from(text);
  const kept: string[] = [];
  let used = 1;
  const indexes =
    mode === "head"
      ? source.map((_, index) => index)
      : source.map((_, index) => source.length - index - 1);
  for (const index of indexes) {
    const character = source[index];
    if (character === undefined || used + characterWidth(character) > maxColumns) break;
    if (mode === "head") kept.push(character);
    else kept.unshift(character);
    used += characterWidth(character);
  }
  return mode === "head" ? `${kept.join("")}…` : `…${kept.join("")}`;
}
```

The width rule intentionally matches the existing renderer's simple project convention; do not add another Unicode-width dependency in this change.

- [ ] **Step 5: Implement the generic schema-aware formatter**

Create `src/observability/tool-input.ts` with the public interfaces from this task. Implement one recursive walker with these exact rules:

1. Sanitize every string before display.
2. For object properties, visit keys found in `schema.properties` first, then remaining own enumerable keys in insertion order.
3. Pass each child property schema and `items` schema to recursion when they are record values.
4. Render short scalar fields as `key: value`; render multiline strings as `key:` followed by two-space-indented physical lines.
5. Render arrays beneath `key:` with `- ` prefixes; indent nested object members beneath their list item.
6. Render empty arrays and objects as `[]` and `{}`; render `null` literally.
7. Truncate each sanitized string to `maxValueChars`, append `… [N characters omitted]`, and then split into lines.
8. At `maxDepth`, emit `[max depth]`; when a non-null object is already in a `WeakSet<object>`, emit `[circular]`.
9. Stop at `maxLines`; reserve the final line for `... [N or more lines omitted]` when content remains.
10. Build `summary` from the first scalar reachable at the top level as `key: value`; use the first physical line for multiline values, fall back to `name`, sanitize it, and call `truncateDisplay(..., maxSummaryColumns)`.

Use these exact exported declarations:

```ts
import type { JsonSchema, ToolRisk } from "../core/types.js";
import { sanitizeTerminalText, truncateDisplay } from "./terminal-text.js";

export interface ToolDisplayRequest {
  name: string;
  risk: ToolRisk;
  inputSchema: JsonSchema;
  input: unknown;
}

export interface ToolDisplayLimits {
  maxLines: number;
  maxValueChars: number;
  maxDepth: number;
  maxSummaryColumns: number;
}

export interface ToolInputDisplay {
  lines: string[];
  summary: string;
}

const DEFAULT_LIMITS: ToolDisplayLimits = {
  maxLines: 20,
  maxValueChars: 2_000,
  maxDepth: 4,
  maxSummaryColumns: 120,
};

export function formatToolInput(
  request: ToolDisplayRequest,
  limits: Partial<ToolDisplayLimits> = {},
): ToolInputDisplay;
```

Implement this signature with the ten rules above. Keep traversal helpers private to the module. Do not expose formatter failure to callers: wrap traversal in `try/catch` and return `{ lines: ["[unavailable]"], summary: request.name }` after sanitizing and truncating the fallback name.

- [ ] **Step 6: Format and run the formatter tests**

Run:

```bash
bun run format
bun run test -- test/tool-input-display.test.ts
```

Expected: PASS. Multiline strings contain physical newlines only after `lines.join("\n")`, schema order is stable, and every configured bound is respected.

- [ ] **Step 7: Commit the generic formatter**

```bash
git add src/observability/terminal-text.ts src/observability/tool-input.ts test/tool-input-display.test.ts
git commit -m "feat: format tool inputs for terminals"
```

---

### Task 2: Use structured tool displays in permission and lifecycle output

**Files:**

- Modify: `src/cli/format.ts`
- Modify: `src/cli/agent-command.ts:412-432`
- Modify: `src/tools/executor.ts:19-45`
- Modify: `src/observability/terminal.ts:78-86,205-232`
- Modify: `test/format.test.ts`
- Modify: `test/runtime.integration.test.ts`
- Modify: `test/plugin-terminal.test.ts`

**Interfaces:**

- Consumes: `formatToolInput()` from Task 1.
- Produces: `formatPermissionQuestion(tool: ToolDefinition, call: ToolCall, risk: ToolRisk): string`.
- Extends: `tool.started` event data with bounded `summary: string` only.
- Preserves: non-TTY lifecycle strings such as `[coden] tool read completed (2ms)`.

- [ ] **Step 1: Add a failing permission-question formatting test**

Append to `test/format.test.ts` and add the required type/import declarations:

```ts
import { formatPermissionQuestion } from "../src/cli/format.js";
import type { ToolDefinition } from "../src/core/types.js";

it("formats generic multiline tool permission questions", () => {
  const tool: ToolDefinition = {
    name: "third_party_write",
    description: "writes content",
    risk: "modify",
    inputSchema: {
      type: "object",
      properties: { path: { type: "string" }, content: { type: "string" } },
    },
    async execute() {
      return { content: "ok" };
    },
  };
  const question = formatPermissionQuestion(
    tool,
    {
      callId: "call-1",
      name: tool.name,
      input: { path: "a.txt", content: "line 1\nline 2" },
    },
    "modify",
  );

  expect(question).toContain("MODIFY  third_party_write");
  expect(question).toContain("  path: a.txt");
  expect(question).toContain("  content:\n    line 1\n    line 2");
  expect(question).toContain("Allow? [y]es / [s]ession / [N]o: ");
  expect(question).not.toContain("\\n");
});

it("does not offer session permission for dangerous tools", () => {
  const tool = {
    name: "deploy",
    description: "deploy",
    risk: "dangerous" as const,
    inputSchema: { type: "object" },
    async execute() {
      return { content: "ok" };
    },
  };
  const question = formatPermissionQuestion(
    tool,
    { callId: "call-2", name: "deploy", input: { target: "production" } },
    "dangerous",
  );
  expect(question).toContain("Allow? [y]es / [N]o: ");
  expect(question).not.toContain("session");
});
```

- [ ] **Step 2: Add a failing runtime test for bounded third-party invocation summaries**

Add near tool execution event tests in `test/runtime.integration.test.ts`:

```ts
it("adds only a bounded generic input summary to tool.started", async () => {
  const provider = new ScriptedProvider([
    scriptedTool("custom-1", "echo", { message: "hello", payload: "secret".repeat(100) }),
    scriptedText("done"),
  ]);
  const h = await harness(provider);
  h.registry.register({
    name: "echo",
    description: "echo input",
    risk: "read",
    inputSchema: {
      type: "object",
      required: ["message", "payload"],
      properties: {
        message: { type: "string" },
        payload: { type: "string" },
      },
    },
    async execute() {
      return { content: "ok" };
    },
  });
  const started: RuntimeEvent[] = [];
  h.events.on((event) => {
    if (event.type === "tool.started") started.push(event);
  });

  await h.runtime.run("use the tool");

  expect(started).toHaveLength(1);
  expect(started[0]?.data).toMatchObject({ name: "echo", callId: "custom-1" });
  expect(started[0]?.data?.summary).toBe("message: hello");
  expect(JSON.stringify(started[0]?.data)).not.toContain("secretsecret");
});
```

Change the existing events import to `import { EventBus, type RuntimeEvent } from "../src/core/events.js";`. The test registers `echo` before execution so the shared registry used by the runtime and executor sees the schema and implementation.

- [ ] **Step 3: Add failing TTY/non-TTY lifecycle rendering tests**

Add to `test/plugin-terminal.test.ts`:

```ts
it("renders concise tool lifecycle symbols and summaries only in TTY mode", async () => {
  const out = new Sink();
  const err = new Sink();
  Object.assign(err, { columns: 40 });
  const events = new EventBus();
  const renderer = new TerminalRenderer(events, { stdout: out, stderr: err, tty: true });

  await events.emit("tool.started", { name: "custom_search", summary: "query: terminal markdown" });
  await events.emit("tool.completed", { name: "custom_search", isError: false, durationMs: 12 });
  await events.emit("tool.completed", { name: "deploy", isError: true, durationMs: 438 });

  expect(err.value).toContain("◇ custom_search  query: terminal markdown");
  expect(err.value).toContain("✓ custom_search  12ms");
  expect(err.value).toContain("✗ deploy  438ms");
  renderer.dispose();
});

it("preserves generic non-TTY tool lifecycle messages", async () => {
  const out = new Sink();
  const err = new Sink();
  const events = new EventBus();
  const renderer = new TerminalRenderer(events, { stdout: out, stderr: err, tty: false });

  await events.emit("tool.started", { name: "read", summary: "path: secret.txt" });
  await events.emit("tool.completed", { name: "read", isError: false, durationMs: 2 });

  expect(err.value).toContain("[coden] tool read started");
  expect(err.value).toContain("[coden] tool read completed (2ms)");
  expect(err.value).not.toContain("secret.txt");
  renderer.dispose();
});
```

- [ ] **Step 4: Run focused tests and verify they fail**

Run:

```bash
bun run test -- test/format.test.ts test/runtime.integration.test.ts test/plugin-terminal.test.ts \
  -t "permission questions|invocation summaries|lifecycle symbols|generic non-TTY"
```

Expected: FAIL because the permission formatter and event summary do not exist and TTY status still says `tool <name> started/completed`.

- [ ] **Step 5: Implement and use the structured permission question**

In `src/cli/format.ts`, import `ToolCall`, `ToolDefinition`, and `ToolRisk`, import `formatToolInput`, and export:

```ts
export function formatPermissionQuestion(
  tool: ToolDefinition,
  call: ToolCall,
  risk: ToolRisk,
): string {
  const display = formatToolInput({
    name: tool.name,
    risk,
    inputSchema: tool.inputSchema,
    input: call.input,
  });
  const values = display.lines.map((line) => `  ${line}`).join("\n");
  const choices = risk === "dangerous" ? "[y]es / [N]o" : "[y]es / [s]ession / [N]o";
  return `${risk.toUpperCase()}  ${tool.name}\n\n${values}\n\nAllow? ${choices}: `;
}
```

In `src/cli/agent-command.ts`, import `formatPermissionQuestion` beside the existing format helpers and replace the `JSON.stringify` question passed to `question()` with:

```ts
const answer = await question(rl, formatPermissionQuestion(tool, call, risk), signal);
```

Do not change decision parsing or dangerous-tool session restrictions.

- [ ] **Step 6: Emit a bounded summary only after authorization**

In `src/tools/executor.ts`, import `formatToolInput`. Immediately before `tool.started`, derive the display from the registered tool, effective permission risk, schema, and validated input:

```ts
const display = formatToolInput({
  name: tool.name,
  risk: permission.risk,
  inputSchema: tool.inputSchema,
  input: call.input,
});
await this.events.emit(
  "tool.started",
  { name: call.name, callId: call.callId, summary: display.summary },
  turnId,
);
```

Keep `tool.requested`, validation, workspace checks, permission events, and `tool.completed` unchanged. Never put `display.lines` or `call.input` into a lifecycle event.

- [ ] **Step 7: Render concise TTY lifecycle lines with width limits**

In `src/observability/terminal.ts`, import `sanitizeTerminalText` and `truncateDisplay`. Replace only the two tool lifecycle branches with mode-aware rendering:

```ts
if (event.type === "tool.started") {
  this.endProviderAttempt();
  const name = sanitizeTerminalText(String(event.data?.name ?? "tool"));
  if (this.tty) {
    const summary = sanitizeTerminalText(String(event.data?.summary ?? ""));
    this.toolStatus(`◇ ${name}${summary ? `  ${summary}` : ""}`);
  } else this.status(`tool ${name} started`);
}
if (event.type === "tool.completed") {
  const name = sanitizeTerminalText(String(event.data?.name ?? "tool"));
  const duration = String(event.data?.durationMs ?? "?");
  if (this.tty) {
    const failed = Boolean(event.data?.isError);
    this.toolStatus(`${failed ? "✗" : "✓"} ${name}  ${duration}ms`, failed);
  } else {
    this.status(`tool ${name} ${event.data?.isError ? "failed" : "completed"} (${duration}ms)`);
  }
}
```

Add `toolStatus(message: string, failed = false)` that reads stderr columns (default 80), truncates sanitized text with `truncateDisplay`, colors failure red and successful/invocation text dim, and writes exactly one newline. Keep `status()` for non-tool diagnostics.

- [ ] **Step 8: Format and run tool display integration tests**

Run:

```bash
bun run format
bun run test -- test/tool-input-display.test.ts test/format.test.ts \
  test/runtime.integration.test.ts test/plugin-terminal.test.ts
```

Expected: PASS. Permission text contains physical multiline values, `tool.started` contains one bounded summary, TTY uses symbols, and non-TTY output does not include the summary.

- [ ] **Step 9: Commit permission and lifecycle integration**

```bash
git add src/cli/format.ts src/cli/agent-command.ts src/tools/executor.ts \
  src/observability/terminal.ts test/format.test.ts test/runtime.integration.test.ts \
  test/plugin-terminal.test.ts
git commit -m "feat: improve tool terminal displays"
```

---

### Task 3: Build the line-buffered Markdown stream renderer

**Files:**

- Modify: `package.json`
- Modify: `bun.lock`
- Create: `src/observability/markdown.ts`
- Create: `test/markdown-terminal.test.ts`

**Interfaces:**

- Consumes: `marked.lexer()` from `marked@^18.0.11`.
- Produces: `MarkdownStreamRenderer` with `push(text: string): void`, `complete(): void`, and `reset(): void`.
- Constructor: `new MarkdownStreamRenderer(write: (text: string) => void)`.
- Guarantees: only complete ordinary lines and complete fenced blocks are emitted before `complete()`; `reset()` emits nothing.

- [ ] **Step 1: Add the Markdown parser dependency**

Run:

```bash
bun add marked@^18.0.11
```

Expected: `package.json` contains `"marked": "^18.0.11"` under dependencies and `bun.lock` records the resolved package. Do not add `marked-terminal`, Chalk, a syntax highlighter, or a Unicode-width package.

- [ ] **Step 2: Write failing tests for common Markdown and split deltas**

Create `test/markdown-terminal.test.ts`:

```ts
import { stripVTControlCharacters } from "node:util";
import { describe, expect, it } from "vitest";
import { MarkdownStreamRenderer } from "../src/observability/markdown.js";

function harness() {
  let output = "";
  const renderer = new MarkdownStreamRenderer((text) => {
    output += text;
  });
  return { renderer, output: () => stripVTControlCharacters(output) };
}

describe("MarkdownStreamRenderer", () => {
  it("renders common Markdown without exposing delimiters", () => {
    const h = harness();
    h.renderer.push("# Heading\n**bold** and *italic* with `code`\n");
    h.renderer.push("- first\n1. second\n> quote\n[text](https://example.com)\n");

    const output = h.output();
    expect(output).toContain("Heading");
    expect(output).toContain("bold and italic with code");
    expect(output).toContain("• first");
    expect(output).toContain("1. second");
    expect(output).toContain("│ quote");
    expect(output).toContain("text (https://example.com)");
    expect(output).not.toContain("**bold**");
    expect(output).not.toContain("`code`");
    expect(output).not.toContain("[text](");
  });

  it("waits for a complete line across provider deltas", () => {
    const h = harness();
    h.renderer.push("**bo");
    expect(h.output()).toBe("");
    h.renderer.push("ld**\n");
    expect(h.output()).toBe("bold\n");
  });
});
```

- [ ] **Step 3: Add failing fence, completion, reset, control, and fallback tests**

Append:

```ts
it("buffers a fenced block until its closing fence", () => {
  const h = harness();
  h.renderer.push("```ts\nconst value");
  expect(h.output()).toBe("");
  h.renderer.push(" = 1;\n```\nAfter\n");
  expect(h.output()).toContain("ts\nconst value = 1;\nAfter\n");
  expect(h.output()).not.toContain("```");
});

it("flushes incomplete lines and unclosed fences on completion", () => {
  const line = harness();
  line.renderer.push("**final**");
  line.renderer.complete();
  expect(line.output()).toBe("final");

  const fence = harness();
  fence.renderer.push("```text\nunclosed");
  fence.renderer.complete();
  expect(fence.output()).toContain("text\nunclosed");
  expect(fence.output()).not.toContain("```");
});

it("drops pending content on reset and strips terminal controls", () => {
  const h = harness();
  h.renderer.push("discard me");
  h.renderer.reset();
  h.renderer.push("safe\u001b[31mred\u001b[0m\u0007\n");
  expect(h.output()).toBe("safered\n");
});

it("keeps unsupported table syntax readable", () => {
  const h = harness();
  h.renderer.push("| a | b |\n| - | - |\n| 1 | 2 |\n");
  expect(h.output()).toContain("a");
  expect(h.output()).toContain("1");
  expect(h.output()).toContain("2");
});
```

- [ ] **Step 4: Run the Markdown tests and verify they fail**

Run:

```bash
bun run test -- test/markdown-terminal.test.ts
```

Expected: FAIL because `src/observability/markdown.ts` is missing.

- [ ] **Step 5: Implement stream boundaries and fenced-block buffering**

Create `src/observability/markdown.ts`. Maintain:

```ts
private pending = "";
private fence: { marker: "`" | "~"; length: number; lines: string[] } | undefined;
```

`push(text)` sanitizes with `sanitizeTerminalText`, appends to `pending`, repeatedly removes complete `\n`-terminated lines, and passes each line to `consumeLine(line, true)`. Opening fences match:

```text
^ {0,3}(`{3,}|~{3,})(.*)$
```

Closing fences must use the same marker and at least the opening length. Store the complete opening/content/closing lines and parse them as one block only when closed.

`complete()` consumes the final incomplete line, then parses any remaining unclosed fence as one Markdown code token, and clears state. It must not append a newline that the provider did not send. `reset()` clears `pending` and `fence` without calling the writer.

- [ ] **Step 6: Implement marked token rendering with restrained styles**

Use `marked.lexer(source)` and recursively render tokens. Define a local structural token type rather than coupling the file to every `marked` token union member:

```ts
type RenderToken = {
  type: string;
  raw?: string;
  text?: string;
  href?: string;
  depth?: number;
  ordered?: boolean;
  start?: number | "";
  lang?: string;
  tokens?: RenderToken[];
  items?: Array<{ tokens?: RenderToken[]; text?: string }>;
};
```

Map tokens as follows:

- `heading`: bold rendered child tokens;
- `strong`: `pc.bold(children)`;
- `em`: `pc.italic(children)`;
- `codespan`: `pc.cyan(text)`;
- `link`: underlined child label followed by dim ` (href)`;
- unordered `list`: `• ` plus each rendered item;
- ordered `list`: `<start + index>. ` plus each rendered item;
- `blockquote`: prefix every rendered physical line with dim `│ `;
- `code`: optional dim language label plus cyan code text with original whitespace;
- `paragraph`, `text`, and `escape`: render children when present, otherwise sanitized text;
- `space` and `br`: preserve a newline;
- unknown tokens: render children, then readable text, then sanitized `raw` as the final fallback.

Strip only Markdown syntax represented by parsed tokens; never run a regex that removes arbitrary `*`, `_`, or `#` from code/text content. Catch lexer/render errors per flushed unit and emit the sanitized source unchanged.

- [ ] **Step 7: Format and run Markdown tests**

Run:

```bash
bun run format
bun run test -- test/markdown-terminal.test.ts
```

Expected: PASS. No test observes Markdown delimiters for supported syntax, code fences do not stream partially, reset emits nothing, and control sequences are absent.

- [ ] **Step 8: Commit the Markdown renderer and dependency**

```bash
git add package.json bun.lock src/observability/markdown.ts test/markdown-terminal.test.ts
git commit -m "feat: add streaming terminal markdown renderer"
```

---

### Task 4: Integrate Markdown rendering without changing raw output

**Files:**

- Modify: `src/observability/terminal.ts`
- Modify: `test/plugin-terminal.test.ts`

**Interfaces:**

- Consumes: `MarkdownStreamRenderer` from Task 3.
- Preserves: existing reasoning/tool preview spinner behavior and retry-safe non-TTY `pendingText`.
- Enforces: `printMode: true` disables TTY rendering even if `tty: true` is explicitly supplied.

- [ ] **Step 1: Add failing TTY streaming and completion tests**

Add to `test/plugin-terminal.test.ts`:

```ts
it("renders assistant Markdown by complete lines in TTY mode", async () => {
  const out = new Sink();
  const err = new Sink();
  const events = new EventBus();
  const renderer = new TerminalRenderer(events, { stdout: out, stderr: err, tty: true });

  await events.emit("provider.started");
  await events.emit("provider.delta", { text: "**bo" });
  expect(out.value).toBe("");
  await events.emit("provider.delta", { text: "ld**\n`code`" });
  expect(out.value).toContain("bold\n");
  expect(out.value).not.toContain("**");
  await events.emit("provider.completed", {});
  expect(out.value).toContain("code");
  expect(out.value).not.toContain("`code`");
  renderer.dispose();
});
```

- [ ] **Step 2: Add failing retry, raw non-TTY, and print-mode tests**

Append:

```ts
it("drops uncommitted TTY Markdown when a provider attempt retries", async () => {
  const out = new Sink();
  const err = new Sink();
  const events = new EventBus();
  const renderer = new TerminalRenderer(events, { stdout: out, stderr: err, tty: true });

  await events.emit("provider.started");
  await events.emit("provider.delta", { text: "discard **me" });
  await events.emit("provider.retry", { attempt: 1 });
  await events.emit("provider.started");
  await events.emit("provider.delta", { text: "keep **this**" });
  await events.emit("provider.completed", {});

  expect(out.value).toContain("keep this");
  expect(out.value).not.toContain("discard");
  renderer.dispose();
});

it("preserves raw Markdown in non-TTY and print modes", async () => {
  for (const options of [
    { tty: false },
    { tty: true, printMode: true },
  ]) {
    const out = new Sink();
    const err = new Sink();
    const events = new EventBus();
    const renderer = new TerminalRenderer(events, { stdout: out, stderr: err, ...options });
    await events.emit("provider.started");
    await events.emit("provider.delta", { text: "**raw**\n" });
    await events.emit("provider.completed", {});
    expect(out.value).toBe("**raw**\n");
    renderer.dispose();
  }
});
```

- [ ] **Step 3: Run focused terminal tests and verify they fail**

Run:

```bash
bun run test -- test/plugin-terminal.test.ts \
  -t "assistant Markdown|uncommitted TTY Markdown|raw Markdown"
```

Expected: FAIL because TTY deltas still write immediately and `printMode` does not currently disable TTY behavior.

- [ ] **Step 4: Connect one Markdown renderer to `TerminalRenderer`**

Import `MarkdownStreamRenderer`. Add a readonly field initialized after stdout is selected:

```ts
private readonly markdown: MarkdownStreamRenderer;
```

In the constructor:

```ts
this.tty =
  !options.printMode &&
  (options.tty ?? Boolean(process.stderr.isTTY && !process.env.NO_COLOR && !process.env.CI));
this.markdown = new MarkdownStreamRenderer((text) => this.stdout.write(text));
```

Keep explicit `tty: false` behavior unchanged. `printMode` must win over explicit `tty: true` so `coden --print` is always raw and script-friendly.

- [ ] **Step 5: Route provider text through the correct mode and lifecycle**

Replace the TTY write in `provider.delta`:

```ts
if (this.tty) this.markdown.push(text);
else this.pendingText += text;
```

At the beginning of `provider.completed`, call `this.markdown.complete()` only in TTY mode, then retain the existing non-TTY pending-buffer flush. Ensure `endProviderAttempt()` calls `this.markdown.reset()` so start, retry, failure, tool start, and disposal all clear uncommitted Markdown through their existing paths.

Ordering is required:

1. `provider.completed`: complete Markdown;
2. flush non-TTY pending text when applicable;
3. call `endProviderAttempt()`;
4. `turn.completed` retains the existing final `stdout.write("\n")`.

Do not route reasoning text or streamed tool arguments through Markdown.

- [ ] **Step 6: Replace duplicate width helpers with shared primitives**

Import `displayWidth` and `truncateDisplay` from `terminal-text.ts`. Remove `TerminalRenderer.displayWidth()`. Replace the body of `truncateTail()` with:

```ts
return truncateDisplay(text, maxColumns, "tail");
```

Update `currentActivityText()` to call imported `displayWidth(label)`. Run existing reasoning and tool-call preview tests to ensure Chinese-width and tail-preservation behavior remain unchanged.

- [ ] **Step 7: Format and run all terminal-focused tests**

Run:

```bash
bun run format
bun run test -- test/markdown-terminal.test.ts test/tool-input-display.test.ts \
  test/format.test.ts test/plugin-terminal.test.ts test/runtime.integration.test.ts
```

Expected: PASS. Existing spinner, reasoning, streamed tool preview, retry, plugin diagnostic, and stable non-TTY tests remain green alongside the new rendering tests.

- [ ] **Step 8: Run project-wide verification and package build**

Run:

```bash
just check
just build
node dist/index.js --version
npm publish --dry-run
```

Expected:

- Biome passes;
- strict TypeScript passes;
- all offline tests pass and credentialed live tests remain skipped unless configured;
- Bun bundles `marked` into `dist/index.js` without requiring Bun runtime APIs;
- built CLI prints version `0.1.2`;
- npm dry run still contains only the intended LICENSE, README, package metadata, CLI bundle, and plugin type/runtime artifacts, with no `src` files.

- [ ] **Step 9: Commit Markdown terminal integration**

```bash
git add src/observability/terminal.ts test/plugin-terminal.test.ts
git commit -m "feat: render markdown in interactive terminals"
```

---

## Final Verification

- [ ] Run `git diff --check` and confirm no whitespace errors.
- [ ] Run `git status --short` and confirm no uncommitted source, test, dependency, or generated changes remain; remove `dist/` only if it is unexpectedly unignored.
- [ ] Run `git log -5 --oneline` and confirm four implementation commits follow the committed design and plan documents.
- [ ] In a real TTY, ask for an answer containing a heading, emphasis, a list, a link, and a fenced code block; confirm supported Markdown syntax is hidden and code whitespace is preserved.
- [ ] In a real TTY, trigger `read`, `write`, `bash`, and one third-party tool; confirm compact lifecycle summaries appear for all and multiline permission parameters contain real line breaks.
- [ ] Pipe `coden --print "..."` to a file and confirm stdout contains raw model Markdown with no ANSI sequences; these credentialed manual checks are optional when provider credentials are unavailable and do not block offline acceptance.
