# CodeN Website NJU Purple Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unify the complete CodeN website around the successful docs visual language and replace the teal palette with an NJU-purple theme.

**Architecture:** Keep every existing Astro/React component and interaction unchanged. Update the semantic tokens and shell rules in `global.css` and `docs.css`, then restyle the home and plugin surfaces through their existing class names; built-site validation will assert durable purple-theme markers in generated CSS.

**Tech Stack:** Astro 7, Starlight, React 19, CSS custom properties, Bun, Vitest, Biome, Just

**Spec:** `docs/superpowers/specs/2026-08-31-coden-website-nju-purple-design.md`

## Global Constraints

- Preserve routes, content, DOM structure, theme switching, plugin search, command copying, and responsive behavior.
- Use NJU purple as the only primary accent in both light and dark themes.
- Use a 32px low-contrast grid, monospace headings/navigation, 2–3px radii, thin borders, and no decorative shadows.
- Do not add fonts, images, dependencies, JavaScript interactions, or Starlight component overrides.
- Do not modify `package.json`, `bun.lock`, or `website/src/components/SiteFooter.astro`.

## File Map

- Modify `website/src/styles/global.css`: shared NJU-purple tokens, product-page grid, header/footer, language and error-page surfaces.
- Modify `website/src/styles/docs.css`: Starlight purple tokens while retaining the existing docs layout language.
- Modify `website/src/styles/home.css`: terminal/document-style home sections and controls.
- Modify `website/src/styles/plugins.css`: technical plugin-market panels, search, metadata, and actions.
- Modify `website/scripts/check-built-site.ts`: require stable purple-theme CSS markers in product and docs bundles.
- Modify `website/test/check-built-site.test.ts`: cover extraction/validation helpers only if validator interfaces change; otherwise rely on the integrated build validation.

---

### Task 1: Establish Shared NJU-Purple Theme Tokens

**Files:**
- Modify: `website/src/styles/global.css`
- Modify: `website/src/styles/docs.css`

**Interfaces:**
- Consumes: existing `data-theme="light|dark"` contract and Starlight `--sl-*` variables.
- Produces: product variables `--coden-bg`, `--coden-surface`, `--coden-surface-strong`, `--coden-text`, `--coden-muted`, `--coden-border`, `--coden-accent`, `--coden-accent-strong`, `--coden-accent-soft`, `--coden-grid`; docs marker `--coden-doc-grid`.

- [ ] **Step 1: Record the current teal-theme selectors that must disappear**

Run:

```bash
rg -n '#(?:0f766e|115e59|2dd4bf|5eead4|071614|042f2e)|border-radius: (?:999px|1\.25rem|0\.9rem)|box-shadow: var\(--coden-shadow\)' website/src/styles
```

Expected: matches in all four stylesheets, proving the old palette/shape language is present.

- [ ] **Step 2: Replace product design tokens and shell styling**

Implement a light palette centered on deep NJU purple (`#5b2c83` / `#6f3a97`) over near-white lavender backgrounds, and a dark palette centered on bright purple (`#c084fc` / `#d8b4fe`) over near-black purple backgrounds. Add `--coden-accent-soft` and `--coden-grid`; set both radius tokens to `3px`/`2px` and `--coden-shadow: none`.

Apply the grid to `body`, make headings/navigation/buttons monospace, replace pill borders with 2px radii, and style active/hover states through purple border/background changes. Retain minimum control heights and all existing responsive/reduced-motion rules.

- [ ] **Step 3: Replace docs semantic colors without changing docs layout rules**

Map `--sl-color-*`, accent, inline-code, hairline, background, and `--coden-doc-grid` values to the same purple family. Keep every selector below the variable blocks structurally unchanged except where a remaining teal literal must be replaced.

- [ ] **Step 4: Verify the shared styles statically**

Run:

```bash
rg -n -- '--coden-accent-soft|--coden-grid|--coden-doc-grid|#5b2c83|#c084fc' website/src/styles/global.css website/src/styles/docs.css
rg -n 'border-radius: 999px|box-shadow: var\(--coden-shadow\)|#(?:0f766e|115e59|2dd4bf|5eead4|071614|042f2e)' website/src/styles/global.css website/src/styles/docs.css
```

Expected: the first command finds the purple tokens; the second has no output.

- [ ] **Step 5: Commit shared theme work**

```bash
git add website/src/styles/global.css website/src/styles/docs.css
git commit -m "style(website): adopt NJU purple theme"
```

### Task 2: Restyle Home and Plugin Market Surfaces

**Files:**
- Modify: `website/src/styles/home.css`
- Modify: `website/src/styles/plugins.css`

**Interfaces:**
- Consumes: Task 1's semantic `--coden-*` tokens and the existing component class names.
- Produces: unchanged DOM/API behavior with docs-style home and plugin surfaces.

- [ ] **Step 1: Replace home card styling with technical panels**

Set all home containers to 2–3px radii, transparent/semantic surfaces, thin borders, and no shadows. Remove radial/soft decorative gradients. Use monospace headings, purple section rules and labels, square controls, low-contrast code surfaces, and a distinct purple active-tab/primary-button state. Preserve the two-column hero, twelve-column feature grid, three-column step grid, and existing 900px single-column fallback.

- [ ] **Step 2: Replace plugin market styling with technical panels**

Use a bordered header section, square search field, small-radius cards, monospace package names/metadata/commands, thin row separators, and purple hover/focus/action states. Preserve the responsive auto-fit grid and all 44px control heights.

- [ ] **Step 3: Verify forbidden visual patterns are absent**

Run:

```bash
rg -n 'border-radius: 999px|box-shadow: var\(--coden-shadow\)|radial-gradient|linear-gradient' website/src/styles/home.css website/src/styles/plugins.css
```

Expected: no output.

- [ ] **Step 4: Run focused website tests**

Run:

```bash
cd website && bun run test
```

Expected: all Vitest suites pass, including home interactions, plugin filtering/copy behavior, routes, and built-site helpers.

- [ ] **Step 5: Commit product-surface work**

```bash
git add website/src/styles/home.css website/src/styles/plugins.css
git commit -m "style(website): unify product surfaces with docs"
```

### Task 3: Add Build-Level Theme Regression Markers and Validate

**Files:**
- Modify: `website/scripts/check-built-site.ts`
- Test: `website/test/check-built-site.test.ts` only if helper behavior changes

**Interfaces:**
- Consumes: generated product styles containing `--coden-grid` and docs styles containing `--coden-doc-grid`.
- Produces: integrated build failure when product or docs pages lose their theme stylesheet.

- [ ] **Step 1: Tighten product stylesheet validation marker**

In `validateBuiltSite`, retain the existing linked-stylesheet traversal but change the product-page marker from the generic `--coden-bg` to `--coden-grid`. Keep docs validation on `--coden-doc-grid`. This proves both bundles contain their dedicated grid/theme layer.

- [ ] **Step 2: Run validator unit tests**

Run:

```bash
cd website && bun run test test/check-built-site.test.ts
```

Expected: all built-site helper tests pass.

- [ ] **Step 3: Run complete website validation**

Run:

```bash
just website-check
```

Expected: Biome, Astro diagnostics, all Vitest tests, 106-page Astro build, bilingual Pagefind indexing, and built-site validation pass.

- [ ] **Step 4: Check scope and whitespace**

Run:

```bash
git diff --check
git status --short
git diff -- website/src/styles/global.css website/src/styles/docs.css website/src/styles/home.css website/src/styles/plugins.css website/scripts/check-built-site.ts
```

Expected: no whitespace errors; implementation changes are limited to the five planned files, while pre-existing modifications to `package.json`, `bun.lock`, and `website/src/components/SiteFooter.astro` remain untouched.

- [ ] **Step 5: Commit validation changes**

```bash
git add website/scripts/check-built-site.ts website/test/check-built-site.test.ts docs/superpowers/plans/2026-08-31-coden-website-nju-purple.md
git commit -m "test(website): guard unified theme assets"
```
