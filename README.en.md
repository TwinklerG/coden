# CodeN

[中文](README.md) | [English](README.en.md)

<!-- markdownlint-disable MD013 -->

CodeN (Code NJU) is a minimal coding agent implemented independently in TypeScript. It uses providers' native tool calling to read and modify local files and run commands, without an agent framework or server-side code execution.

## Installation and Usage

### Install from npm

```bash
bun add -g @twinklerg/coden     # or npm install -g @twinklerg/coden
coden --version                 # 0.1.8
coden --help
```

The published artifact is a minified, single-file Node CLI (`dist/index.js`). Node is the only runtime requirement; Bun is not required at runtime.

### Run from source

Requirements: [Bun](https://bun.sh/) 1.1+ and [Just](https://github.com/casey/just).

```bash
bun install
just check
```

The source uses only standard Web/Node.js APIs. Bun provides dependency management, scripts, and TypeScript plugin loading.

### Examples

```bash
export CODEN_OPENAI_API_KEY=...
coden "fix the failing tests"
coden -p --auto "implement the feature and run tests"
coden --smart-approve "implement the feature and run tests"
coden --lang en --help          # English for this process only

export CODEN_ANTHROPIC_API_KEY=...
coden --provider anthropic --model claude-sonnet-4-20250514

coden --resume <session-id>
coden --resume                  # list sessions for this workspace
```

Without a prompt, CodeN opens its REPL. Enter submits; Shift+Enter inserts a newline when the terminal distinguishes it. A single trailing `\` continues on every terminal (`\\` preserves one literal backslash). Multiline paste, cross-line cursor movement, and process-local input history are supported.

Commands are `/help`, `/skills`, `/session`, `/sessions`, `/compact`, `/reload`, `/new`, `/lang`, and `/quit`. `/lang` lists `zh`, `en`, and the current language. `/lang en` or `/lang zh` atomically persists the user preference and immediately changes the UI, system prompt, and built-in tool descriptions. The banner shows the version and a 16-character workspace hash.

CodeN has a fixed Chinese default and does not inspect the operating-system locale. `--lang zh|en` overrides only the current process and never writes configuration. The UI, system prompt, and built-in tools share one language. An explicit request for another reply language may be followed for one task without changing UI or persistent preferences. Third-party plugin names, descriptions, output, and errors remain exactly as authored.

Core options are `--lang`, `--provider`, `--model`, `-p/--print`, `--resume [session-id]`, `--smart-approve`, `--auto`, `--allow-outside-workspace`, `--verbose`, `--max-steps`, repeatable `--plugin`, and `--version`.

## Configuration

Ordinary fields use this precedence: CLI > `CODEN_*` environment > `<workspace>/.coden/config.json` > `~/.config/coden/config.json` > defaults.

```json
{
  "language": "en",
  "provider": "openai",
  "model": "gpt-5-mini",
  "approvalModel": "gpt-5-mini",
  "approvalStrictness": "medium",
  "maxSteps": 20,
  "contextWindow": 128000,
  "reservedOutputTokens": 8192,
  "safetyMargin": 4096,
  "plugins": [],
  "env": {
    "CODEN_OPENAI_API_KEY": "sk-..."
  }
}
```

`language` is a user-only preference read exclusively from `~/.config/coden/config.json`. A `language` field in project `.coden/config.json` is ignored and cannot override personal UI or Agent language. Only canonical `zh` and `en` are accepted. `--lang` has highest startup precedence but affects only this process. `/lang <zh|en>` preserves every other configuration field and atomically updates the user file with mode `0600`.

Supported environment variables include `CODEN_PROVIDER`, `CODEN_MODEL`, `CODEN_MAX_STEPS`, `CODEN_OPENAI_API_KEY`, `CODEN_OPENAI_BASE_URL`, `CODEN_ANTHROPIC_API_KEY`, `XDG_CONFIG_HOME`, and `XDG_DATA_HOME`. There is no `CODEN_LANG`.

User and project `env` objects declare environment variables, including secrets. Project values override user values, but neither overrides an already exported shell variable. Keep secrets in ignored `~/.config/coden/` or `.coden/`, never in committed/shared files.

`approvalModel` uses the task provider and credentials, defaulting to `model`. `approvalStrictness` is `soft`, `medium`, or `hard` (default `medium`). Sessions and traces live under `$XDG_DATA_HOME/coden/sessions/<workspace-hash>/`, normally `~/.local/share/coden`.

## Agent Skills

CodeN supports the progressive-disclosure [Agent Skills](https://agentskills.io/specification) layout and scans direct children of:

```text
~/.agents/skills/<skill-name>/SKILL.md
<workspace>/skills/<skill-name>/SKILL.md
<workspace>/.agents/skills/<skill-name>/SKILL.md
```

Later roots override earlier roots. Startup context includes only each valid Skill's author-provided name and description. When a task matches, the model calls `activate_skill` to load the full `SKILL.md` and absolute root. `/skills` lists effective names, descriptions, and `project`/`user` sources without invoking a model. Restart after changing Skill files. Invalid, oversized, or escaping symlink entries are skipped; `--verbose` shows why.

This repository provides [`coden-tool-plugin-development`](skills/coden-tool-plugin-development/SKILL.md):

```bash
npx skills add TwinklerG/CodeN --skill coden-tool-plugin-development
```

## Tools and Permissions

Built-ins are `read`, `write`, `edit`, `bash`, and read-only `activate_skill`. Structured file paths are classified by final real path, including nearest existing parents for new files, to prevent symlink bypasses.

| Mode | Workspace `read`/`write`/`edit` | Outside-workspace `read`/`write`/`edit` |
| --- | --- | --- |
| Default interactive | `read` allowed; `write`/`edit` ask | ask once or for the session as modifications |
| `--smart-approve` | `read` allowed; ordinary changes independently reviewed by an LLM, uncertainty goes to a human | always ask a human |
| `--auto` | allowed | `permission.outside_workspace_denied` |
| `--auto --allow-outside-workspace` | allowed | allowed |

`--allow-outside-workspace` is valid only with `--auto` and controls only structured `read`, `write`, and `edit`. It permits arbitrary text-file changes outside the workspace and should be used only intentionally.

**This is not a general sandbox.** `bash` and TypeScript plugins run with user-process permissions. Risk classification is an accidental-damage guard. Bash timeouts terminate the process group; in-process plugins must cooperate with `AbortSignal`.

## Local TypeScript Plugins

CodeN scans `~/.config/coden/plugins/*.ts`, `<workspace>/.coden/plugins/*.ts`, and paths supplied by `--plugin` or configuration. Project plugins always require first-use workspace trust, even with `--auto`. `/reload` content-hash reloads local plugins and atomically replaces the Registry.

Plugins must be self-contained single files because CodeN loads source through a `data:text/typescript` URL for reliable Bun reloads. Relative imports cannot resolve; package imports can.

```ts
import type { ToolDefinition } from "../../src/core/types.js";

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

Plugin text is not translated. Failures or duplicate names cannot replace built-ins or prevent other plugins from loading.

## npm Plugins

CodeN installs built npm plugins from public npmjs using `npm:<package>` or `npm:<package>@<version-or-tag>`:

```bash
coden plugin install npm:@scope/coden-plugin-example
coden plugin install npm:@scope/coden-plugin-example@^2 --global
coden plugin list
coden plugin sync
coden plugin remove @scope/coden-plugin-example
```

Project manifests/runtimes live under `<workspace>/.coden/`; global plugins live under `$XDG_DATA_HOME/coden/plugins/`. Project npm plugins require workspace trust; global plugins are treated as an explicit user installation.

Lifecycle scripts are disabled by default. `--allow-scripts` permits the package and dependencies to run install scripts with full user permissions; `--yes` skips confirmation but does not enable scripts. Validation imports the entry, so top-level plugin code still runs with full user permissions. npm plugins are not sandboxed. Restart CodeN after npm plugin changes; `/reload` only guarantees local `.ts` reloads.

Plugin packages publish built `.js`/`.mjs`, set `"type": "module"`, and declare:

```json
{
  "name": "@scope/coden-plugin-example",
  "version": "1.0.0",
  "type": "module",
  "files": ["dist"],
  "coden": {
    "apiVersion": 1,
    "plugin": "./dist/index.js"
  }
}
```

Use `import type { CodeNPlugin, ToolDefinition } from "@twinklerg/coden/plugin"`. The `/plugin` subpath is the sole public contract. The package root is a CLI and is not a programmatic library. Published npm files contain the built CLI and generated plugin contract, not `src`.

## Development and Testing

```bash
just fmt
just test
just check
just build
just publish-dry-run
just publish
```

Offline `ScriptedProvider` integration tests cover tool loops, denial, retry, switching, and resume. Live tests are opt-in:

```bash
CODEN_LIVE_TEST=1 CODEN_OPENAI_API_KEY=... bun run test
```
