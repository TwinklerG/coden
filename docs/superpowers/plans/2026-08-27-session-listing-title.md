# CodeN 会话列表与会话标题 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 CodeN 增加"会话标题（首个 user prompt）+ `--resume`/`/sessions` 列出会话 + 恢复时展示历史预览"能力，让恢复与新建可区分。

**Architecture:** `SessionStore` 新增 `setTitle()`（追加 `session.title` 记录）与 `list()`（扫描会话目录、解析元信息）。`AgentRuntime.run()` 在会话首个 user 消息到达时写入标题。CLI 把 `--resume <id>` 改为可选值 `--resume [id]`：无值则列出当前工作区会话，有值则恢复；REPL 新增 `/sessions` 列出会话并标注当前会话，恢复时开场白展示已恢复横幅与最近几条预览。

**Tech Stack:** TypeScript（严格类型）、Bun、Biome（lint/format）、Vitest（测试）、commander v14（CLI 可选值选项）、`node:fs/promises`（readdir/readFile，不用 `Bun.*`）。

**Spec:** `docs/superpowers/specs/2026-08-27-session-listing-title-design.md`

## Global Constraints

- 语言 TS 严格类型；源码只用标准 Node/Web API，**禁止 `Bun.*`**。
- 会话目录权限 `0o700`、会话文件 `0o600`（沿用现有 `append()` 处理）。
- JSONL 记录 `version: 1`，记录结构 `{ version, id, timestamp, type, data }`。
- 退出码：配置错误 `2`，执行/会话失败 `1`，成功 `0`。
- 环境变量统一 `CODEN_` 前缀；数据目录用 `config.dataDir`（默认 `$XDG_DATA_HOME/coden`）。
- 仅列出**当前工作区**（会话按 `workspaceHash(workspace)` 分目录）。
- 命令：`bun run test`（vitest）、`bun run typecheck`、`bun run lint`、`bun run format`。
- 明确不做：不加 `/history`、不跨工作区、不做会话删除/重命名、不写持久化索引。

---

### Task 1: SessionStore — `setTitle` 与 `list`

**Files:**
- Modify: `src/sessions/store.ts`
- Test: `test/context-session.test.ts`

**Interfaces:**
- Consumes: 现有 `SessionRecord` 类型、`append()`（追加 JSONL 记录）。
- Produces:
  - `export interface SessionMeta { id: string; title?: string; messageCount: number; lastActivity: string; }`
  - `export function isValidSessionId(id: string): boolean`
  - `SessionStore.setTitle(title: string): Promise<void>`
  - `SessionStore.list(): Promise<SessionMeta[]>`

- [ ] **Step 1: 写失败的单元测试**

在 `test/context-session.test.ts` 末尾（`describe("context and sessions")` 内部）追加：

```ts
it("titles a session from the first user prompt and lists it", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "coden-list-"));
  const store = new SessionStore(root, root, "session-a");
  await store.create(root);
  await store.setTitle("First question");
  await store.appendMessage({ role: "user", content: "First question" });
  await store.appendMessage({ role: "assistant", content: "answer", toolCalls: [] });

  const list = await store.list();
  const meta = list.find((item) => item.id === "session-a");
  expect(meta?.title).toBe("First question");
  expect(meta?.messageCount).toBe(2);
  expect(meta?.lastActivity).toBeTruthy();
});

it("falls back to the first user prompt when no session.title is stored", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "coden-list-"));
  const store = new SessionStore(root, root, "session-f");
  await store.create(root);
  await store.appendMessage({ role: "user", content: "my first prompt" });
  await store.appendMessage({ role: "assistant", content: "ok", toolCalls: [] });

  const list = await store.list();
  expect(list[0]?.title).toBe("my first prompt");
});

it("resets conversation stats at session.reset", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "coden-list-"));
  const store = new SessionStore(root, root, "session-r");
  await store.create(root);
  await store.setTitle("old title");
  await store.appendMessage({ role: "user", content: "old" });
  await store.append("session.reset", {});
  await store.setTitle("new title");
  await store.appendMessage({ role: "user", content: "new" });

  const list = await store.list();
  expect(list[0]?.title).toBe("new title");
  expect(list[0]?.messageCount).toBe(1);
});

it("returns an empty list when no sessions exist", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "coden-list-"));
  const store = new SessionStore(root, root, "session-e");
  await expect(store.list()).resolves.toEqual([]);
});

it("orders sessions by lastActivity descending", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "coden-list-"));
  const a = new SessionStore(root, root, "session-a");
  await a.create(root);
  await a.appendMessage({ role: "user", content: "a" });
  const b = new SessionStore(root, root, "session-b");
  await b.create(root);
  await b.appendMessage({ role: "user", content: "b" });

  const list = await a.list();
  for (let i = 1; i < list.length; i++) {
    expect(list[i - 1]!.lastActivity >= list[i]!.lastActivity).toBe(true);
  }
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `bun run test -- test/context-session.test.ts`
Expected: FAIL —— `store.list` 不是函数 / `Property 'list' does not exist`。

- [ ] **Step 3: 实现**

修改 `src/sessions/store.ts`：

顶部 import 追加 `readdir`：

```ts
import { appendFile, chmod, mkdir, readFile } from "node:fs/promises";
// 改为：
import { appendFile, chmod, mkdir, readFile, readdir } from "node:fs/promises";
```

在 `export interface RecoveredSession { ... }` 之后追加：

```ts
export interface SessionMeta {
  id: string;
  title?: string;
  messageCount: number;
  lastActivity: string;
}
```

在文件顶部（`export function workspaceHash` 之前）追加：

```ts
const SESSION_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
export function isValidSessionId(id: string): boolean {
  return SESSION_ID_RE.test(id);
}
```

把构造函数里的校验改为复用：

```ts
if (!isValidSessionId(sessionId)) throw new Error("Invalid session ID");
```

在 `appendCompaction(...)` 之后、`recover()` 之前，追加两个方法：

```ts
setTitle(title: string): Promise<void> {
  return this.append("session.title", { title });
}

async list(): Promise<SessionMeta[]> {
  const directory = path.dirname(this.sessionPath);
  let names: string[];
  try {
    names = await readdir(directory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const metas: SessionMeta[] = [];
  for (const name of names) {
    // 会话文件形如 <id>.jsonl；trace 文件形如 <id>.trace.jsonl（同样以 .jsonl 结尾），须排除。
    if (!name.endsWith(".jsonl") || name.endsWith(".trace.jsonl")) continue;
    const id = name.slice(0, -".jsonl".length);
    if (!isValidSessionId(id)) continue;
    try {
      metas.push(await this.#readMeta(path.join(directory, name), id));
    } catch {
      // Skip a session file that cannot be parsed.
    }
  }
  metas.sort((a, b) => b.lastActivity.localeCompare(a.lastActivity));
  return metas;
}

async #readMeta(filePath: string, id: string): Promise<SessionMeta> {
  const text = await readFile(filePath, "utf8");
  let messageCount = 0;
  let title: string | undefined;
  let firstUserPrompt: string | undefined;
  let lastActivity = "";
  for (const line of text.split("\n")) {
    if (!line) continue;
    let record: SessionRecord;
    try {
      record = JSON.parse(line) as SessionRecord;
    } catch {
      continue;
    }
    if (record.version !== 1) continue;
    if (record.timestamp) lastActivity = record.timestamp;
    switch (record.type) {
      case "session.reset":
        messageCount = 0;
        firstUserPrompt = undefined;
        title = undefined;
        break;
      case "session.title": {
        const data = record.data as { title?: unknown };
        if (typeof data?.title === "string") title = data.title;
        break;
      }
      case "message":
        messageCount++;
        if (firstUserPrompt === undefined) {
          const data = record.data as { role?: unknown; content?: unknown };
          if (data?.role === "user" && typeof data.content === "string") {
            firstUserPrompt = data.content;
          }
        }
        break;
    }
  }
  return { id, title: title ?? firstUserPrompt, messageCount, lastActivity };
}
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `bun run test -- test/context-session.test.ts`
Expected: PASS（原有 + 新增全部通过）。

- [ ] **Step 5: Commit**

```bash
git add src/sessions/store.ts test/context-session.test.ts
git commit -m "feat(sessions): add setTitle and list"
```

---

### Task 2: Runtime — 首个 user 消息写入会话标题

**Files:**
- Modify: `src/core/runtime.ts`
- Test: `test/runtime.integration.test.ts`

**Interfaces:**
- Consumes: `SessionStore.setTitle(title)`（Task 1）、现有 `run()` 的 user 消息追加段。
- Produces: 无新公开接口；行为上"会话首个 user 消息到达时持久化一次标题"。

- [ ] **Step 1: 写失败的集成测试**

在 `test/runtime.integration.test.ts` 的 `describe("AgentRuntime integration")` 末尾追加（`readFile` 已在顶部 import，`h.session` 已返回）：

```ts
it("persists a session title only once from the first user message", async () => {
  const h = await harness(new ScriptedProvider([scriptedText("hello"), scriptedText("again")]));
  await h.runtime.run("first question");
  await h.runtime.run("second question");

  const list = await h.session.list();
  expect(list[0]?.title).toBe("first question");
  // 第二条消息不会覆盖已有标题
  const text = await readFile(h.session.sessionPath, "utf8");
  expect(text.match(/"type":"session\.title"/g)).toHaveLength(1);
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `bun run test -- test/runtime.integration.test.ts`
Expected: FAIL —— `list[0]?.title` 为 `undefined`（因为没有写入标题）。

- [ ] **Step 3: 实现**

在 `src/core/runtime.ts` 的 `run()` 中，user 消息追加段（当前为）：

```ts
const user: AgentMessage = { role: "user", content: userText };
this.messages.push(user);
await this.sessions.appendMessage(user);
```

改为：

```ts
const hasPriorUser = this.messages.some((message) => message.role === "user");
const user: AgentMessage = { role: "user", content: userText };
this.messages.push(user);
await this.sessions.appendMessage(user);
if (!hasPriorUser) await this.sessions.setTitle(userText);
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `bun run test -- test/runtime.integration.test.ts`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/core/runtime.ts test/runtime.integration.test.ts
git commit -m "feat(runtime): title a session from its first user message"
```

---

### Task 3: CLI — `--resume [id]` 列出、恢复横幅、`/sessions`

**Files:**
- Modify: `src/cli/index.ts`
- Test: `test/cli.test.ts`

**Interfaces:**
- Consumes: `SessionStore.list()`、`SessionStore.recover()`、`SessionStore.sessionId`、`SessionMeta`（Task 1）。
- Produces:
  - `CliOptions.resume?: string | boolean`
  - `function formatSessionList(sessions: SessionMeta[], currentId?: string): string`
  - `function renderResumeBanner(sessionId: string, messages: AgentMessage[]): string`
  - `function singleLine(text: string, max: number): string`
  - `function formatDateTime(iso: string): string`
  - REPL 新增 `/sessions` 分支；恢复时开场白渲染横幅。

- [ ] **Step 1: 写失败的 CLI 测试**

在 `test/cli.test.ts` 顶部 import 追加：

```ts
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import { SessionStore } from "../src/sessions/store.js";
```

在 `describe("CLI exit codes")` 内追加/新增 describe：

```ts
describe("CLI session list and resume", () => {
  // config.dataDir = $XDG_DATA_HOME/coden (userDataDir() adds "/coden")，必须与 CLI 读取一致。
  async function makeSession(workspace: string, xdgHome: string, id: string) {
    const store = new SessionStore(path.join(xdgHome, "coden"), workspace, id);
    await store.create(workspace);
    await store.setTitle("hello world");
    await store.appendMessage({ role: "user", content: "hello world" });
  }
  it("lists sessions with --resume and no id", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "coden-ws-"));
    const xdgHome = await mkdtemp(path.join(os.tmpdir(), "coden-xdg-"));
    await makeSession(workspace, xdgHome, "my-session");
    const result = spawnSync("bun", [cli, "--resume"], {
      cwd: workspace,
      encoding: "utf8",
      env: { ...baseEnv, CODEN_OPENAI_API_KEY: "", XDG_DATA_HOME: xdgHome },
      timeout: 30_000,
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("my-session");
    expect(result.stdout).toContain("hello world");
  });
  it("shows a resume banner and /sessions current marker", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "coden-ws-"));
    const xdgHome = await mkdtemp(path.join(os.tmpdir(), "coden-xdg-"));
    await makeSession(workspace, xdgHome, "my-session");
    const result = spawnSync("bun", [cli, "--resume", "my-session"], {
      cwd: workspace,
      encoding: "utf8",
      input: "/sessions\n/quit\n",
      env: { ...baseEnv, CODEN_OPENAI_API_KEY: "test-key", XDG_DATA_HOME: xdgHome },
      timeout: 30_000,
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Resumed session my-session");
    expect(result.stdout).toContain("Current session: my-session");
  });
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `bun run test -- test/cli.test.ts`
Expected: FAIL —— `--resume`（无值）当前会报错（必填值语法），且无横幅/`/sessions`。

- [ ] **Step 3: 实现**

修改 `src/cli/index.ts`：

**(a) import 追加 `SessionMeta`：**

```ts
import { SessionStore, type SessionMeta } from "../sessions/store.js";
```

**(b) `CliOptions.resume` 类型改为：**

```ts
resume?: string | boolean;
```

**(c) CLI 选项改为可选值：**

```ts
.option("--resume [session-id]", "resume a previous session, or list sessions when no id is given")
```

**(d) `main()` 重构——会话对象与列表分支。** 当前相关片段：

```ts
const session = new SessionStore(config.dataDir, workspace, options.resume);
let initialMessages: AgentMessage[] | undefined;
let recoveredSummary: string | undefined;
let recoveredCompactionEnd = 0;
if (options.resume) {
  const recovered = await session.recover();
  initialMessages = recovered.messages;
  recoveredSummary = recovered.summary;
  recoveredCompactionEnd = recovered.compactionRange?.end ?? 0;
  for (const warning of recovered.warnings) process.stderr.write(`coden: ${warning}\n`);
} else await session.create(workspace);
```

替换为：

```ts
const resumedId = typeof options.resume === "string" ? options.resume : undefined;
const session = new SessionStore(config.dataDir, workspace, resumedId);
if (options.resume === true) {
  stdout.write(formatSessionList(await session.list()));
  return;
}
let initialMessages: AgentMessage[] | undefined;
let recoveredSummary: string | undefined;
let recoveredCompactionEnd = 0;
let resumeBanner: string | undefined;
if (typeof options.resume === "string") {
  const recovered = await session.recover();
  initialMessages = recovered.messages;
  recoveredSummary = recovered.summary;
  recoveredCompactionEnd = recovered.compactionRange?.end ?? 0;
  for (const warning of recovered.warnings) process.stderr.write(`coden: ${warning}\n`);
  if (!options.print) resumeBanner = renderResumeBanner(session.sessionId, recovered.messages);
} else await session.create(workspace);
```

**(e) `repl()` 调用改传 `session` 与 `resumeBanner`。** 当前调用：

```ts
await repl(runtime, session.sessionId, reload, registry, requireInterface(rl));
```

改为：

```ts
await repl(runtime, session, reload, registry, requireInterface(rl), resumeBanner);
```

**(f) `repl()` 签名与开头/`/sessions` 分支。** 当前：

```ts
async function repl(
  runtime: AgentRuntime,
  sessionId: string,
  reload: () => Promise<{ loaded: string[]; failed: string[] }>,
  registry: ToolRegistry,
  rl: Interface,
): Promise<void> {
  stdout.write(`CodeN session ${sessionId}. Type /help for commands.\n`);
  while (true) {
    const line = (await question(rl, "> ")).trim();
    if (!line) continue;
    if (line === "/quit") break;
    if (line === "/help") {
      stdout.write("/help /session /compact /reload /new /quit\n");
      continue;
    }
    if (line === "/session") {
      stdout.write(`${sessionId}\n`);
      continue;
    }
```

替换为（签名改为 `session: SessionStore`，加可选 `resumeBanner`，开头加 `/sessions` 分支，且把 `sessionId` 引用统一为 `session.sessionId`）：

```ts
async function repl(
  runtime: AgentRuntime,
  session: SessionStore,
  reload: () => Promise<{ loaded: string[]; failed: string[] }>,
  registry: ToolRegistry,
  rl: Interface,
  resumeBanner?: string,
): Promise<void> {
  stdout.write(
    resumeBanner
      ? `${resumeBanner}\nType /help for commands.\n`
      : `CodeN session ${session.sessionId}. Type /help for commands.\n`,
  );
  while (true) {
    const line = (await question(rl, "> ")).trim();
    if (!line) continue;
    if (line === "/quit") break;
    if (line === "/help") {
      stdout.write("/help /session /sessions /compact /reload /new /quit\n");
      continue;
    }
    if (line === "/sessions") {
      stdout.write(formatSessionList(await session.list(), session.sessionId));
      continue;
    }
    if (line === "/session") {
      stdout.write(`${session.sessionId}\n`);
      continue;
    }
```

**(g) 新增模块级辅助函数**（放在 `requireInterface` 之后 / `main` 之前均可）：

```ts
function singleLine(text: string, max: number): string {
  const one = text.replace(/\s+/g, " ").trim();
  return one.length <= max ? one : `${one.slice(0, max - 1)}…`;
}

function formatDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formatSessionList(sessions: SessionMeta[], currentId?: string): string {
  if (sessions.length === 0) return "No sessions found.\n";
  const lines = sessions.map((item) => {
    const title = item.title ? singleLine(item.title, 40) : "(no title)";
    const meta = item.messageCount === 0 ? "(new session)" : `${item.messageCount} messages`;
    const active = item.id === currentId ? "  *" : "";
    return `${item.id}${active}  ${title}  (${meta}, ${formatDateTime(item.lastActivity)})`;
  });
  const header = currentId ? `Current session: ${currentId}\n` : "";
  return `${lines.join("\n")}\n${header}`;
}

function renderResumeBanner(sessionId: string, messages: AgentMessage[]): string {
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

- [ ] **Step 4: 运行测试，确认通过**

Run: `bun run test -- test/cli.test.ts`
Expected: PASS（含原有两条 exit code 测试）。

- [ ] **Step 5: 验证型别 + 格式**

Run: `bun run lint` 然后 `bun run typecheck`
Expected: 均通过。

- [ ] **Step 6: Commit**

```bash
git add src/cli/index.ts test/cli.test.ts
git commit -m "feat(cli): resume lists sessions, resume banner, /sessions"
```

---

## Self-Review

**1. Spec coverage**（对照 `docs/superpowers/specs/2026-08-27-session-listing-title-design.md`）：
- §4.1 `setTitle` / `list` / `SessionMeta`、旧会话回退、损坏文件跳过 → Task 1。
- §4.2 `run()` 首个 user 消息写标题、恢复不覆盖 → Task 2。
- §4.3 `--resume [id]` 可选值、无值列出、`/sessions`、列表渲染、恢复横幅 → Task 3。
- §6 测试（setTitle/list/排序/空目录/回退、CLI 列出/恢复、`/sessions`/横幅）→ 各任务 Step 1。
- §7 兼容性：`--resume <id>` 行为不变；`session.title` 为可选记录不影响 `recover()`。

**2. Placeholder scan**：无 TBD/TODO；每步含可运行测试与实现代码。

**3. Type consistency**：
- `SessionStore.list()` 返回 `SessionMeta[]`；`formatSessionList(sessions, currentId?)` 使用同一类型。
- `setTitle(title: string)`；`renderResumeBanner(sessionId, messages)` 用 `AgentMessage`。
- `options.resume` 类型 `string | boolean`；`resumedId = typeof options.resume === "string" ? options.resume : undefined`。
- `repl(..., session: SessionStore, ..., resumeBanner?)`，内部统一用 `session.sessionId`。

已验证（commander v14，实测）：`--resume`（无值）→ `options.resume === true`；`--resume abc` → `"abc"`；`--resume abc task` → resume `"abc"` + prompt `"task"`。Task 3 的 `options.resume === true` 分支与 `typeof options.resume === "string"` 分支均正确；现有 `--resume <id>` / `--resume <id> "prompt"` 用法不受影响。
