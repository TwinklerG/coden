---
name: coden-tool-plugin-development
description: Develop, modify, debug, or test CodeN local TypeScript tool plugins. Use this whenever a user mentions a local CodeN plugin, ToolDefinition, custom CodeN tool, or asks how to add a private callable capability to CodeN.
license: MIT
compatibility: CodeN plugin API v1; Bun >=1.1; TypeScript; standard Agent Skills format
---

# CodeN Tool Plugin Development

Build plugins against the public `@twinklerg/coden/plugin` contract. Do not invent unsupported provider, MCP, command, hook, or UI APIs.

## Choose the extension form

- Choose a local TypeScript plugin for one private tool, rapid iteration, or `/reload`.
- If the user needs reusable distribution, versioning, or multiple tools, explain that npm support is the appropriate next variant.
- If the user only needs reusable instructions, suggest an Agent Skill instead of executable code.

If the user already selected a form, do not ask again.

## Required reading

1. Read `references/api-contract.md` for every implementation.
2. Read `references/local-plugin.md` and use `assets/local-tool.ts` as an adaptable starting point.
3. In the CodeN repository, verify details against `src/plugin/index.ts`; outside it, inspect the installed `@twinklerg/coden/plugin` declarations.

Resolve bundled resource paths relative to this Skill directory. This keeps the Skill portable across agents and repository locations.

## Workflow

1. Inspect the target project's instructions, package manager, TypeScript config, and tests.
2. Clarify the tool name, inputs, output, side effects, risk, cancellation needs, and plugin form.
3. Design a closed JSON Schema and keep runtime narrowing for untrusted `unknown` input.
4. Implement without top-level side effects or secret-bearing output.
5. Test success, expected failure, and cancellation when work can be long-running.
6. Run the project's formatter, typecheck, tests, and the form-specific validation.
7. Do not publish, enable lifecycle scripts, or perform destructive plugin operations without explicit confirmation.

## Completion report

Report the chosen form and reason, changed files, tool names and risks, checks run, load or install commands, and residual security or validation risks.
