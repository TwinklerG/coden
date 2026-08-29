# Resume History Display Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the "last few messages collapsed into `┌ role ...`" resume banner with a full transcript that renders every prior user/assistant message the way it appeared during the live session, truncates each assistant reply to 2000 characters, and ends with a one-line tool-usage summary.

**Architecture:** A new `renderResumeTranscript(sessionId, messages)` function in `src/cli/format.ts` builds a string transcript. It selects only `user`/`assistant` messages, renders user content as prompt-style multi-line text, renders each assistant reply through a fresh `MarkdownStreamRenderer` (for isolation between messages), truncates long replies by Unicode code points, and appends a deterministic tool summary derived from assistant `toolCalls` and `tool` result messages. `src/cli/agent-command.ts` is wired to call it in the interactive `--resume` path only.

**Tech Stack:** TypeScript, Bun, Vitest, `marked`, `picocolors`, Biome.

**Spec:** `docs/superpowers/specs/2026-08-29-resume-history-display-design.md`

## Global Constraints

- Assistant truncation limit is exactly **2000 Unicode code points** (constant `ASSISTANT_TRUNCATE_LIMIT = 2000`).
- Per-tool count format is `` `${name} ×${count}` `` and per-tool list is sorted by count descending, then name ascending; joined with `", "`.
- Tool summary line format: `` `Tools: ${total} calls — ${perTool}` `` plus `` `; ${failures} failed` `` only when `failures > 0`.
- Omission notice format: `` `…（已省略 ${omitted} 个字符）` `` on its own line after the truncated reply.
- User message format: first line prefixed with `"> "`, subsequent lines indented by two spaces (`"  "`); original newlines preserved verbatim.
- Interactive transcript is built only when `!options.print`; `--print` and non-TTY output are unchanged.
- Markdown rendering reuses the existing `MarkdownStreamRenderer`; no new third-party dependency.
- Commands: unit/format tests via `bun run test` or `just test`; full gate via `just check` (Biome lint + strict typecheck + tests).

---

## File Structure

- `src/cli/format.ts` — add `renderResumeTranscript`, `ASSISTANT_TRUNCATE_LIMIT`, and private helpers (`renderUserMessage`, `renderAssistantMessage`, `truncateAssistant`, `summarizeTools`). Remove `renderResumeBanner` in Task 2.
- `src/cli/agent-command.ts` — switch from `renderResumeBanner` to `renderResumeTranscript`; rename the `resumeBanner` variable to `resumeTranscript`; update the REPL banner write.
- `test/format.test.ts` — add tests for `renderResumeTranscript` and its helpers; remove the obsolete `renderResumeBanner` test in Task 2.
- `test/cli.test.ts` — update the resume CLI test to assert the full transcript instead of "Showing last".

---

### Task 1: Implement `renderResumeTranscript` and its unit tests

**Files:**
- Modify: `src/cli/format.ts`
- Test: `test/format.test.ts`

**Interfaces:**
- Consumes: `AgentMessage`, `UserMessage`, `AssistantMessage` from `../core/types.js`; `MarkdownStreamRenderer` from `../observability/markdown.js`.
- Produces:
  - `export const ASSISTANT_TRUNCATE_LIMIT = 2000`
  - `export function renderResumeTranscript(sessionId: string, messages: AgentMessage[]): string`
  - Private helpers `renderUserMessage(content: string): string`, `renderAssistantMessage(content: string): string`, `truncateAssistant(content: string): { text: string; omitted: number }`, `summarizeTools(messages: AgentMessage[]): string | undefined`.

`renderResumeBanner` stays present in this task (still imported by `agent-command.ts`), so the tree stays green; it is removed in Task 2.

- [ ] **Step 1: Write the failing tests**

Append the imports and the `describe` block below to `test/format.test.ts`. Add `stripVTControlCharacters` to the top import (it already imports from `../src/cli/format.js` and `../src/core/types.js`):

```ts
import { stripVTControlCharacters } from "node:util";
```

Add `renderResumeTranscript` and `ASSISTANT_TRUNCATE_LIMIT` to the existing format import:

```ts
import {
  formatDateTime,
  formatPermissionQuestion,
  formatSessionList,
  renderResumeBanner,
  renderResumeTranscript,
  singleLine,
  ASSISTANT_TRUNCATE_LIMIT,
} from "../src/cli/format.js";
```

Add this block inside the existing `describe("cli format helpers", ...)` (before the closing `});`):

```ts
  it("renders the full user/assistant transcript and hides system/tool messages", () => {
    const messages: AgentMessage[] = [
      { role: "system", content: "You are CodeN." },
      { role: "user", content: "hello" },
      { role: "assistant", content: "hi", toolCalls: [] },
      { role: "tool", callId: "call-1", name: "read", content: "file", isError: false },
      { role: "user", content: "next" },
      { role: "assistant", content: "again", toolCalls: [] },
    ];
    const transcript = renderResumeTranscript("sess-id", messages);
    expect(transcript).toContain("Resumed session sess-id (6 messages).");
    expect(transcript.indexOf("> hello")).toBeLessThan(transcript.indexOf("hi"));
    expect(transcript.indexOf("hi")).toBeLessThan(transcript.indexOf("> next"));
    expect(transcript.indexOf("> next")).toBeLessThan(transcript.indexOf("again"));
    expect(transcript).not.toContain("You are CodeN.");
    expect(transcript).not.toContain("call-1");
    expect(transcript).not.toContain("file");
  });

  it("preserves multi-line user content under the > prompt", () => {
    const transcript = renderResumeTranscript("s", [
      { role: "user", content: "line one\nline two\nline three" },
    ]);
    expect(transcript).toContain("> line one\n  line two\n  line three");
  });

  it("renders assistant Markdown instead of raw markup", () => {
    const transcript = renderResumeTranscript("s", [
      { role: "assistant", content: "# Title\n**bold** and `code`\n- item", toolCalls: [] },
    ]);
    const plain = stripVTControlCharacters(transcript);
    expect(plain).toContain("Title");
    expect(plain).toContain("bold and code");
    expect(plain).toContain("• item");
    expect(plain).not.toContain("**bold**");
    expect(plain).not.toContain("`code`");
  });

  it("truncates assistant replies over the limit and reports the omitted count", () => {
    const over = renderResumeTranscript("s", [
      { role: "assistant", content: "x".repeat(ASSISTANT_TRUNCATE_LIMIT + 40), toolCalls: [] },
    ]);
    expect(over).toContain("…（已省略 40 个字符）");
    expect(stripVTControlCharacters(over)).toContain("x".repeat(ASSISTANT_TRUNCATE_LIMIT));
    expect(stripVTControlCharacters(over)).not.toContain("x".repeat(ASSISTANT_TRUNCATE_LIMIT + 1));

    const exact = renderResumeTranscript("s", [
      { role: "assistant", content: "y".repeat(ASSISTANT_TRUNCATE_LIMIT), toolCalls: [] },
    ]);
    expect(exact).not.toContain("已省略");
  });

  it("counts Unicode code points, not UTF-16 units, for truncation", () => {
    const emoji = "😀".repeat(ASSISTANT_TRUNCATE_LIMIT + 1);
    const transcript = renderResumeTranscript("s", [
      { role: "assistant", content: emoji, toolCalls: [] },
    ]);
    expect(transcript).toContain("…（已省略 1 个字符）");
  });

  it("summarizes tool usage and failures", () => {
    const messages: AgentMessage[] = [
      { role: "assistant", content: "", toolCalls: [{ callId: "c1", name: "read", input: {} }] },
      { role: "tool", callId: "c1", name: "read", content: "ok", isError: false },
      {
        role: "assistant",
        content: "",
        toolCalls: [
          { callId: "c2", name: "read", input: {} },
          { callId: "c3", name: "bash", input: {} },
        ],
      },
      { role: "tool", callId: "c2", name: "read", content: "x", isError: true },
      { role: "tool", callId: "c3", name: "bash", content: "ok", isError: false },
    ];
    const transcript = renderResumeTranscript("s", messages);
    expect(transcript).toContain("Tools: 3 calls — read ×2, bash ×1; 1 failed");
  });

  it("omits the tool summary when no tools were used", () => {
    const transcript = renderResumeTranscript("s", [
      { role: "user", content: "hello" },
      { role: "assistant", content: "hi", toolCalls: [] },
    ]);
    expect(transcript).not.toContain("Tools:");
  });

  it("does not leak an unclosed code fence across messages", () => {
    const transcript = renderResumeTranscript("s", [
      { role: "assistant", content: "```ts\nconst x = 1;", toolCalls: [] },
      { role: "user", content: "continue" },
    ]);
    const plain = stripVTControlCharacters(transcript);
    expect(plain).toContain("const x = 1;");
    expect(plain).not.toContain("```");
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun run test test/format.test.ts -t "cli format helpers"`
Expected: FAIL, `renderResumeTranscript is not a function` / `ASSISTANT_TRUNCATE_LIMIT is not defined`.

- [ ] **Step 3: Implement `renderResumeTranscript` and helpers in `src/cli/format.ts`**

Update the top of `src/cli/format.ts`:

```ts
import type {
  AgentMessage,
  AssistantMessage,
  ToolCall,
  ToolDefinition,
  ToolRisk,
  UserMessage,
} from "../core/types.js";
import { formatToolInput } from "../observability/tool-input.js";
import { MarkdownStreamRenderer } from "../observability/markdown.js";
import type { SessionMeta } from "../sessions/store.js";

export const ASSISTANT_TRUNCATE_LIMIT = 2000;
```

Append the following after the existing `renderResumeBanner` function (keep `renderResumeBanner` for now — it is removed in Task 2):

```ts
export function renderResumeTranscript(sessionId: string, messages: AgentMessage[]): string {
  const isVisible = (message: AgentMessage): message is UserMessage | AssistantMessage =>
    message.role === "user" || message.role === "assistant";
  const blocks: string[] = [`Resumed session ${sessionId} (${messages.length} messages).`];
  for (const message of messages.filter(isVisible)) {
    blocks.push(
      message.role === "user"
        ? renderUserMessage(message.content)
        : renderAssistantMessage(message.content),
    );
  }
  const summary = summarizeTools(messages);
  if (summary) blocks.push(summary);
  return blocks.join("\n\n");
}

function renderUserMessage(content: string): string {
  return content
    .split("\n")
    .map((line, index) => (index === 0 ? `> ${line}` : `  ${line}`))
    .join("\n");
}

function renderAssistantMessage(content: string): string {
  const { text, omitted } = truncateAssistant(content);
  let out = "";
  const renderer = new MarkdownStreamRenderer((chunk) => {
    out += chunk;
  });
  renderer.push(text);
  renderer.complete();
  if (!omitted) return out;
  const separated = out.endsWith("\n") ? out : `${out}\n`;
  return `${separated}…（已省略 ${omitted} 个字符）`;
}

function truncateAssistant(content: string): { text: string; omitted: number } {
  const chars = [...content];
  return chars.length <= ASSISTANT_TRUNCATE_LIMIT
    ? { text: content, omitted: 0 }
    : {
        text: chars.slice(0, ASSISTANT_TRUNCATE_LIMIT).join(""),
        omitted: chars.length - ASSISTANT_TRUNCATE_LIMIT,
      };
}

function summarizeTools(messages: AgentMessage[]): string | undefined {
  const counts = new Map<string, number>();
  for (const message of messages) {
    if (message.role === "assistant") {
      for (const call of message.toolCalls) {
        counts.set(call.name, (counts.get(call.name) ?? 0) + 1);
      }
    }
  }
  if (counts.size === 0) return undefined;
  const total = [...counts.values()].reduce((sum, count) => sum + count, 0);
  let failures = 0;
  for (const message of messages) {
    if (message.role === "tool" && message.isError) failures++;
  }
  const perTool = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([name, count]) => `${name} ×${count}`)
    .join(", ");
  const base = `Tools: ${total} calls — ${perTool}`;
  return failures > 0 ? `${base}; ${failures} failed` : base;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun run test test/format.test.ts -t "cli format helpers"`
Expected: PASS (all existing format tests plus the 8 new ones).

- [ ] **Step 5: Commit**

```bash
git add src/cli/format.ts test/format.test.ts
git commit -m "feat: render resumed session as a full transcript"
```

---

### Task 2: Wire `agent-command.ts` to the transcript and remove the old banner

**Files:**
- Modify: `src/cli/agent-command.ts`
- Modify: `src/cli/format.ts`
- Test: `test/format.test.ts`, `test/cli.test.ts`

**Interfaces:**
- Consumes: `renderResumeTranscript(sessionId, messages): string` from Task 1.
- Produces: nothing new; `renderResumeBanner` is removed from `format.ts` and its call site.

- [ ] **Step 1: Update the CLI test to assert the full transcript**

In `test/cli.test.ts`, the test `"shows a resume banner when resuming a session"` currently asserts:

```ts
expect(result.stdout).toContain("Resumed session my-session");
expect(result.stdout).toContain("Showing last");
```

Replace the second assertion:

```ts
expect(result.stdout).toContain("Resumed session my-session");
expect(result.stdout).toContain("> hello world");
```

- [ ] **Step 2: Remove the obsolete `renderResumeBanner` test and its import**

In `test/format.test.ts`:
- Remove `renderResumeBanner` from the import list.
- Delete the `it("renders a resume banner with a preview of the last messages", ...)` test block.

- [ ] **Step 3: Remove `renderResumeBanner` from `src/cli/format.ts`**

Delete the whole `renderResumeBanner` function:

```ts
export function renderResumeBanner(sessionId: string, messages: AgentMessage[]): string {
  const count = messages.length;
  const preview = messages
    .filter((message) => message.role === "user" || message.role === "assistant")
    .slice(-3);
  const lines = [
    `Resumed session ${sessionId} (${count} messages).`,
    `Showing last ${preview.length} of ${count} messages.`,
  ];
  for (const message of preview) {
    const role = message.role === "user" ? "user" : "assistant";
    lines.push(`┌ ${role.padEnd(9)} ${singleLine(message.content, 120)}`);
  }
  return lines.join("\n");
}
```

If `singleLine` is now unused by `format.ts`, remove it from the file's own function list only if Biome reports an unused export; check with `biome check` and remove it from `format.ts` if flagged (it is still used by `formatSessionList`, so it will remain).

- [ ] **Step 4: Update imports in `src/cli/agent-command.ts`**

```ts
import { formatPermissionQuestion, formatSessionList, renderResumeTranscript } from "./format.js";
```

- [ ] **Step 5: Rename the variable and switch the call**

In `src/cli/agent-command.ts`:

```ts
export interface AgentCommandOptions {
```

(no change here). In the `runAgentCommand` function:

```ts
let resumeBanner: string | undefined;
```
→
```ts
let resumeTranscript: string | undefined;
```

```ts
if (!options.print) resumeBanner = renderResumeBanner(session.sessionId, recovered.messages);
```
→
```ts
if (!options.print) resumeTranscript = renderResumeTranscript(session.sessionId, recovered.messages);
```

```ts
      workspaceHash(workspace),
      resumeBanner,
    );
```
→
```ts
      workspaceHash(workspace),
      resumeTranscript,
    );
```

- [ ] **Step 6: Update the `repl` signature and banner write**

In the `repl` function:

```ts
  resumeBanner?: string,
```
→
```ts
  resumeTranscript?: string,
```

```ts
  stdout.write(
    resumeBanner
      ? `${resumeBanner}\nType /help for commands.\n`
      : `CodeN session ${session.sessionId}. Type /help for commands.\n`,
  );
```
→
```ts
  stdout.write(
    resumeTranscript
      ? `${resumeTranscript}\n\nType /help for commands.\n`
      : `CodeN session ${session.sessionId}. Type /help for commands.\n`,
  );
```

- [ ] **Step 7: Run the full gate**

Run: `just check`
Expected: Biome lint clean, strict TypeScript compile clean, all tests pass (207+ existing plus the new assertions).

- [ ] **Step 8: Commit**

```bash
git add src/cli/format.ts src/cli/agent-command.ts test/format.test.ts test/cli.test.ts
git commit -m "feat: resume sessions render the full conversation transcript"
```

---

## Self-Review Notes

- **Spec coverage:** message selection (Task 1, filter system/tool); user prompt-styling (Task 1 `renderUserMessage`); assistant Markdown via `MarkdownStreamRenderer` (Task 1 `renderAssistantMessage`); 2000-char Unicode truncation + notice (Task 1 `truncateAssistant`); per-message isolation (Task 1 fresh renderer per assistant message); tool summary with per-tool counts and failure count (Task 1 `summarizeTools`); `--print` unchanged (Task 2, `if (!options.print)` guard retained); header `Resumed session <id> (N messages)` (Task 1).
- **Placeholder scan:** all steps contain concrete code and assertions; no TBD/TODO.
- **Type consistency:** `ASSISTANT_TRUNCATE_LIMIT`, `renderResumeTranscript`, `renderUserMessage`, `renderAssistantMessage`, `truncateAssistant`, `summarizeTools` are named and shaped identically across Task 1 and Task 2. `resumeTranscript` replaces `resumeBanner` everywhere it is used in `agent-command.ts`.
