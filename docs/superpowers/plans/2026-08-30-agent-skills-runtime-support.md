# Agent Skills Runtime Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add standards-compatible Agent Skills discovery/activation and controlled structured-file access outside the workspace.

**Architecture:** A focused `src/skills/` subsystem parses, discovers, merges, renders, and activates skills. Structured file tools share one canonical path resolver; `ToolExecutor` classifies paths before authorization and passes the checked path contract to built-ins for execution-time revalidation.

**Tech Stack:** TypeScript, Node.js filesystem APIs, `yaml`, Commander, Vitest, Bun, Biome, Just.

**Spec:** `docs/superpowers/specs/2026-08-30-agent-skills-runtime-support-design.md`

## Global Constraints

- Scan only `~/.agents/skills/<skill-name>/SKILL.md` and `<workspace>/.agents/skills/<skill-name>/SKILL.md` direct children.
- Project skills override same-named user skills.
- `SKILL.md` is limited to 1 MiB; `name` is 1–64 lowercase alphanumeric/hyphen characters and must match its directory; `description` is non-empty and at most 1024 characters.
- `allowed-tools` is metadata only and never changes CodeN permissions.
- `--allow-outside-workspace` is valid only with `--auto` and affects only `read`, `write`, and `edit`; `bash` remains unchanged.
- Do not expand the npm publish file set beyond the existing `dist` entries.
- Preserve the user's existing uncommitted `skills-lock.json` change.

---

### Task 1: Skill parsing, discovery, and registry

**Files:**
- Create: `src/skills/types.ts`
- Create: `src/skills/parser.ts`
- Create: `src/skills/discovery.ts`
- Create: `src/skills/registry.ts`
- Create: `test/skills.test.ts`
- Modify: `package.json`
- Modify: `bun.lock`

**Interfaces:**
- Produces: `SkillParser.parse(candidate): Promise<Skill>`, `SkillDiscovery.discover(): Promise<SkillDiscoveryResult>`, and `SkillRegistry.get/list/activate`.
- `Skill` records normalized metadata, `user | project` scope, lexical candidate paths, and discovered canonical paths for later safety revalidation.

- [ ] **Step 1: Add RED tests for valid/optional metadata, invalid entries, size limits, direct-child discovery, symlink escape rejection, stable sorting, and project override.**

```ts
const result = await new SkillDiscovery({ workspace, home }).discover();
expect(result.registry.list().map(({ name, scope }) => [name, scope])).toEqual([
  ["alpha", "user"],
  ["shared", "project"],
]);
expect(result.failures).toEqual(expect.arrayContaining([expect.objectContaining({ reason: expect.any(String) })]));
```

- [ ] **Step 2: Run `bun run test test/skills.test.ts` and verify missing-module failures.**

- [ ] **Step 3: Add `yaml` and implement bounded frontmatter parsing plus isolated two-scope discovery.**

```ts
export interface Skill {
  name: string;
  description: string;
  scope: "user" | "project";
  rootPath: string;
  entryPath: string;
  rootRealPath: string;
  entryRealPath: string;
  license?: string;
  compatibility?: string;
  metadata?: Record<string, string>;
  allowedTools?: string;
}
```

- [ ] **Step 4: Implement deterministic registry merging and activation-time canonical path/size revalidation.**

- [ ] **Step 5: Run `bun run test test/skills.test.ts` and verify PASS.**

### Task 2: Skill activation tool, prompt catalog, session refresh, and REPL command

**Files:**
- Create: `src/skills/prompt.ts`
- Create: `src/tools/builtin/activate-skill.ts`
- Modify: `src/tools/builtin/index.ts`
- Modify: `src/cli/agent-command.ts`
- Modify: `test/skills.test.ts`
- Modify: `test/cli.test.ts`
- Modify: `test/runtime.integration.test.ts`

**Interfaces:**
- Consumes: `SkillRegistry.get/list/activate` from Task 1.
- Produces: `createActivateSkillTool(registry)`, `formatSkillCatalog(registry)`, and `formatSkillsList(registry)`.

- [ ] **Step 1: Add RED tests proving startup prompt contains only name/description, activation returns full content/root, unknown/changed skills return stable tool errors, and `/skills` output is sorted and source-labelled.**

```ts
expect(formatSkillCatalog(registry)).toContain("- testing: Use for tests.");
expect(formatSkillCatalog(registry)).not.toContain("# Full instructions");
expect((await activate.execute({ name: "testing" }, context)).content).toContain("Skill root:");
```

- [ ] **Step 2: Run the focused skill, CLI, and runtime tests and verify RED.**

- [ ] **Step 3: Register `activate_skill` as a reserved built-in and append the catalog to the current system prompt.**

- [ ] **Step 4: On resume, replace only the recovered primary system prompt with the newly constructed prompt while retaining historical user/assistant/tool messages.**

- [ ] **Step 5: Add `/skills` to command classification, `/help`, and direct registry rendering without invoking the model.**

- [ ] **Step 6: Run the focused tests and verify PASS.**

### Task 3: Canonical structured-file path policy and outside-workspace authorization

**Files:**
- Modify: `src/plugin/index.ts`
- Modify: `src/permissions/workspace.ts`
- Modify: `src/permissions/policy.ts`
- Modify: `src/tools/executor.ts`
- Modify: `src/tools/builtin/read.ts`
- Modify: `src/tools/builtin/write.ts`
- Modify: `src/tools/builtin/edit.ts`
- Modify: `src/cli/index.ts`
- Modify: `src/cli/agent-command.ts`
- Modify: `test/tools.test.ts`
- Modify: `test/runtime.integration.test.ts`
- Modify: `test/cli.test.ts`

**Interfaces:**
- Produces: `resolveStructuredFilePath(workspace, requested): Promise<ResolvedFilePath>` with `{ requested, path, scope: "inside" | "outside" }` and execution-time `revalidateStructuredFilePath`.
- `ToolExecutor` classifies structured-file paths before authorization; outside interactive access uses risk `modify`; auto mode denies unless its dedicated option is enabled.

- [ ] **Step 1: Add RED path tests for existing external targets, new external files, inside/outside symlinks, and dangling-link ancestry.**

```ts
expect((await resolveStructuredFilePath(workspace, externalFile)).scope).toBe("outside");
expect((await resolveStructuredFilePath(workspace, "inside.txt")).scope).toBe("inside");
```

- [ ] **Step 2: Add RED executor tests for interactive `allow_once`/`allow_session`/deny per tool, auto denial error code, auto+allow execution, and unchanged bash behavior.**

- [ ] **Step 3: Implement canonical resolution by final realpath or nearest existing real parent, including dangling symlink traversal and stable execution-time revalidation.**

- [ ] **Step 4: Override outside structured-file risk to `modify`, preserve tool-name session grants, and emit failed tool completion events for automatic outside denial.**

- [ ] **Step 5: Add `--allow-outside-workspace`, reject it without `--auto` as `ConfigError`, and thread the setting into `ToolExecutor`.**

- [ ] **Step 6: Run focused tests and verify PASS.**

### Task 4: Documentation and full acceptance

**Files:**
- Modify: `README.md`
- Modify: `package.json` only if dependency metadata was not completed in Task 1
- Verify: `dist/` and npm dry-run manifest

**Interfaces:**
- Documents the exact Agent Skills compatibility and structured-file permission matrix delivered by Tasks 1–3.

- [ ] **Step 1: Document search paths, override order, minimal `SKILL.md`, progressive activation, `/skills`, the permission matrix, risk warning, and unchanged `bash` boundary.**

- [ ] **Step 2: Run `bun run format` and inspect formatting changes.**

- [ ] **Step 3: Run `just check` and fix every lint, type, and test failure.**

- [ ] **Step 4: Run `just build` and `just publish-dry-run`; verify only `dist/index.js`, `dist/plugin/index.js`, `dist/plugin/index.d.ts`, and package metadata/LICENSE are published.**

- [ ] **Step 5: Inspect `git diff --check`, `git status --short`, and the final diff; confirm `skills-lock.json` remains the user's untouched pre-existing change.**
