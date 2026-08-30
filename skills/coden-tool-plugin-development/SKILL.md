---
name: coden-tool-plugin-development
description: Create, modify, debug, test, package, or prepare publishing for CodeN local TypeScript and npm-distributed tool plugins. Use whenever a user mentions a CodeN plugin, custom callable tool, ToolDefinition, CodeNPlugin, local .ts plugin, npm plugin distribution, or plugin release validation.
license: MIT
compatibility: CodeN plugin API v1; Bun >=1.1; TypeScript; standard Agent Skills format
---

# CodeN Tool Plugin Development

Build plugins against the public `@twinklerg/coden/plugin` contract. Do not invent unsupported provider, MCP, command, hook, or UI APIs.

## Choose the extension form

- Choose a local TypeScript plugin for one private tool, rapid iteration, or `/reload`.
- Choose an npm plugin for reusable distribution, multiple source files, semantic versioning, managed dependencies, or multiple tools.
- If the user only needs reusable instructions, suggest an Agent Skill instead of executable code.

If the user already selected a form, do not ask again.

## Required reading

1. Read `references/api-contract.md` for every implementation.
2. For a local plugin, read `references/local-plugin.md` and adapt `assets/local-tool.ts`.
3. For npm distribution, read `references/npm-plugin.md`.
4. Start from `assets/npm-single-tool.ts` for one exported tool or `assets/npm-multi-tool.ts` for a `CodeNPlugin` containing multiple tools.
5. Adapt `assets/npm-package.json` and `assets/npm-tsconfig.json`; do not copy package names or dependency versions blindly.
6. In the CodeN repository, verify details against `src/plugin/index.ts`; outside it, inspect the installed `@twinklerg/coden/plugin` declarations.

Resolve bundled resource paths relative to this Skill directory. This keeps the Skill portable across agents and repository locations.

## Workflow

1. Inspect the target project's instructions, package manager, TypeScript config, and tests.
2. Clarify the tool name, inputs, output, side effects, risk, cancellation needs, and plugin form.
3. Design a closed JSON Schema and keep runtime narrowing for untrusted `unknown` input.
4. Implement without top-level side effects or secret-bearing output.
5. Test success, expected failure, and cancellation when work can be long-running.
6. Run the project's formatter, typecheck, tests, and the form-specific validation.
7. For npm packages, build, inspect `dist`, run `npm pack --dry-run` only after checking lifecycle scripts, and report the CodeN install command.
8. Do not publish, enable lifecycle scripts, install, remove, sync, or perform other destructive plugin operations without explicit confirmation.

## Completion report

Report the chosen form and reason, changed files, tool names and risks, checks run, load or install commands, and residual security or validation risks.
