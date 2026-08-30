# CodeN Prompt and i18n Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the approved bilingual prompt and i18n design, including startup selection, runtime language switching, localized built-ins/application text, and equivalent bilingual README files.

**Architecture:** A shared mutable `I18n` object owns only the active `zh | en` state and typed message catalog. Startup bootstrap resolves CLI override over the user-only preference before Commander builds help; runtime consumers receive the same object, while persistence remains isolated in an atomic config writer. Stable machine identifiers and third-party plugin content remain unchanged.

**Tech Stack:** TypeScript, Node.js standard APIs, Commander, Vitest, Bun build tooling, Biome.

**Spec:** `docs/superpowers/specs/2026-08-30-coden-prompt-i18n-design.md`

## Global Constraints

- Supported language codes are exactly `zh` and `en`, in that order; the fixed default is `zh`.
- Resolution order is CLI `--lang` > user `config.json` language > `zh`; project `language` is ignored.
- `/lang` persists atomically with mode `0600` before changing in-memory state.
- Switching language changes subsequent CodeN UI, main system prompt, compact/reviewer prompts, and built-in tool descriptions without rewriting conversation history.
- Tool names, schemas, protocol values, error codes, event payloads, plugin APIs, and third-party text remain stable.
- Use no Bun-only runtime API and add no runtime dependency.
- Preserve unrelated working-tree changes, especially `docs/superpowers/plans/2026-08-30-agent-lifecycle-hooks.md`.

---

### Task 1: Typed language core and user preference persistence

**Files:**
- Create: `src/i18n/index.ts`
- Create: `src/i18n/i18n.ts`
- Create: `src/i18n/config.ts`
- Create: `src/i18n/locales/zh.ts`
- Create: `src/i18n/locales/en.ts`
- Modify: `src/config/config.ts`
- Test: `test/i18n.test.ts`
- Test: `test/config.test.ts`

**Interfaces:**
- Produces: `Language`, `SUPPORTED_LANGUAGES`, `DEFAULT_LANGUAGE`, `isLanguage`, `I18n`, `resolveStartupLanguage(argv, configPath?)`, and `saveUserLanguage(language, configPath?)`.
- Produces: `CodeNConfig.language: Language` and `ConfigOverrides.language?: Language`, with project-language exclusion explicit in `loadConfig`.

- [ ] **Step 1: Write failing tests** for fixed Chinese default, stable supported order, live catalog switching, invalid-language rejection, user-only config resolution, CLI precedence, preservation of unknown config keys, trailing newline, `0600`, non-object rejection, and failed-write non-corruption.
- [ ] **Step 2: Run focused tests** with `./node_modules/.bin/vitest run test/i18n.test.ts test/config.test.ts`; expect failures caused by missing i18n exports.
- [ ] **Step 3: Implement the typed catalogs and state** using a recursive widening mapped type so `en` must satisfy the keys and function signatures of `zh`; `I18n.setLanguage` validates before synchronously replacing state.
- [ ] **Step 4: Implement startup/config I/O** with `node:fs/promises`: parse only pre-`--` `--lang value` and `--lang=value`, validate the user root object, write a same-directory unique temp file with `{ mode: 0o600 }`, rename, chmod the final file, and unlink the temp path in `finally`.
- [ ] **Step 5: Integrate config merge rules** so only the user source contributes `language`, CLI can override it, and project `language` is neither merged nor validated.
- [ ] **Step 6: Re-run focused tests and typecheck** with `./node_modules/.bin/vitest run test/i18n.test.ts test/config.test.ts && ./node_modules/.bin/tsc --noEmit`; expect pass.

### Task 2: Localized prompts, built-ins, and runtime replacement

**Files:**
- Create: `src/i18n/prompts.ts`
- Modify: `src/core/runtime.ts`
- Modify: `src/skills/prompt.ts`
- Modify: `src/permissions/reviewer.ts`
- Modify: `src/tools/builtin/index.ts`
- Modify: `src/tools/builtin/read.ts`
- Modify: `src/tools/builtin/write.ts`
- Modify: `src/tools/builtin/edit.ts`
- Modify: `src/tools/builtin/bash.ts`
- Modify: `src/tools/builtin/activate-skill.ts`
- Test: `test/i18n.test.ts`
- Test: `test/runtime.integration.test.ts`
- Test: `test/approval-reviewer.test.ts`
- Test: `test/tools.test.ts`

**Interfaces:**
- Consumes: shared `I18n` and typed messages from Task 1.
- Produces: `buildSystemPrompt(i18n, projectInstructions, skillCatalog)`, `AgentRuntime.updateSystemPrompt(content): void`, localized compact/reviewer prompt builders, and `builtinTools(skills, i18n)`.

- [ ] **Step 1: Add failing tests** asserting equivalent full Chinese/English behavior contracts, untranslated project/Skill author content, exact stable reviewer decisions, localized reviewer reason instruction, localized compact labels, updated first system message only, reset preservation, and bilingual built-in descriptions with unchanged names/schemas/error codes.
- [ ] **Step 2: Run the four focused suites** and verify the new assertions fail.
- [ ] **Step 3: Implement natural-language prompt builders** covering identity/language, instruction hierarchy and deeper `AGENTS.md`, inspection/planning/progress, actual tools and Skill activation, safety/permissions, focused verification, and concise delivery without mentioning unavailable capabilities.
- [ ] **Step 4: Implement runtime prompt replacement** by replacing or inserting only the first main system message; preserve all non-system messages and `ContextManager` summaries, and have `reset()` retain the current replacement.
- [ ] **Step 5: Convert built-ins to per-language factories** so a rebuilt built-in array contains localized descriptions/results while stable machine structure is unchanged; never transform loaded plugin definitions.
- [ ] **Step 6: Localize Skill wrappers, compact refinement, and approval prompts** while retaining untrusted payload boundaries and exact JSON protocol values.
- [ ] **Step 7: Re-run focused tests and typecheck**; expect pass.

### Task 3: Startup CLI and atomic REPL hot switching

**Files:**
- Modify: `src/cli/index.ts`
- Modify: `src/cli/agent-command.ts`
- Modify: `src/cli/plugin-command.ts`
- Modify: `src/cli/format.ts`
- Modify: `src/observability/terminal.ts`
- Modify: other first-party output modules identified by the hard-coded-message audit
- Test: `test/cli.test.ts`
- Test: `test/runtime.integration.test.ts`
- Test: relevant terminal/plugin/permission suites

**Interfaces:**
- Consumes: Task 1 startup/persistence APIs and Task 2 prompt/tool factories.
- Produces: async executable bootstrap, injectable `createCliProgram({ i18n, ... })`, formal `--lang <zh|en>`, and `/lang [zh|en]` command handling.

- [ ] **Step 1: Add failing CLI/REPL tests** for default Chinese help, pre-action English help, both option forms and `--` behavior, invalid-value fallback language, `/help`, stable `/lang` listing, successful persistence-before-switch, invalid/failing persistence rollback, next-request prompt/tools, reload preservation, `/new`, and resume replacement.
- [ ] **Step 2: Run affected tests** and verify failures are attributable to missing CLI integration.
- [ ] **Step 3: Add asynchronous startup bootstrap** that resolves the language before creating Commander, injects one shared `I18n`, formally registers `--lang`, and passes the resolved language into `loadConfig` without persisting CLI overrides.
- [ ] **Step 4: Implement serialized `/lang`**: validate in the old language, await atomic persistence, prebuild replacement prompt/built-ins, update the shared language and built-ins/runtime, rollback on unexpected rebuild failure, then confirm in the new language.
- [ ] **Step 5: Localize first-party CLI/REPL/permission/session/terminal/plugin fixed text** through catalog functions, preserving external strings and terminal sanitization paths.
- [ ] **Step 6: Audit hard-coded first-party prose** with `rg -n '"[A-Za-z][^"\\n]{12,}"' src`; move user/model-facing prose into catalogs or an explicitly bilingual prompt builder, leaving machine/external allowlisted strings intact.
- [ ] **Step 7: Re-run all affected tests and typecheck**; expect pass.

### Task 4: Equivalent bilingual documentation and audit tests

**Files:**
- Modify: `README.md`
- Create: `README.en.md`
- Test: `test/i18n-audit.test.ts`

**Interfaces:**
- Documents: default Chinese behavior, process-only `--lang`, user-only `language`, persistent/immediate `/lang`, shared prompt/tool/UI language, explicit user reply-language override, and unchanged third-party text.

- [ ] **Step 1: Add a failing documentation audit** requiring the reciprocal language links plus the same key commands and configuration values in both files.
- [ ] **Step 2: Rewrite the directly relevant README sections** in Chinese, fix the displayed version to the current package version, add the reciprocal link under the title, and document all language semantics from the spec.
- [ ] **Step 3: Create a complete content-equivalent English README** with the reciprocal link and identical commands, configuration keys, protocol values, and caveats.
- [ ] **Step 4: Run the audit and markdown/TypeScript checks**; expect pass.

### Task 5: Final regression and Node artifact acceptance

**Files:**
- Modify only files required to fix failures caused by Tasks 1–4.

**Interfaces:**
- Produces: shippable bilingual CLI with no protocol or plugin regression.

- [ ] **Step 1: Run `just check`** and fix only feature-related failures; record unrelated failures without broadening scope.
- [ ] **Step 2: Run `just build`** and verify the minified Node-target artifact builds.
- [ ] **Step 3: Run `node dist/index.js --help`** and verify Chinese help including `--lang`.
- [ ] **Step 4: Run `node dist/index.js --lang en --help`** and verify English help before any action/API-key requirement.
- [ ] **Step 5: Run an isolated `XDG_CONFIG_HOME` REPL smoke test** through `/lang`, `/lang en`, and `/help`; verify preserved config fields, immediate English output, trailing newline, and file mode `0600`.
- [ ] **Step 6: Inspect `git diff --check` and `git status --short`**; ensure no generated artifacts, staged files, or unrelated user files were changed.
