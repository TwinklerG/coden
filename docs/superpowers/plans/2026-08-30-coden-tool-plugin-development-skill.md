# CodeN Tool Plugin Development Skill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a tracked project Agent Skill that guides developers through implementing, testing, loading, packaging, and validating CodeN local TypeScript and npm-distributed tool plugins.

**Architecture:** Keep `SKILL.md` as a concise workflow router, move stable API and variant-specific rules into `references/`, and provide concrete copyable examples in `assets/`. Add repository tests that discover and activate the real Skill, validate progressive-disclosure links and package metadata, and syntax-check every TypeScript template.

**Tech Stack:** Agent Skills Markdown/YAML, TypeScript, JSON Schema, Bun, Vitest, TypeScript compiler API, Biome, Just

**Spec:** `docs/superpowers/specs/2026-08-30-coden-tool-plugin-development-skill-design.md`

## Global Constraints

- Track only `.agents/skills/coden-tool-plugin-development/`; keep all other locally installed `.agents/skills/` ignored.
- Use `coden-tool-plugin-development` as both the directory name and Skill frontmatter `name`.
- Keep `SKILL.md` below 500 lines and use progressive disclosure.
- Treat `src/plugin/index.ts` and the installed `@twinklerg/coden/plugin` declaration as the only public contract sources.
- Support local single-file `ToolDefinition`, npm single-tool `ToolDefinition`, and npm multi-tool `CodeNPlugin` with plugin API version `1`.
- Use standard Web/Node.js APIs and TypeScript; recommend Bun tooling without using Bun-only runtime APIs.
- Do not add Provider, MCP, Slash Command, event-hook, or terminal-renderer extension instructions.
- Do not execute `npm publish`, destructive plugin operations, or lifecycle scripts without explicit user confirmation.
- Do not create or run Skill baseline/evaluation workspaces.
- Preserve the user's existing uncommitted `skills-lock.json` change; do not stage it.

---

## File Map

- Modify `.gitignore` so only the official Skill is re-included beneath `.agents/skills/`.
- Create `.agents/skills/coden-tool-plugin-development/SKILL.md` as the workflow and routing entry point.
- Create `.agents/skills/coden-tool-plugin-development/references/api-contract.md` for API v1 invariants shared by both plugin forms.
- Create `.agents/skills/coden-tool-plugin-development/references/local-plugin.md` for local loader constraints and validation.
- Create `.agents/skills/coden-tool-plugin-development/references/npm-plugin.md` for npm package layout, metadata, build, install, and release checks.
- Create `.agents/skills/coden-tool-plugin-development/assets/local-tool.ts` as a valid local single-file example.
- Create `.agents/skills/coden-tool-plugin-development/assets/npm-single-tool.ts` as a valid npm single-tool entry example.
- Create `.agents/skills/coden-tool-plugin-development/assets/npm-multi-tool.ts` as a valid npm multi-tool entry example.
- Create `.agents/skills/coden-tool-plugin-development/assets/npm-package.json` as valid ESM package metadata.
- Create `.agents/skills/coden-tool-plugin-development/assets/npm-tsconfig.json` as strict portable TypeScript configuration.
- Create `test/plugin-development-skill.test.ts` as the content, discovery, syntax, and metadata contract test.

### Task 1: Discoverable Local Plugin Development Skill

**Files:**
- Modify: `.gitignore`
- Create: `.agents/skills/coden-tool-plugin-development/SKILL.md`
- Create: `.agents/skills/coden-tool-plugin-development/references/api-contract.md`
- Create: `.agents/skills/coden-tool-plugin-development/references/local-plugin.md`
- Create: `.agents/skills/coden-tool-plugin-development/assets/local-tool.ts`
- Create: `test/plugin-development-skill.test.ts`

**Interfaces:**
- Consumes: `SkillDiscovery`, `SkillRegistry.activate(name)`, and the public types in `src/plugin/index.ts`.
- Produces: a project Skill named `coden-tool-plugin-development`, shared API guidance, and a local single-file tool template; Task 2 extends the same Skill and test file with npm support.

- [ ] **Step 1: Write the failing discovery and local-content tests**

Create `test/plugin-development-skill.test.ts` with helpers that resolve the repository root, read Skill resources, and syntax-check TypeScript templates:

```ts
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { afterEach, describe, expect, it } from "vitest";
import { SkillDiscovery } from "../src/skills/discovery.js";

const workspace = fileURLToPath(new URL("..", import.meta.url));
const skillRoot = path.join(
  workspace,
  ".agents",
  "skills",
  "coden-tool-plugin-development",
);
const temporaryDirectories: string[] = [];

async function resource(relativePath: string): Promise<string> {
  return readFile(path.join(skillRoot, relativePath), "utf8");
}

function syntaxErrors(source: string): string[] {
  const result = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      strict: true,
    },
    reportDiagnostics: true,
  });
  return (result.diagnostics ?? [])
    .filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error)
    .map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"));
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("CodeN tool plugin development skill", () => {
  it("is tracked as a discoverable project skill with progressive local guidance", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "coden-plugin-skill-home-"));
    temporaryDirectories.push(home);
    const discovery = await new SkillDiscovery({ workspace, home }).discover();
    const skill = discovery.registry.get("coden-tool-plugin-development");

    expect(skill).toMatchObject({
      name: "coden-tool-plugin-development",
      scope: "project",
    });
    expect(skill?.description).toContain("CodeN");
    expect(skill?.description).toContain("local TypeScript");

    const activated = await discovery.registry.activate("coden-tool-plugin-development");
    expect(activated.content.split("\n").length).toBeLessThan(500);
    expect(activated.content).toContain("references/api-contract.md");
    expect(activated.content).toContain("references/local-plugin.md");
    expect(activated.content).toContain("assets/local-tool.ts");
  });

  it("documents and templates the actual local plugin loader contract", async () => {
    const [api, local, template, gitignore] = await Promise.all([
      resource("references/api-contract.md"),
      resource("references/local-plugin.md"),
      resource("assets/local-tool.ts"),
      readFile(path.join(workspace, ".gitignore"), "utf8"),
    ]);

    expect(api).toContain('export type ToolRisk = "read" | "modify" | "dangerous"');
    expect(api).toContain("signal: AbortSignal");
    expect(api).toContain("CODEN_PLUGIN_API_VERSION = 1");
    expect(local).toContain(".coden/plugins/*.ts");
    expect(local).toContain("自包含单文件");
    expect(local).toContain("/reload");
    expect(template).toContain(
      'import type { ToolDefinition } from "@twinklerg/coden/plugin"',
    );
    expect(template).toContain('risk: "read"');
    expect(template).not.toMatch(/from\s+["']\.\.?\//);
    expect(syntaxErrors(template)).toEqual([]);
    expect(gitignore).toContain(".agents/skills/*");
    expect(gitignore).toContain("!.agents/skills/coden-tool-plugin-development/");
    expect(gitignore).toContain("!.agents/skills/coden-tool-plugin-development/**");
  });
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
bun run vitest test/plugin-development-skill.test.ts
```

Expected: FAIL because `coden-tool-plugin-development` and its resources do not exist.

- [ ] **Step 3: Change the Skill ignore rules without exposing installed third-party Skills**

Replace the existing `.agents/skills/` rule in `.gitignore` with:

```gitignore
.agents/skills/*
!.agents/skills/coden-tool-plugin-development/
!.agents/skills/coden-tool-plugin-development/**
```

Verify the intended behavior:

```bash
if git check-ignore -q --no-index .agents/skills/coden-tool-plugin-development/SKILL.md; then
  echo "official skill is still ignored" >&2
  exit 1
fi
git check-ignore -q --no-index .agents/skills/example-installed-skill/SKILL.md
```

Expected: the first check does not enter its error branch, and the second command succeeds because `skill-creator` remains ignored.

- [ ] **Step 4: Write the concise workflow entry point**

Create `SKILL.md` with this structure and imperative workflow:

```markdown
---
name: coden-tool-plugin-development
description: Develop, modify, debug, or test CodeN local TypeScript tool plugins. Use this whenever a user mentions a local CodeN plugin, ToolDefinition, custom CodeN tool, or asks how to add a private callable capability to CodeN.
compatibility: CodeN plugin API v1; Bun >=1.1; TypeScript
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

## Workflow

1. Inspect the target project's instructions, package manager, TypeScript config, and tests.
2. Clarify the tool name, inputs, output, side effects, risk, cancellation needs, and plugin form.
3. Design a closed JSON Schema and keep runtime narrowing for untrusted `unknown` input.
4. Implement without top-level side effects or secret-bearing output.
5. Test success, expected failure, and cancellation when work can be long-running.
6. Run the project's formatter, typecheck, tests, and the form-specific validation.
7. Do not publish, enable lifecycle scripts, or perform destructive plugin operations without explicit confirmation.

## Completion report

Report the chosen form and reason, changed files, tool names and risks, checks run, load/install commands, and residual security or validation risks.
```

Task 2 will add the npm-specific links in the “Required reading” section once those files exist.

- [ ] **Step 5: Write the API v1 reference**

Create `references/api-contract.md` with exact public interfaces copied from `src/plugin/index.ts`, followed by concise guidance:

```ts
export type JsonSchema = Record<string, unknown>;
export type ToolRisk = "read" | "modify" | "dangerous";

export interface ToolResult {
  content: string;
  isError?: boolean;
  metadata?: Record<string, unknown>;
}

export interface ToolContext {
  workspace: string;
  signal: AbortSignal;
  structuredFilePath?: { requested: string; path: string; scope: "inside" | "outside" };
}

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: JsonSchema;
  risk: ToolRisk;
  execute(input: unknown, context: ToolContext): Promise<ToolResult>;
}

export const CODEN_PLUGIN_API_VERSION = 1 as const;

export interface CodeNPlugin {
  apiVersion: typeof CODEN_PLUGIN_API_VERSION;
  name: string;
  tools: ToolDefinition[];
}
```

Document these invariants immediately after the interface block:

- tool names match `^[a-zA-Z][a-zA-Z0-9_-]{0,63}$` and cannot collide with built-ins or earlier plugins;
- `risk` reflects actual side effects and controls confirmation rather than sandboxing;
- schemas are valid JSON Schema and normally use `additionalProperties: false`;
- expected operational failures return `isError: true`; unexpected defects may throw;
- long-running operations observe or propagate `context.signal`;
- public plugin code imports only `@twinklerg/coden/plugin`, never CodeN `src/` paths or the unexported package root;
- `structuredFilePath` is internal-only despite its presence in the runtime context and must not be used by third-party plugins.

- [ ] **Step 6: Write the local guide and valid template**

Create `references/local-plugin.md` covering:

```text
User path: ~/.config/coden/plugins/*.ts
Project path: <workspace>/.coden/plugins/*.ts
Additional path: coden --plugin ./path-or-directory
Reload: /reload
```

Explain that project plugins require trust, run in-process with full user permissions, default-export exactly one `ToolDefinition`, and must be a self-contained `.ts` file because CodeN imports source through a `data:text/typescript` URL. Explicitly prohibit relative runtime imports while allowing type-only imports from `@twinklerg/coden/plugin` and resolvable bare npm dependencies. Document both repeatable `--plugin` arguments and `plugins` arrays in user/project `config.json`. Include a validation checklist for name, schema, risk, tests, no top-level side effects, placement, trust, startup, and `/reload`.

Create `assets/local-tool.ts` as a concrete `line_count` example. It must:

```ts
import type { ToolDefinition } from "@twinklerg/coden/plugin";

type LineCountInput = { text: string };

function parseInput(input: unknown): LineCountInput | undefined {
  if (!input || typeof input !== "object") return undefined;
  const text = (input as { text?: unknown }).text;
  return typeof text === "string" ? { text } : undefined;
}

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
  async execute(input, context) {
    if (context.signal.aborted) return { content: "Operation cancelled", isError: true };
    const parsed = parseInput(input);
    if (!parsed) return { content: "Expected an object with a text string", isError: true };
    return { content: String(parsed.text.split("\n").length) };
  },
};

export default tool;
```

- [ ] **Step 7: Run focused tests and repository checks**

Run:

```bash
bun run vitest test/plugin-development-skill.test.ts
bun run typecheck
git diff --check
```

Expected: all commands PASS.

- [ ] **Step 8: Commit the local-plugin Skill slice**

```bash
git add .gitignore \
  .agents/skills/coden-tool-plugin-development/SKILL.md \
  .agents/skills/coden-tool-plugin-development/references/api-contract.md \
  .agents/skills/coden-tool-plugin-development/references/local-plugin.md \
  .agents/skills/coden-tool-plugin-development/assets/local-tool.ts \
  test/plugin-development-skill.test.ts
git commit -m "feat: add local CodeN plugin development skill"
```

Confirm `skills-lock.json` is not staged before committing:

```bash
git diff --cached --name-only | grep -qx skills-lock.json && exit 1 || true
```

### Task 2: npm Distribution Guidance, Templates, and Final Validation

**Files:**
- Modify: `.agents/skills/coden-tool-plugin-development/SKILL.md`
- Modify: `test/plugin-development-skill.test.ts`
- Create: `.agents/skills/coden-tool-plugin-development/references/npm-plugin.md`
- Create: `.agents/skills/coden-tool-plugin-development/assets/npm-single-tool.ts`
- Create: `.agents/skills/coden-tool-plugin-development/assets/npm-multi-tool.ts`
- Create: `.agents/skills/coden-tool-plugin-development/assets/npm-package.json`
- Create: `.agents/skills/coden-tool-plugin-development/assets/npm-tsconfig.json`

**Interfaces:**
- Consumes: the Skill workflow and API v1 reference from Task 1, plus the npm metadata rules implemented by `src/plugins/package-metadata.ts` and export normalization in `src/plugins/api.ts`.
- Produces: complete npm single/multi-tool guidance and templates, with final static and repository-wide validation.

- [ ] **Step 1: Extend the test with failing npm contract coverage**

Add this test inside the existing `describe` block:

```ts
it("documents and templates valid npm single-tool and multi-tool packages", async () => {
  const [skill, guide, single, multi, packageText, tsconfigText, rootPackageText] =
    await Promise.all([
      resource("SKILL.md"),
      resource("references/npm-plugin.md"),
      resource("assets/npm-single-tool.ts"),
      resource("assets/npm-multi-tool.ts"),
      resource("assets/npm-package.json"),
      resource("assets/npm-tsconfig.json"),
      readFile(path.join(workspace, "package.json"), "utf8"),
    ]);
  const packageTemplate = JSON.parse(packageText) as {
    name: string;
    type: string;
    files: string[];
    coden: { apiVersion: number; plugin: string };
    devDependencies: Record<string, string>;
  };
  const rootPackage = JSON.parse(rootPackageText) as { version: string };

  expect(skill).toContain("references/npm-plugin.md");
  expect(skill).toContain("assets/npm-single-tool.ts");
  expect(skill).toContain("assets/npm-multi-tool.ts");
  expect(guide).toContain("npm pack --dry-run");
  expect(guide).toContain("coden plugin install npm:");
  expect(guide).toContain("公开 npmjs");
  expect(packageTemplate).toMatchObject({
    name: "@scope/coden-plugin-example",
    type: "module",
    files: ["dist"],
    coden: { apiVersion: 1, plugin: "./dist/index.js" },
  });
  expect(packageTemplate.devDependencies["@twinklerg/coden"]).toBe(
    `^${rootPackage.version}`,
  );
  expect(JSON.parse(tsconfigText)).toMatchObject({
    compilerOptions: {
      target: "ES2022",
      module: "ESNext",
      moduleResolution: "Bundler",
      strict: true,
    },
    include: ["src/**/*.ts"],
  });
  expect(single).toContain(
    'import type { ToolDefinition } from "@twinklerg/coden/plugin"',
  );
  expect(multi).toContain("CODEN_PLUGIN_API_VERSION");
  expect(multi).toContain('name: "@scope/coden-plugin-example"');
  expect(single).not.toMatch(/from\s+["']\.\.?\//);
  expect(multi).not.toMatch(/from\s+["']\.\.?\//);
  expect(syntaxErrors(single)).toEqual([]);
  expect(syntaxErrors(multi)).toEqual([]);
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
bun run vitest test/plugin-development-skill.test.ts
```

Expected: the existing tests PASS and the new npm test FAILS because npm resources do not exist.

- [ ] **Step 3: Complete npm routing in `SKILL.md`**

Update the frontmatter description to cover creating, modifying, debugging, testing, packaging, and publishing both local TypeScript and npm-distributed CodeN plugins, including the trigger terms `ToolDefinition` and `CodeNPlugin`. Change “Choose the extension form” so it directly chooses npm for reusable distribution, multiple source files, versioning, or multiple tools. Keep the Task 1 workflow and add npm-specific reading rules:

```markdown
- Read `references/npm-plugin.md` for npm distribution.
- Start from `assets/npm-single-tool.ts` for one exported tool.
- Start from `assets/npm-multi-tool.ts` for a `CodeNPlugin` containing multiple tools.
- Adapt `assets/npm-package.json` and `assets/npm-tsconfig.json`; do not copy package names or versions blindly.
```

Add npm completion gates: typecheck, offline tests, build, inspect `dist`, run `npm pack --dry-run`, report the CodeN install command, and require explicit confirmation before `npm publish` or `--allow-scripts`.

- [ ] **Step 4: Write the npm distribution reference**

Create `references/npm-plugin.md` with these sections and exact rules:

1. **When to use npm distribution** — reusable or multi-file implementations, versioning, team/public distribution.
2. **Supported source** — only `npm:<package>` or `npm:<package>@<version-or-tag>` from public `https://registry.npmjs.org`; no private registry, Git, URL, or local-directory install source.
3. **Package contract** — `type: "module"`, built `.js`/`.mjs` entry inside the package, `coden.apiVersion: 1`, and `coden.plugin` beginning with `./` and containing no traversal.
4. **Exports** — default-export one `ToolDefinition`, or default-export a non-empty `CodeNPlugin` whose `name` exactly equals the npm package name.
5. **Dependencies** — keep `@twinklerg/coden` in `devDependencies` for `import type`; include runtime libraries normally; avoid top-level side effects.
6. **Validation sequence**:

```bash
bun run format
bun run typecheck
bun run test
bun run build
npm pack --dry-run
```

7. **Install sequence**:

```bash
coden plugin install npm:@scope/coden-plugin-example
coden plugin list
coden plugin sync
```

8. **Operational rules** — project is default scope, `--global` selects user scope, npm changes require restart, `/reload` only guarantees local `.ts` reload, lifecycle scripts are disabled unless `--allow-scripts` is explicitly approved, and importing the entry still executes top-level code with full user permissions.
9. **Release boundary** — never run `npm publish`, destructive remove/sync, or `--allow-scripts` without explicit user confirmation.

- [ ] **Step 5: Create the npm package and TypeScript configuration assets**

Create valid `assets/npm-package.json` using the repository version current at implementation time (`0.1.5` when this plan was written):

```json
{
  "name": "@scope/coden-plugin-example",
  "version": "1.0.0",
  "type": "module",
  "files": ["dist"],
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run",
    "check": "bun run typecheck && bun run test"
  },
  "coden": {
    "apiVersion": 1,
    "plugin": "./dist/index.js"
  },
  "devDependencies": {
    "@twinklerg/coden": "^0.1.5",
    "@types/node": "^24.3.0",
    "typescript": "^5.9.2",
    "vitest": "^3.2.4"
  }
}
```

Create `assets/npm-tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "declaration": true,
    "rootDir": "src",
    "outDir": "dist",
    "types": ["node"],
    "skipLibCheck": true
  },
  "include": ["src/**/*.ts"]
}
```

The Skill must tell future users to align dependency versions with their target CodeN release rather than assuming the example version remains current.

- [ ] **Step 6: Create the npm single-tool and multi-tool assets**

Create `assets/npm-single-tool.ts` with this complete single-tool example:

```ts
import type { ToolDefinition } from "@twinklerg/coden/plugin";

type EchoInput = { text: string };

function parseEchoInput(input: unknown): EchoInput | undefined {
  if (!input || typeof input !== "object") return undefined;
  const text = (input as { text?: unknown }).text;
  return typeof text === "string" ? { text } : undefined;
}

const tool: ToolDefinition = {
  name: "example_echo",
  description: "Echo supplied text",
  risk: "read",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["text"],
    properties: { text: { type: "string" } },
  },
  async execute(input, context) {
    if (context.signal.aborted) return { content: "Operation cancelled", isError: true };
    const parsed = parseEchoInput(input);
    if (!parsed) return { content: "Expected an object with a text string", isError: true };
    return { content: parsed.text };
  },
};

export default tool;
```

Create `assets/npm-multi-tool.ts` with this complete two-tool plugin:

```ts
import {
  CODEN_PLUGIN_API_VERSION,
  type CodeNPlugin,
  type ToolDefinition,
} from "@twinklerg/coden/plugin";

type KeyInput = { key: string };
type WriteInput = { key: string; value: string };

const values = new Map<string, string>();

function parseKey(input: unknown): KeyInput | undefined {
  if (!input || typeof input !== "object") return undefined;
  const key = (input as { key?: unknown }).key;
  return typeof key === "string" ? { key } : undefined;
}

function parseWrite(input: unknown): WriteInput | undefined {
  const parsed = parseKey(input);
  const value =
    input && typeof input === "object" ? (input as { value?: unknown }).value : undefined;
  return parsed && typeof value === "string" ? { key: parsed.key, value } : undefined;
}

const readTool: ToolDefinition = {
  name: "example_read",
  description: "Read a value from the plugin's in-memory example store",
  risk: "read",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["key"],
    properties: { key: { type: "string", minLength: 1 } },
  },
  async execute(input, context) {
    if (context.signal.aborted) return { content: "Operation cancelled", isError: true };
    const parsed = parseKey(input);
    if (!parsed) return { content: "Expected an object with a key string", isError: true };
    const value = values.get(parsed.key);
    return value === undefined
      ? { content: `No value found for ${parsed.key}`, isError: true }
      : { content: value };
  },
};

const writeTool: ToolDefinition = {
  name: "example_write",
  description: "Write a value to the plugin's in-memory example store",
  risk: "modify",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["key", "value"],
    properties: {
      key: { type: "string", minLength: 1 },
      value: { type: "string" },
    },
  },
  async execute(input, context) {
    if (context.signal.aborted) return { content: "Operation cancelled", isError: true };
    const parsed = parseWrite(input);
    if (!parsed)
      return { content: "Expected key and value strings", isError: true };
    values.set(parsed.key, parsed.value);
    return { content: `Stored ${parsed.key}` };
  },
};

const plugin: CodeNPlugin = {
  apiVersion: CODEN_PLUGIN_API_VERSION,
  name: "@scope/coden-plugin-example",
  tools: [readTool, writeTool],
};

export default plugin;
```

These examples use closed schemas, narrow `unknown` input, distinguish read and modify risk, cooperate with cancellation, and have no external top-level side effects.

- [ ] **Step 7: Run focused and full validation**

Run:

```bash
bun run vitest test/plugin-development-skill.test.ts
just check
just build
git diff --check
```

Expected: focused tests, Biome, strict TypeScript, the complete offline Vitest suite, CLI build, and whitespace checks all PASS.

Confirm tracking boundaries:

```bash
git status --short --ignored .agents/skills
```

Expected: `coden-tool-plugin-development` files are visible as tracked/untracked changes before commit, while `.agents/skills/skill-creator/` remains ignored.

- [ ] **Step 8: Review the Skill against the public implementation**

Compare the completed resources directly with:

```text
src/plugin/index.ts
src/tools/registry.ts
src/tools/plugin-loader.ts
src/plugins/api.ts
src/plugins/package-metadata.ts
README.md sections “本地 TypeScript 插件” and “npm 插件”
```

Check that every command, API field, risk value, loader limitation, reload/restart statement, and npm metadata rule matches those sources. Remove duplicated prose from `SKILL.md` when it already belongs in a reference file, and keep the entry point below 500 lines.

- [ ] **Step 9: Commit npm support**

```bash
git add \
  .agents/skills/coden-tool-plugin-development/SKILL.md \
  .agents/skills/coden-tool-plugin-development/references/npm-plugin.md \
  .agents/skills/coden-tool-plugin-development/assets/npm-single-tool.ts \
  .agents/skills/coden-tool-plugin-development/assets/npm-multi-tool.ts \
  .agents/skills/coden-tool-plugin-development/assets/npm-package.json \
  .agents/skills/coden-tool-plugin-development/assets/npm-tsconfig.json \
  test/plugin-development-skill.test.ts
git commit -m "feat: add npm CodeN plugin development guidance"
```

Confirm `skills-lock.json` is not staged before committing:

```bash
git diff --cached --name-only | grep -qx skills-lock.json && exit 1 || true
```
