# CLI Startup Banner Info Design

## Problem

The interactive CLI (`repl` in `src/cli/agent-command.ts`) currently prints only the ASCII banner, `版本`/`Version`, `工作区哈希`/`Workspace hash`, and a session line at startup. `AgentApplication.metadata` already carries `model`, `approvalMode`, and a resolvable thinking display level, but these are not shown. Users want to see the effective model, approval mode, and thinking level immediately on launch.

This is a presentation-only change; runtime behavior, requests, and permissions are unaffected.

## Requirements

- On interactive CLI startup, show the resolved **model**, **approval mode**, and **thinking level**.
- Do **not** show the provider (explicitly excluded).
- The final session line is `Session ID: <id>` (zh `会话ID：<id>`) — no `CodeN` prefix and no inline help hint.
- Keep the existing `版本`/`Version` and `工作区哈希`/`Workspace hash` lines.
- Localize new labels in both `zh` and `en`.
- The thinking level uses `metadata.thinkingDisplay` so OpenAI's `off→minimal` mapping shows correctly; the approval mode shows the raw `auto` / `smart` / `manual` value.
- Do not change `--print`, `--tui`, non-interactive, or permission-prompt behavior.

## Approach

Extend the startup block printed in `repl()` to include two additional labeled lines between the workspace hash and the session line: model and approval mode, then the thinking level. Drop the provider line, and render the final session line as `Session ID: <id>` (zh `会话ID：<id>`).

Output shape:

```
 ██████╗ ██████╗ ██████╗ ███████╗███╗   ██╗
██╔════╝██╔═══██╗██╔══██╗██╔════╝████╗  ██║
██║     ██║   ██║██║  ██║█████╗  ██╔██╗ ██║
██║     ██║   ██║██║  ██║██╔══╝  ██║╚██╗██║
╚██████╗╚██████╔╝██████╔╝███████╗██║ ╚████║
 ╚═════╝ ╚═════╝ ╚═════╝ ╚══════╝╚═╝  ╚═══╝
版本：0.1.8
工作区哈希：<hash>
模型：claude-xxxx
审批模式：manual
思考等级：high
会话ID：<id>
```

## Components

### i18n messages (`src/i18n/locales/en.ts`, `src/i18n/locales/zh.ts`)

Add to the `repl` namespace:

- `model: (model: string) => string` — `模型：${model}` / `Model: ${model}`
- `approvalMode: (mode: string) => string` — `审批模式：${mode}` / `Approval: ${mode}`
- `thinking: (level: string) => string` — `思考等级：${level}` / `Thinking: ${level}`

Edit `session` to `会话ID：${id}` / `Session ID: ${id}`.

The `resumedHelp` message (`输入 /help 查看命令。` / `Type /help for commands.`) is unchanged; the resume path still prints it separately.

### `repl()` (`src/cli/agent-command.ts`)

After the workspace hash line, write:

- `application.metadata.model`
- `application.metadata.approvalMode`
- `application.metadata.thinkingDisplay`

All using the new `repl.*` messages, each with a trailing newline. Remove the `CodeN` from the session line by updating its i18n message source (no code change needed at the call site).

## Data Flow

`AgentApplicationMetadata` already exposes `model`, `approvalMode`, and `thinkingDisplay`, so `repl()` reads them directly — no new fields or plumbing required. The `thinkingDisplay` is computed once during `createAgentApplication` via `resolveThinkingStatus`, which remains the source of truth.

## Error Handling

None new. The new lines are printed from already-resolved metadata; no I/O, configuration, or provider interaction is added. If any value were missing, the existing metadata construction guarantees the strings are present.

## Testing

Extend `test/cli.test.ts` assertions. Under `baseEnv` (which clears `CODEN_*`), the defaults are provider `openai`, model `gpt-5-mini`, approval mode `manual`, and thinking level `default` (display `default`). Confirm the interactive startup banner contains:

- `模型：gpt-5-mini`;
- `审批模式：manual`;
- `思考等级：default`;
- a session line of the form `会话ID：<id>` (assert `会话ID：` is present and `CodeN 会话` is absent);
- the session line no longer contains the inline help hint.

The existing resume-banner test should be updated: keep `版本：`/`工作区哈希：` assertions, add the `模型：`/`审批模式：`/`思考等级：` assertions, and assert the session line uses `会话ID：` with no `CodeN` prefix.
