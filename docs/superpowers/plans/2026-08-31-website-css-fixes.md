# Website CSS Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Restore the product-page CSS cascade and restyle Starlight documentation as a restrained developer-tool interface.

**Architecture:** Product pages will import the shared design tokens and shell styles from their common Astro layout, guaranteeing that homepage and plugin-page CSS variables are present. Starlight will retain the shared brand primitives while adding a dedicated documentation override stylesheet for colors, typography, geometry, navigation, content, and responsive behavior.

**Tech Stack:** Astro 7, Starlight, CSS, Bun, Vitest

**Spec:** `docs/superpowers/specs/2026-08-31-coden-product-website-design.md`

## Global Constraints

- Preserve `site: https://twinklerg.github.io`, `base: /CodeN`, and static output.
- Keep all website source changes inside `website/` except this implementation plan.
- Maintain light/dark themes, responsive behavior, visible focus, and reduced-motion support.
- Do not modify the existing unrelated root `package.json` and `bun.lock` changes.

---

### Task 1: Restore product-page shared styles

**Files:**
- Modify: `website/src/layouts/ProductLayout.astro`
- Modify: `website/scripts/check-built-site.ts`
- Test: `website/test/check-built-site.test.ts`

**Interfaces:**
- Consumes: product pages rendered through `ProductLayout`
- Produces: product HTML whose linked CSS contains the `--coden-bg` shared token

- [x] Add a built-site validation helper that can inspect linked local stylesheets.
- [x] Add a failing unit test for stylesheet reference extraction.
- [x] Import `global.css` from `ProductLayout.astro`.
- [x] Run the focused test and built-site validator.

### Task 2: Apply a geek-oriented documentation theme

**Files:**
- Create: `website/src/styles/docs.css`
- Modify: `website/astro.config.ts`
- Modify: `website/scripts/check-built-site.ts`

**Interfaces:**
- Consumes: Starlight semantic variables and generated documentation markup
- Produces: documentation pages using the CodeN teal palette, mono display typography, angular controls, subtle grid background, and flat bordered navigation/content elements

- [x] Define explicit light/dark Starlight variables and documentation-only visual overrides.
- [x] Register `docs.css` after `global.css` in Starlight `customCss`.
- [x] Require built documentation CSS to contain the dedicated `--coden-doc-grid` marker.
- [x] Run formatting, type checks, tests, build, and built-site validation.

### Task 3: Final regression verification

**Files:**
- Verify only; no expected source changes

**Interfaces:**
- Consumes: completed Tasks 1–2
- Produces: validated static site under `/CodeN/`

- [x] Run `just website-check`.
- [x] Run `git diff --check` and inspect the final diff without touching unrelated root dependency edits.
