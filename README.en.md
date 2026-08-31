# CodeN

[中文](README.md) | [English](README.en.md)

<!-- markdownlint-disable MD013 -->

**A coding agent built around pluggable tool plugins.**

CodeN uses provider-native tool calling to read and modify files and run commands locally. Its agent core stays small and inspectable, so you can complete real coding work while understanding and shaping how model requests, tools, permissions, context, and sessions fit together.

## Features

- **Pluggable tools:** extend the model's action space with local TypeScript or npm plugins.
- **Inspectable mechanics:** the agent loop, context compaction, approvals, and session recovery have explicit boundaries.
- **Composable extension:** Plugins add actions, Skills supply method knowledge, and Hooks add deterministic lifecycle control.
- **Local first:** code and tools run on your machine, without server-side code execution.

## Quick start

```bash
bun add -g @twinklerg/coden     # or npm install -g @twinklerg/coden
export CODEN_OPENAI_API_KEY=...
coden "inspect this project, fix the failing tests, and verify the result"
```

The published CLI requires **Node.js 22+**. Plain `coden` starts the continuous-output CLI/REPL. Use `coden --tui` to request the full-screen TUI explicitly, or `coden -p --auto "..."` for one-turn, pipeable execution.

```bash
export CODEN_ANTHROPIC_API_KEY=...
coden --provider anthropic --model claude-sonnet-4-20250514

coden --smart-approve "refactor this module and run its tests"
coden --resume                 # list sessions for this workspace
coden --resume <session-id>    # resume one session
```

See [Get started](https://twinklerg.github.io/coden/en/docs/start/overview/) for installation, providers, interfaces, and runtime requirements.

## Shape the agent with tool plugins

A tool plugin adds a structured action to the tool set visible to the model. npm plugins target the public `@twinklerg/coden/plugin` contract:

```ts
import type { ToolDefinition } from "@twinklerg/coden/plugin";

const tool: ToolDefinition = {
  name: "line_count",
  description: "Count lines in supplied text",
  risk: "read",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["text"],
    properties: { text: { type: "string" } },
  },
  async execute(input) {
    const { text } = input as { text: string };
    return { content: String(text.split("\n").length) };
  },
};

export default tool;
```

```bash
coden plugin install npm:@scope/coden-plugin-example
coden plugin list
coden plugin sync
```

- **Local `.ts` plugins** optimize for experiments, require Bun, and currently must be self-contained single files.
- **npm plugins** publish built ESM. Node or Bun can load them, but installation and synchronization invoke `bun install`.
- Restart after installing or updating a plugin. `/reload` guarantees reload only for local TypeScript plugins.

Read the [tool plugin execution model](https://twinklerg.github.io/coden/en/docs/extend/tool-plugins/), [plugin authoring guide](https://twinklerg.github.io/coden/en/docs/extend/plugin-authoring/), and [plugin marketplace](https://twinklerg.github.io/coden/en/plugins/).

## Choose the right extension

| Goal | Mechanism | Layer changed |
| --- | --- | --- |
| Add an action the model can call | Tool Plugin | Agent action space |
| Teach the model a specialized workflow | Skill | Agent method and context |
| Run deterministic logic at lifecycle events | Hook | Runtime control and policy |
| Supply durable project constraints | `AGENTS.md` | Startup context and behavior |

See [Choose an extension](https://twinklerg.github.io/coden/en/docs/extend/choose-an-extension/).

## Current boundaries

- Providers: OpenAI and Anthropic; you choose the model ID.
- Built-in tools: `read`, `write`, `edit`, and `bash`, plus `activate_skill` when a valid Skill exists.
- Approval: manual, Smart Approval, and auto. These are approval policies, not sandbox levels.
- Sessions: workspace-partitioned JSONL that restores conversation, thinking level, and provider state.
- Interfaces: default CLI/REPL, explicit TUI, and one-turn print mode.
- CodeN currently has no built-in subagents, MCP, plan mode, or general security sandbox.

## Security

**`bash`, tool plugins, and Hooks run with current user-process privileges. They are not a security sandbox.** Project plugins and Hooks require workspace trust, but trust prompts, tool `risk`, Smart Approval, and `--auto` cannot contain malicious code. Install and execute only code you are willing to run as the current account. Use a container, virtual machine, or restricted account when you need strong isolation.

Sessions and traces can contain prompts, source code, tool inputs and outputs, and model reasoning. Keep them private and do not share them without review. Read [Security boundaries](https://twinklerg.github.io/coden/en/docs/safety/security-boundaries/).

## Documentation and development

- [English documentation](https://twinklerg.github.io/coden/en/docs/)
- [中文文档](https://twinklerg.github.io/coden/zh/docs/)
- [Plugin marketplace](https://twinklerg.github.io/coden/en/plugins/)
- [Plugin protocol reference](https://twinklerg.github.io/coden/en/docs/reference/plugins/)

```bash
git clone https://github.com/TwinklerG/CodeN.git
cd CodeN
bun install
just check
just website-check
just build
```

The repository uses Just as its command runner, Bun as its JS/TS toolchain, and Biome for linting and formatting. Source code avoids Bun-specific APIs. MIT License.
