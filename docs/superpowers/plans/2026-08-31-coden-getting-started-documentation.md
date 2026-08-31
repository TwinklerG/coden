# CodeN Expert Getting-Started Documentation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the 12 Chinese and English getting-started scaffolds with source-verified, task-oriented documentation for technical experts without allowing the docs generator to overwrite authored content.

**Architecture:** First make documentation generation non-destructive: it may create missing scaffold files and validate the route inventory, but authored MDX is authoritative. Then author the six Chinese pages, translate them into six structurally equivalent English pages, and enforce content completeness and bilingual parity with focused Vitest coverage plus the existing Astro/Starlight build validator.

**Tech Stack:** Astro 7, Starlight, MDX, TypeScript, Bun toolchain, Vitest, Biome, Pagefind

**Spec:** `docs/superpowers/specs/2026-08-31-coden-getting-started-documentation-design.md`

## Global Constraints

- Audience: technical experts familiar with shell, environment variables, JSON, Provider API keys, working directories, package managers, and coding agents.
- Organization: task-first, high-density prose; use tables, command blocks, explicit rules, boundaries, and failure modes.
- Truth source priority: implementation, tests, built CLI output, package/config metadata, then README.
- Document only current, verifiable behavior; omit roadmap behavior and unverifiable claims.
- Complete Chinese first, then write natural English with equivalent structure and facts.
- Keep the 12 existing routes and `sidebar.order` values unchanged.
- Preserve and exclude all pre-existing workspace changes, including the current modifications under `website/src/components/`, `website/src/i18n/`, `website/src/layouts/`, `website/src/styles/`, and `website/tsconfig.json`.
- Use Node/Web APIs in TypeScript; do not introduce Bun-only APIs.
- Do not add dependencies.

## File Map

### Documentation inventory infrastructure

- Create `website/src/lib/docs-files.ts`: non-destructive synchronization and inventory validation for generated documentation paths.
- Modify `website/scripts/generate-docs.ts`: thin CLI wrapper around `syncDocFiles`; no longer compares authored files with scaffold text or overwrites existing files.
- Create `website/test/docs-files.test.ts`: verifies missing-file generation, preservation of authored content, and missing/unexpected inventory diagnostics.
- Modify `website/test/docs-scaffold.test.ts`: retain metadata/scaffold rendering coverage and rename descriptions so they do not imply all files remain generated forever.

### Authored content and contract tests

- Create `website/test/getting-started-content.test.ts`: checks the 12 target pages for completeness, stable frontmatter, code/link parity, and removal of scaffold notices.
- Modify `website/src/content/docs/zh/docs/index.mdx`: Chinese expert documentation entry point.
- Modify `website/src/content/docs/zh/docs/getting-started/requirements.mdx`: runtime and development prerequisites.
- Modify `website/src/content/docs/zh/docs/getting-started/installation.mdx`: installation, verification, upgrade, and package/runtime boundaries.
- Modify `website/src/content/docs/zh/docs/getting-started/provider.mdx`: minimal OpenAI and Anthropic setup with precedence and secret-handling boundaries.
- Modify `website/src/content/docs/zh/docs/getting-started/first-task.mdx`: first task lifecycle, observable behavior, approval/trust boundaries, and validation.
- Modify `website/src/content/docs/zh/docs/getting-started/interfaces.mdx`: CLI, TUI, and print-mode selection semantics.
- Modify the six matching files under `website/src/content/docs/en/docs/`: natural English counterparts with identical commands, links, and technical facts.

---

### Task 1: Make documentation generation preserve authored MDX

**Files:**
- Create: `website/src/lib/docs-files.ts`
- Modify: `website/scripts/generate-docs.ts`
- Create: `website/test/docs-files.test.ts`
- Modify: `website/test/docs-scaffold.test.ts`

**Interfaces:**
- Consumes: `allDocEntries()`, `expectedDocFiles(root)`, and `renderScaffold(entry, language)` from `website/src/lib/docs-scaffold.ts`; `SUPPORTED_LANGUAGES` from `website/src/lib/site.ts`.
- Produces:
  ```ts
  export type DocsSyncMode = "write" | "check";
  export interface DocsSyncResult {
    expectedCount: number;
    created: string[];
    issues: string[];
  }
  export async function syncDocFiles(root: string, mode: DocsSyncMode): Promise<DocsSyncResult>;
  ```
- Contract: `write` creates only missing expected files and never rewrites an existing MDX file; `check` reports missing and unexpected MDX paths but does not compare file bodies with scaffold output.

- [ ] **Step 1: Add failing preservation and inventory tests**

Create `website/test/docs-files.test.ts` with temporary-directory tests:

```ts
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { syncDocFiles } from "../src/lib/docs-files";

const roots: string[] = [];

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "coden-docs-"));
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("documentation files", () => {
  it("creates missing scaffolds without replacing authored content", async () => {
    const root = await temporaryRoot();
    const first = await syncDocFiles(root, "write");
    expect(first.created).toHaveLength(first.expectedCount);

    const authored = path.join(root, "src/content/docs/zh/docs/index.mdx");
    await writeFile(authored, "---\ntitle: Authored\n---\n\n# Kept\n");

    const second = await syncDocFiles(root, "write");
    expect(second.created).toEqual([]);
    expect(await readFile(authored, "utf8")).toContain("# Kept");
  });

  it("reports missing and unexpected MDX files in check mode", async () => {
    const root = await temporaryRoot();
    await syncDocFiles(root, "write");
    await rm(path.join(root, "src/content/docs/en/docs/index.mdx"));
    const extra = path.join(root, "src/content/docs/en/docs/extra.mdx");
    await mkdir(path.dirname(extra), { recursive: true });
    await writeFile(extra, "---\ntitle: Extra\n---\n");

    const result = await syncDocFiles(root, "check");
    expect(result.issues.some((issue) => issue.startsWith("missing:"))).toBe(true);
    expect(result.issues.some((issue) => issue.startsWith("unexpected:"))).toBe(true);
  });
});
```

Rename the suite in `website/test/docs-scaffold.test.ts` from `documentation scaffold` to `documentation metadata and scaffolds`; retain its slug, group, localization, and `renderScaffold` assertions.

- [ ] **Step 2: Run the focused tests and confirm the new module is absent**

Run:

```bash
cd website && bun run test -- test/docs-files.test.ts test/docs-scaffold.test.ts
```

Expected: FAIL because `../src/lib/docs-files` does not exist.

- [ ] **Step 3: Implement non-destructive synchronization**

Create `website/src/lib/docs-files.ts`. Build the desired path-to-scaffold map from `allDocEntries()` and both languages. Recursively enumerate actual `.mdx` files under `src/content/docs/{zh,en}/docs`. In `write` mode, call `mkdir(..., { recursive: true })` and `writeFile` only after `readFile` fails with `ENOENT`; rethrow other I/O errors. In `check` mode, return these exact diagnostics using root-relative paths:

```ts
`missing: ${path.relative(root, filePath)}`
`unexpected: ${path.relative(root, filePath)}`
```

Return deterministic, sorted `created` and `issues` arrays. Existing file contents must never participate in issue detection.

Replace `website/scripts/generate-docs.ts` with a thin wrapper:

```ts
import process from "node:process";
import { syncDocFiles } from "../src/lib/docs-files";

const mode = process.argv.includes("--check") ? "check" : "write";
const result = await syncDocFiles(process.cwd(), mode);

if (result.issues.length > 0) {
  for (const issue of result.issues) console.error(issue);
  process.exitCode = 1;
} else if (mode === "check") {
  console.log(`checked ${result.expectedCount} documentation files`);
} else {
  console.log(`created ${result.created.length} missing documentation files`);
}
```

- [ ] **Step 4: Run focused tests and generator checks**

Run:

```bash
cd website
bun run test -- test/docs-files.test.ts test/docs-scaffold.test.ts
bun run docs:check
```

Expected: both test files PASS; `docs:check` prints `checked 100 documentation files` even when authored pages differ from scaffold templates.

- [ ] **Step 5: Verify generation is idempotent against the real content tree**

Run:

```bash
before=$(git hash-object src/content/docs/zh/docs/index.mdx)
bun run docs:generate
after=$(git hash-object src/content/docs/zh/docs/index.mdx)
test "$before" = "$after"
```

Expected: command succeeds and output reports `created 0 missing documentation files`.

- [ ] **Step 6: Commit only the generator infrastructure**

```bash
git add website/src/lib/docs-files.ts website/scripts/generate-docs.ts \
  website/test/docs-files.test.ts website/test/docs-scaffold.test.ts
git commit -m "test(website): preserve authored documentation"
```

Expected: pre-existing website modifications remain unstaged and absent from the commit.

---

### Task 2: Author and enforce the bilingual expert getting-started guide

**Files:**
- Create: `website/test/getting-started-content.test.ts`
- Modify: `website/src/content/docs/zh/docs/index.mdx`
- Modify: `website/src/content/docs/zh/docs/getting-started/requirements.mdx`
- Modify: `website/src/content/docs/zh/docs/getting-started/installation.mdx`
- Modify: `website/src/content/docs/zh/docs/getting-started/provider.mdx`
- Modify: `website/src/content/docs/zh/docs/getting-started/first-task.mdx`
- Modify: `website/src/content/docs/zh/docs/getting-started/interfaces.mdx`
- Modify: `website/src/content/docs/en/docs/index.mdx`
- Modify: `website/src/content/docs/en/docs/getting-started/requirements.mdx`
- Modify: `website/src/content/docs/en/docs/getting-started/installation.mdx`
- Modify: `website/src/content/docs/en/docs/getting-started/provider.mdx`
- Modify: `website/src/content/docs/en/docs/getting-started/first-task.mdx`
- Modify: `website/src/content/docs/en/docs/getting-started/interfaces.mdx`

**Interfaces:**
- Consumes: verified behavior from the source/test matrix below and the non-destructive docs inventory from Task 1.
- Produces: six route-equivalent bilingual page pairs whose frontmatter order, fenced code blocks, and internal link targets remain synchronized.

#### Source/test matrix

| Page | Primary implementation sources | Behavioral tests and executable evidence |
| --- | --- | --- |
| index | `README.md`, `src/cli/index.ts`, `src/cli/interface-mode.ts` | `test/cli.test.ts`, built `dist/index.js --help` |
| requirements | root `package.json` (`engines`, `bin`, `scripts`), `src/plugins/bun-package-manager.ts` | `just build`, Node 22 built-artifact smoke test |
| installation | root `package.json`, `README.md`, release/package metadata | `npm pack --dry-run`, installed/built `coden --version` and `--help` |
| provider | `src/config/config.ts`, `src/providers/openai.ts`, `src/providers/anthropic.ts`, `src/cli/agent-command.ts` | `test/config.test.ts`, `test/providers.test.ts`, missing-key cases in `test/cli.test.ts` |
| first-task | `src/cli/agent-command.ts`, `src/cli/agent-application.ts`, `src/config/trust.ts`, `src/permissions/workspace.ts` | `test/cli.test.ts`, `test/runtime.integration.test.ts`, `test/tools.test.ts` |
| interfaces | `src/cli/index.ts`, `src/cli/interface-mode.ts`, `src/cli/repl-command.ts`, `src/tui/app.ts` | `test/interface-mode.test.ts`, `test/cli.test.ts`, TUI-focused tests |

- [ ] **Step 1: Capture clean CLI evidence without credentials or network access**

Run from the repository root:

```bash
just build
node dist/index.js --version
CODEN_LANG=en node dist/index.js --help > /tmp/coden-help-en.txt
node dist/index.js --lang zh --help > /tmp/coden-help-zh.txt
rg -- '--print|--tui|--cli|--provider|--model|--resume|--auto|--smart-approve|--thinking' \
  /tmp/coden-help-en.txt /tmp/coden-help-zh.txt
```

Expected: build succeeds; version equals root `package.json`; help exposes every listed option. Do not run a live Provider request. Use the provider/config tests for credential and precedence claims.

- [ ] **Step 2: Write the failing content-contract test**

Create `website/test/getting-started-content.test.ts` with:

```ts
import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const pages = [
  { slug: "index", order: 0 },
  { slug: "getting-started/requirements", order: 110 },
  { slug: "getting-started/installation", order: 120 },
  { slug: "getting-started/provider", order: 130 },
  { slug: "getting-started/interfaces", order: 140 },
  { slug: "getting-started/first-task", order: 150 },
] as const;

function blocks(source: string): string[] {
  return [...source.matchAll(/```[^\n]*\n([\s\S]*?)```/g)].map((match) => match[1].trim());
}

function links(source: string): string[] {
  return [...source.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)]
    .map((match) => match[1])
    .filter((target) => !target.startsWith("http"));
}

async function page(language: "zh" | "en", slug: string): Promise<string> {
  return readFile(path.join(process.cwd(), "src/content/docs", language, "docs", `${slug}.mdx`), "utf8");
}

describe("expert getting-started documentation", () => {
  it.each(pages)("replaces both $slug scaffolds with substantive content", async ({ slug, order }) => {
    for (const language of ["zh", "en"] as const) {
      const source = await page(language, slug);
      expect(source).toContain(`  order: ${order}`);
      expect(source).not.toMatch(/文档框架|Documentation scaffold|后续文档任务|dedicated documentation task/);
      expect(source.length).toBeGreaterThan(800);
      expect((source.match(/^## /gm) ?? []).length).toBeGreaterThanOrEqual(2);
    }
  });

  it.each(pages)("keeps code and internal destinations aligned for $slug", async ({ slug }) => {
    const zh = await page("zh", slug);
    const en = await page("en", slug);
    expect(blocks(zh)).toEqual(blocks(en));
    expect(links(zh)).toEqual(links(en));
  });
});
```

- [ ] **Step 3: Run the content test and verify it fails on scaffolds**

Run:

```bash
cd website && bun run test -- test/getting-started-content.test.ts
```

Expected: FAIL on the minimum content length and scaffold-marker assertions.

- [ ] **Step 4: Write the six Chinese pages from verified facts**

Use these page-specific structures; retain each existing `title` and `sidebar.order`, and tighten `description` for expert readers:

- `index.mdx`: scope statement; four-command shortest path; task flow table; links to requirements, installation, provider, first task, interfaces, configuration reference, and security model.
- `requirements.mdx`: published CLI runtime versus repository-development toolchain table; Node `>=22`; Bun `>=1.1.0` only where the implementation actually requires it; TTY/raw-mode constraints for `--tui`; credential/network prerequisites; verification commands.
- `installation.mdx`: global npm and Bun installation commands already supported by package metadata/README; `coden --version` and `coden --help`; upgrade and uninstall commands matching the chosen package manager; explain that the published bin is `dist/index.js`; distinguish npm-package runtime requirements from source checkout requirements.
- `provider.mdx`: separate minimal OpenAI and Anthropic shell examples; use only documented `CODEN_*` credential keys; set explicit provider/model values where defaults would be ambiguous; summarize CLI/environment/project/user/default precedence from `loadConfig`; warn that shell environment wins over config `env`; link detailed Provider and precedence pages.
- `first-task.mdx`: use a bounded, reviewable repository task prompt; explain default CLI behavior, workspace scope, approvals, observable completion, and how to inspect the resulting diff/tests; distinguish `--auto` from default approval behavior only to the extent verified by source/tests; avoid claims requiring a paid live call.
- `interfaces.mdx`: decision table for default CLI, explicit `--tui`, and `-p/--print`; exact mutual exclusions; TUI fallback conditions (`stdin`/`stdout` TTY, raw mode, `TERM != dumb`); print mode’s one-turn and pipe-friendly behavior; concise launch examples.

Use relative Markdown links so Starlight resolves them under either locale and configured base path. Keep all code blocks free of translated comments so their bodies can remain identical across languages.

- [ ] **Step 5: Run Chinese-focused parsing and content checks**

Run:

```bash
cd website
bun run docs:check
bun run typecheck
bun run test -- test/getting-started-content.test.ts
```

Expected: `docs:check` and Astro typecheck PASS. The content test may still fail only because English counterparts remain scaffolds; inspect failures to ensure no Chinese page fails its own completeness assertions.

- [ ] **Step 6: Write the six English counterparts**

Translate by technical intent rather than sentence order. Preserve exactly:

- all fenced code block bodies;
- internal link destinations and ordering;
- option, environment-variable, config-key, model, and Provider spelling;
- warning scope and factual boundaries;
- heading hierarchy and page-level task sequence.

Use concise English technical prose. Do not add explanations of shell, JSON, API keys, package managers, or coding-agent basics absent from the Chinese source.

- [ ] **Step 7: Run bilingual contract and focused behavior tests**

Run:

```bash
cd website
bun run test -- test/getting-started-content.test.ts test/docs-files.test.ts \
  test/docs-scaffold.test.ts test/routes.test.ts test/check-built-site.test.ts
```

Expected: all focused tests PASS, including exact fenced-block and internal-destination parity.

- [ ] **Step 8: Manually compare paired headings and critical tokens**

Run:

```bash
for slug in index getting-started/requirements getting-started/installation \
  getting-started/provider getting-started/interfaces getting-started/first-task; do
  echo "=== $slug"
  rg -n '^(##|###) |CODEN_|coden |--[a-z]' \
    "src/content/docs/zh/docs/$slug.mdx" \
    "src/content/docs/en/docs/$slug.mdx"
done
```

Expected: each pair has matching structural coverage and identical technical tokens; prose differs only by language.

- [ ] **Step 9: Commit the complete bilingual content batch**

From the repository root:

```bash
git add website/test/getting-started-content.test.ts \
  website/src/content/docs/zh/docs/index.mdx \
  website/src/content/docs/zh/docs/getting-started/*.mdx \
  website/src/content/docs/en/docs/index.mdx \
  website/src/content/docs/en/docs/getting-started/*.mdx
git commit -m "docs(website): write expert getting-started guide"
```

Before confirming, run `git show --name-only --format= HEAD` and verify it contains only the 13 paths above. Pre-existing website modifications must remain outside the commit.

---

### Task 3: Validate the authored site and packaged CLI evidence

**Files:**
- Verify only; no planned file changes.

**Interfaces:**
- Consumes: non-destructive inventory from Task 1 and bilingual content from Task 2.
- Produces: final evidence that MDX parsing, localized routes, internal links, Pagefind language indexes, built-site rules, and CLI examples agree with the repository.

- [ ] **Step 1: Run the complete website pipeline**

Run:

```bash
just website-check
```

Expected: frozen install, docs inventory check, Biome, Astro diagnostics, all Vitest tests, 106-page build, both Pagefind language indexes, and built-site validation PASS.

- [ ] **Step 2: Rebuild and smoke-test the published Node artifact**

Run:

```bash
just build
node dist/index.js --version
node dist/index.js --lang en --help >/tmp/coden-final-help.txt
rg -- '--print|--tui|--cli|--provider|--model' /tmp/coden-final-help.txt
```

Expected: build and help checks PASS without Bun being used to execute `dist/index.js`.

- [ ] **Step 3: Run root regression checks because documentation states runtime behavior**

Run:

```bash
just check
```

Expected: Biome, TypeScript, and the complete offline root test suite PASS; live Provider tests remain skipped unless explicitly enabled by the repository test configuration.

- [ ] **Step 4: Check diff hygiene and workspace isolation**

Run:

```bash
git diff --check
git status --short
git log -3 --oneline
git show --stat --oneline HEAD~1..HEAD
```

Expected: no whitespace errors; the two implementation commits are present; all pre-existing user modifications remain intact and uncommitted; no unrelated file is included in either implementation commit.

- [ ] **Step 5: Record final evidence in the delivery summary**

Report:

- the two implementation commit hashes;
- focused test result;
- `just website-check` result and generated page count;
- `just build` plus Node artifact smoke result;
- `just check` result and skipped-test count;
- remaining pre-existing modified paths, explicitly identified as preserved and excluded.
