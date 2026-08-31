# CLI Startup Banner Info Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show the resolved model, approval mode, and thinking level in the interactive CLI startup banner, and render the final session line as `会话ID：<id>` / `Session ID: <id>`.

**Architecture:** Two i18n locales gain three `repl.*` message keys (`model`, `approvalMode`, `thinking`) and an edited `session` key; `repl()` in `src/cli/agent-command.ts` prints three new lines from already-resolved `application.metadata`; tests assert the new banner lines.

**Tech Stack:** TypeScript, Bun, vitest, Commander, readline/promises.

**Spec:** `docs/superpowers/specs/2026-08-31-coden-cli-startup-info-design.md`

## Global Constraints

- No provider line (excluded).
- Session line is `会话ID：${id}` / `Session ID: ${id}` — no `CodeN` prefix, no inline help hint.
- Thinking uses `application.metadata.thinkingDisplay`; approval uses raw `auto`/`smart`/`manual`.
- Under `test/cli.test.ts` baseEnv defaults: provider `openai`, model `gpt-5-mini`, approval `manual`, thinking display `default`.
- Only interactive CLI (`repl`) is affected; `--print`, `--tui`, non-interactive, and permission prompts are unchanged.

---

### Task 1: Add i18n repl messages (zh + en)

**Files:**
- Modify: `src/i18n/locales/zh.ts` (`repl` namespace)
- Modify: `src/i18n/locales/en.ts` (`repl` namespace)

**Interfaces:**
- Produces: `i18n.messages.repl.model(model: string): string`, `i18n.messages.repl.approvalMode(mode: string): string`, `i18n.messages.repl.thinking(level: string): string`, and an updated `i18n.messages.repl.session(id: string): string`.

- [ ] **Step 1: Edit `src/i18n/locales/zh.ts` repl block**

Replace:
```ts
    version: (version: string) => `版本：${version}`,
    workspace: (hash: string) => `工作区哈希：${hash}`,
    session: (id: string) => `CodeN 会话 ${id}。输入 /help 查看命令。`,
```
with:
```ts
    version: (version: string) => `版本：${version}`,
    workspace: (hash: string) => `工作区哈希：${hash}`,
    model: (model: string) => `模型：${model}`,
    approvalMode: (mode: string) => `审批模式：${mode}`,
    thinking: (level: string) => `思考等级：${level}`,
    session: (id: string) => `会话ID：${id}`,
```

- [ ] **Step 2: Edit `src/i18n/locales/en.ts` repl block**

Replace:
```ts
    version: (version) => `Version: ${version}`,
    workspace: (hash) => `Workspace hash: ${hash}`,
    session: (id) => `CodeN session ${id}. Type /help for commands.`,
```
with:
```ts
    version: (version) => `Version: ${version}`,
    workspace: (hash) => `Workspace hash: ${hash}`,
    model: (model) => `Model: ${model}`,
    approvalMode: (mode) => `Approval: ${mode}`,
    thinking: (level) => `Thinking: ${level}`,
    session: (id) => `Session ID: ${id}`,
```

- [ ] **Step 3: Verify typecheck**

Run: `bun run typecheck`
Expected: PASS. `en.ts` is typed as `Messages` (derived from `zh`), so this enforces zh/en key parity.

- [ ] **Step 4: Commit**

```bash
git add src/i18n/locales/zh.ts src/i18n/locales/en.ts
git commit -m "feat(i18n): add CLI startup banner messages"
```

---

### Task 2: Print new banner lines and assert them

**Files:**
- Modify: `src/cli/agent-command.ts` (`repl()`)
- Test: `test/cli.test.ts`

**Interfaces:**
- Consumes: `application.metadata.model`, `application.metadata.approvalMode`, `application.metadata.thinkingDisplay`, and the `repl.model` / `repl.approvalMode` / `repl.thinking` messages from Task 1.

- [ ] **Step 1: Write the failing test**

In `test/cli.test.ts`, inside the `describe("CLI session list and resume")` block (where `makeWorkspace` is defined), add a new test after the `makeWorkspace` helper:

```ts
  it("shows model, approval mode, and thinking level in the startup banner", async () => {
    const workspace = await makeWorkspace();
    const xdgHome = await mkdtemp(path.join(os.tmpdir(), "coden-xdg-"));
    const result = spawnSync("bun", [cli], {
      cwd: workspace,
      encoding: "utf8",
      input: "/quit\n",
      env: { ...baseEnv, CODEN_OPENAI_API_KEY: "test-key", XDG_DATA_HOME: xdgHome },
      timeout: 30_000,
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain(`版本：${CODEN_VERSION}`);
    expect(result.stdout).toContain(`工作区哈希：${workspaceHash(workspace)}`);
    expect(result.stdout).toContain("模型：gpt-5-mini");
    expect(result.stdout).toContain("审批模式：manual");
    expect(result.stdout).toContain("思考等级：default");
    expect(result.stdout).toContain("会话ID：");
    expect(result.stdout).not.toContain("CodeN 会话");
    expect(result.stdout).not.toContain("输入 /help 查看命令");
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bunx vitest run test/cli.test.ts -t "shows model, approval mode, and thinking" 2>&1 | tail -30`
Expected: FAIL. The test references `i18n.messages.repl.model` values like `模型：gpt-5-mini` which are not yet printed by `repl()`, so `stdout` lacks those substrings.

- [ ] **Step 3: Print the new lines in `src/cli/agent-command.ts`**

In `repl()`, after the workspace hash line (currently `stdout.write(\`${i18n.messages.repl.workspace(application.metadata.workspaceId)}\n\`);`), insert:

```ts
  stdout.write(`${i18n.messages.repl.model(application.metadata.model)}\n`);
  stdout.write(`${i18n.messages.repl.approvalMode(application.metadata.approvalMode)}\n`);
  stdout.write(`${i18n.messages.repl.thinking(application.metadata.thinkingDisplay)}\n`);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bunx vitest run test/cli.test.ts -t "shows model, approval mode, and thinking" 2>&1 | tail -30`
Expected: PASS.

- [ ] **Step 5: Run the full CLI test file**

Run: `bunx vitest run test/cli.test.ts`
Expected: PASS (the resume-banner test at lines ~223-224 still asserts `版本：` and `工作区哈希：` and `已恢复会话 my-session`, none of which break).

- [ ] **Step 6: Run the whole suite and static checks**

Run: `just check`
Expected: all tests PASS; lint/typecheck clean.

- [ ] **Step 7: Commit**

```bash
git add src/cli/agent-command.ts test/cli.test.ts
git commit -m "feat: show model, approval mode, and thinking in CLI banner"
```

---

## Self-Review

- **Spec coverage:** Spec requirements (model line, approval line, thinking line, drop provider, drop `CodeN` prefix, localized) are covered by Task 1 (messages + session edit) and Task 2 (printing + test). No gap.
- **Placeholder scan:** No TBD/TODO; all code blocks contain real content.
- **Type consistency:** `repl.model`, `repl.approvalMode`, `repl.thinking`, `repl.session` names are used identically across Task 1 and Task 2. Metadata fields `model` / `approvalMode` / `thinkingDisplay` match `AgentApplicationMetadata` in `src/cli/agent-application.ts`.
