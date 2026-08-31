# CodeN Product Website Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a bilingual static CodeN product website with a polished landing page, a tested documentation scaffold, a runtime npm-backed plugin marketplace, and GitHub Pages deployment.

**Architecture:** Keep an independent Astro/Starlight application in `website/`; Astro renders the product and marketplace pages while Starlight renders generated bilingual documentation scaffold pages and Pagefind search. Small React islands own the terminal tabs, copy buttons, and npm requests; pure TypeScript modules own routing, documentation manifests, and npm response normalization so behavior can be unit-tested without a browser.

**Tech Stack:** Astro 7, Starlight 0.41, React 19, TypeScript 5.9, Vitest 4, Testing Library, Biome 2, Bun, Pagefind (through Starlight), GitHub Actions, GitHub Pages

**Spec:** `docs/superpowers/specs/2026-08-31-coden-product-website-design.md`

## Global Constraints

- Public site URL is exactly `https://twinklerg.github.io/CodeN/`; Astro uses `site: "https://twinklerg.github.io"`, `base: "/CodeN"`, and `output: "static"`.
- Supported locales are exactly `zh` (`zh-CN`) and `en`; both use explicit URL prefixes and `/CodeN/` provides language detection plus no-JavaScript links.
- All website source, content, configuration, dependencies, lockfiles, tests, and public assets live in `website/`; only `justfile` and `.github/workflows/` may be changed outside it for integration.
- Use Bun as the JS/TS toolchain but do not use Bun-only APIs; runtime and scripts use standard Web and Node.js APIs.
- Use Biome for TypeScript/JavaScript linting and formatting.
- The documentation deliverable is infrastructure, full bilingual navigation, generated scaffold pages, and tests only; complete documentation prose is outside this implementation.
- The marketplace allowlist initially contains exactly `coden-modern-unix` and `coden-msb` and loads current metadata in the browser from npmjs.
- npm content is rendered only as text; outbound package links are limited to normalized `https:` URLs.
- The site has automatic light/dark mode, an explicit theme control, responsive layouts, keyboard-visible focus, and reduced-motion support.
- Do not add analytics, cookies, a backend, npm package discovery, or fabricated usage/customer claims.
- Do not stage or alter the pre-existing user changes in root `package.json` and root `bun.lock`.

## File Structure

### Website foundation

- `website/package.json`: private website scripts and dependencies.
- `website/bun.lock`: website-only dependency lockfile.
- `website/astro.config.ts`: Astro, React, sitemap, Starlight, locale, sidebar, and component-override configuration.
- `website/tsconfig.json`: Astro TypeScript settings.
- `website/vitest.config.ts`: Node-default Vitest configuration with React support.
- `website/biome.json`: website-scoped Biome configuration.
- `website/.gitignore`: ignores `dist/`, `.astro/`, `node_modules/`, and Pagefind cache output.
- `website/src/content.config.ts`: Starlight docs content collection.
- `website/src/lib/site.ts`: site origin, base path, locale, and external-link constants.

### Documentation scaffold

- `website/src/data/docs.ts`: canonical bilingual documentation group/page manifest.
- `website/src/lib/docs-scaffold.ts`: validates and renders scaffold MDX from the manifest.
- `website/scripts/generate-docs.ts`: writes or checks generated bilingual MDX files using Node APIs.
- `website/src/content/docs/{zh,en}/docs/**/*.mdx`: generated, committed Starlight scaffold pages.
- `website/test/docs-scaffold.test.ts`: manifest uniqueness, locale parity, and generated-content tests.

### Shared product site

- `website/src/i18n/messages.ts`: typed Chinese and English product/marketplace strings.
- `website/src/lib/routes.ts`: base-aware route and language-alternate helpers.
- `website/src/layouts/ProductLayout.astro`: HTML shell, metadata, theme bootstrap, header, footer.
- `website/src/components/SiteHeader.astro`: product navigation, locale switch, and theme control.
- `website/src/components/SiteFooter.astro`: GitHub, npm, docs, marketplace, license, and version links.
- `website/src/components/Seo.astro`: canonical, hreflang, description, and Open Graph tags.
- `website/src/components/docs/DocsSiteTitle.astro`: Starlight title override adding product navigation.
- `website/src/pages/index.astro`: language-detecting root with accessible fallback links.
- `website/src/pages/404.astro`: bilingual static 404.
- `website/src/pages/zh/index.astro`, `website/src/pages/en/index.astro`: localized home routes.
- `website/test/routes.test.ts`: route and locale selection tests.

### Home page

- `website/src/data/home.ts`: bilingual feature cards, three-step flow, and terminal transcript data.
- `website/src/components/home/HomePage.astro`: composed landing page.
- `website/src/components/home/Hero.astro`: product positioning and actions.
- `website/src/components/home/InstallCommand.tsx`: Bun/npm command switch and copy feedback.
- `website/src/components/home/TerminalDemo.tsx`: keyboard-accessible CLI/TUI tabs.
- `website/src/components/home/Features.astro`: capability cards.
- `website/src/components/home/GettingStarted.astro`: three-step flow.
- `website/src/styles/home.css`: responsive, theme-aware landing visuals.
- `website/test/home-interactions.test.tsx`: command and terminal interaction tests.

### Plugin marketplace

- `website/src/data/plugins.ts`: reviewed plugin allowlist and optional curated fields.
- `website/src/lib/npm-registry.ts`: npm endpoint construction, timeout, parsing, and URL normalization.
- `website/src/components/plugins/PluginMarket.tsx`: search, loading, success, warning, and independent failure states.
- `website/src/components/plugins/PluginCard.tsx`: text-only metadata and install command UI.
- `website/src/pages/zh/plugins/index.astro`, `website/src/pages/en/plugins/index.astro`: localized marketplace routes.
- `website/src/styles/plugins.css`: marketplace cards, skeletons, filters, and responsive layout.
- `website/test/npm-registry.test.ts`: endpoint, response validation, compatibility, and failure tests.
- `website/test/plugin-market.test.tsx`: independent loading/failure and search UI tests.

### Static quality and deployment

- `website/src/styles/global.css`: tokens, typography, focus, theme, header/footer, and reduced motion.
- `website/public/logo-placeholder.svg`, `website/public/favicon.svg`, `website/public/og-placeholder.svg`: replaceable brand assets.
- `website/public/robots.txt`: crawler and sitemap declarations.
- `website/scripts/check-built-site.ts`: expected-route, base-path, link-target, SEO, and locale-pair validation.
- `website/test/check-built-site.test.ts`: built-link resolver and validation fixture tests.
- `justfile`: website dev/check/build entry points.
- `.github/workflows/ci.yml`: run website checks for pushes and pull requests.
- `.github/workflows/pages.yml`: build and deploy `website/dist` on `main`.

---

### Task 1: Bootstrap the isolated Astro/Starlight website

**Files:**
- Create: `website/package.json`
- Create: `website/bun.lock`
- Create: `website/astro.config.ts`
- Create: `website/tsconfig.json`
- Create: `website/vitest.config.ts`
- Create: `website/biome.json`
- Create: `website/.gitignore`
- Create: `website/src/content.config.ts`
- Create: `website/src/content/docs/.gitkeep`
- Create: `website/src/lib/site.ts`
- Test: `website/test/site.test.ts`

**Interfaces:**
- Produces: `SITE_ORIGIN`, `BASE_PATH`, `SUPPORTED_LANGUAGES`, `Language`, `isLanguage(value)`, `withBase(path)` from `src/lib/site.ts`.
- Consumes: no earlier task interfaces.

- [ ] **Step 1: Write the failing site-constant test**

```ts
import { describe, expect, it } from "vitest";
import { BASE_PATH, SITE_ORIGIN, SUPPORTED_LANGUAGES, isLanguage, withBase } from "../src/lib/site";

describe("site configuration", () => {
  it("uses the GitHub project Pages origin and base", () => {
    expect(SITE_ORIGIN).toBe("https://twinklerg.github.io");
    expect(BASE_PATH).toBe("/CodeN");
    expect(withBase("/en/plugins/")).toBe("/CodeN/en/plugins/");
    expect(withBase("/CodeN/en/")).toBe("/CodeN/en/");
  });

  it("accepts only the first-release locales", () => {
    expect(SUPPORTED_LANGUAGES).toEqual(["zh", "en"]);
    expect(isLanguage("zh")).toBe(true);
    expect(isLanguage("en")).toBe(true);
    expect(isLanguage("ja")).toBe(false);
  });
});
```

- [ ] **Step 2: Run the focused test and verify the missing module failure**

Run: `cd website && bunx vitest run test/site.test.ts`

Expected: FAIL because `../src/lib/site` and the website test dependencies do not exist.

- [ ] **Step 3: Create the private package and tool configuration**

Use this dependency floor in `website/package.json` (a fresh `bun install` may resolve newer compatible patch/minor versions into `website/bun.lock`):

```json
{
  "name": "@twinklerg/coden-website",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "bun run docs:generate && astro dev",
    "docs:generate": "bun run scripts/generate-docs.ts",
    "docs:check": "bun run scripts/generate-docs.ts --check",
    "build": "bun run docs:check && astro build",
    "typecheck": "astro check",
    "lint": "biome check .",
    "test": "vitest run",
    "check:built": "bun run scripts/check-built-site.ts",
    "check": "bun run docs:check && bun run lint && bun run typecheck && bun run test && bun run build && bun run check:built"
  },
  "dependencies": {
    "@astrojs/react": "^6.0.4",
    "@astrojs/sitemap": "^3.7.3",
    "@astrojs/starlight": "^0.41.10",
    "astro": "^7.2.9",
    "react": "^19.2.0",
    "react-dom": "^19.2.0"
  },
  "devDependencies": {
    "@astrojs/check": "^0.9.6",
    "@biomejs/biome": "^2.5.10",
    "@testing-library/jest-dom": "^6.9.1",
    "@testing-library/react": "^16.3.0",
    "@testing-library/user-event": "^14.6.1",
    "@types/node": "^24.3.0",
    "@types/react": "^19.2.0",
    "@types/react-dom": "^19.2.0",
    "jsdom": "^27.0.0",
    "typescript": "^5.9.2",
    "vitest": "^4.1.0"
  }
}
```

Configure Astro with `react()`, `sitemap()`, and `starlight()` integrations. Configure Starlight locales as `zh: { label: "简体中文", lang: "zh-CN" }` and `en: { label: "English", lang: "en" }`, `defaultLocale: "zh"`, and edit links rooted at `https://github.com/TwinklerG/CodeN/edit/main/website/`. Add `website/src/content/docs/.gitkeep` so the empty collection directory exists before Task 2; Task 2 adds the autogenerated sidebar and Task 3 adds custom CSS and the title override. Configure the docs collection exactly as recommended by Starlight:

```ts
import { defineCollection } from "astro:content";
import { docsLoader } from "@astrojs/starlight/loaders";
import { docsSchema } from "@astrojs/starlight/schema";

export const collections = {
  docs: defineCollection({ loader: docsLoader(), schema: docsSchema() }),
};
```

Use the Astro strict TypeScript preset. Scope `website/biome.json` to `src/**/*.ts`, `src/**/*.tsx`, `test/**/*.ts`, `test/**/*.tsx`, `scripts/**/*.ts`, `*.ts`, and `*.json`; Astro files remain covered by `astro check`.

- [ ] **Step 4: Implement the site constants**

```ts
export const SITE_ORIGIN = "https://twinklerg.github.io";
export const BASE_PATH = "/CodeN";
export const SUPPORTED_LANGUAGES = ["zh", "en"] as const;
export type Language = (typeof SUPPORTED_LANGUAGES)[number];

export function isLanguage(value: unknown): value is Language {
  return typeof value === "string" && SUPPORTED_LANGUAGES.includes(value as Language);
}

export function withBase(pathname: string): string {
  const normalized = pathname.startsWith("/") ? pathname : `/${pathname}`;
  return normalized === BASE_PATH || normalized.startsWith(`${BASE_PATH}/`)
    ? normalized
    : `${BASE_PATH}${normalized}`;
}
```

- [ ] **Step 5: Install and run the focused checks**

Run:

```bash
cd website
bun install
bun run test -- test/site.test.ts
bun run typecheck
```

Expected: the focused test passes; typecheck may report only missing files referenced by the planned Starlight config, which must be removed from the config until their creating task or created as empty valid files now. Do not leave a knowingly broken configuration.

- [ ] **Step 6: Commit the website foundation**

```bash
git add website/package.json website/bun.lock website/astro.config.ts website/tsconfig.json website/vitest.config.ts website/biome.json website/.gitignore website/src/content.config.ts website/src/content/docs/.gitkeep website/src/lib/site.ts website/test/site.test.ts
git commit -m "build(website): bootstrap Astro and Starlight"
```

### Task 2: Generate the complete bilingual documentation scaffold

**Files:**
- Create: `website/src/data/docs.ts`
- Create: `website/src/lib/docs-scaffold.ts`
- Create: `website/scripts/generate-docs.ts`
- Create: `website/src/content/docs/zh/docs/**/*.mdx`
- Create: `website/src/content/docs/en/docs/**/*.mdx`
- Test: `website/test/docs-scaffold.test.ts`
- Modify: `website/astro.config.ts`

**Interfaces:**
- Consumes: `Language`, `SUPPORTED_LANGUAGES` from `src/lib/site.ts`.
- Produces: `DOC_GROUPS`, `DocGroup`, `DocPage`, `allDocEntries()`, `renderScaffold(entry)`, and `expectedDocFiles(root)`.

- [ ] **Step 1: Write failing manifest and rendering tests**

```ts
import { describe, expect, it } from "vitest";
import { DOC_GROUPS } from "../src/data/docs";
import { allDocEntries, renderScaffold } from "../src/lib/docs-scaffold";

describe("documentation scaffold", () => {
  it("has unique slugs and complete translations", () => {
    const entries = allDocEntries();
    expect(new Set(entries.map((entry) => entry.slug)).size).toBe(entries.length);
    for (const entry of entries) {
      expect(entry.zh.title.length).toBeGreaterThan(0);
      expect(entry.en.title.length).toBeGreaterThan(0);
    }
  });

  it("contains the approved top-level groups", () => {
    expect(DOC_GROUPS.map((group) => group.slug)).toEqual([
      "getting-started",
      "concepts",
      "interfaces",
      "configuration",
      "skills",
      "plugins",
      "hooks",
      "advanced",
      "reference",
    ]);
  });

  it("renders a minimal localized MDX page", () => {
    const hooks = allDocEntries().find((entry) => entry.slug === "hooks/events");
    expect(hooks).toBeDefined();
    expect(renderScaffold(hooks!, "zh")).toContain("title: Agent Hooks 事件");
    expect(renderScaffold(hooks!, "zh")).toContain("本页面已建立文档结构");
    expect(renderScaffold(hooks!, "en")).toContain("This page establishes the documentation structure");
  });
});
```

- [ ] **Step 2: Run the test and verify it fails for missing docs modules**

Run: `cd website && bun run test -- test/docs-scaffold.test.ts`

Expected: FAIL because `src/data/docs.ts` and `src/lib/docs-scaffold.ts` do not exist.

- [ ] **Step 3: Define the canonical manifest**

Implement `DOC_GROUPS` with these exact slugs; every group and child carries `{ zh: { title, description }, en: { title, description } }` and a numeric order:

```text
getting-started: requirements, installation, provider, interfaces, first-task
concepts: agent-loop, workspace, tools-and-risk, approval-modes, sessions, context-and-thinking
interfaces: cli, tui, print-mode, slash-commands, cli-options
configuration: precedence, scopes, environment, openai, anthropic, language-and-thinking, reference, data-security
skills: discovery, create, install-and-debug
plugins: local-typescript, npm-management, author-protocol, trust-and-security, marketplace
hooks: events, matchers, protocol, decisions, execution, trust-and-security, examples
advanced: smart-approval, outside-workspace, session-storage, custom-base-url, automation
reference: cli, configuration, troubleshooting, faq, security-model
```

Also include the docs landing entry with slug `index`. Keep descriptions to one sentence stating the intended future scope; do not copy detailed README prose.

- [ ] **Step 4: Implement deterministic scaffold rendering and generation**

`renderScaffold(entry, language)` must emit deterministic MDX with frontmatter and one localized note:

```mdx
---
title: <localized title>
description: <localized one-sentence scope>
sidebar:
  order: <numeric order>
---

:::note[文档框架]
本页面已建立文档结构，完整内容将在后续文档任务中补充。
:::
```

The English equivalent uses `Documentation scaffold` and `This page establishes the documentation structure. Complete content will be added in a dedicated documentation task.`

`generate-docs.ts` must use only `node:fs/promises`, `node:path`, and `node:process`. Normal mode creates directories and writes changed files. `--check` compares every expected file byte-for-byte, reports missing/stale/unexpected generated `.mdx` files, and exits non-zero without changing files.

- [ ] **Step 5: Generate all committed pages and configure the sidebar**

Run: `cd website && bun run docs:generate`

Configure Starlight sidebar as one locale-aware autogenerated tree:

```ts
sidebar: [{ autogenerate: { directory: "docs" } }],
```

Verify generated routes include `/zh/docs/`, `/en/docs/`, `/zh/docs/hooks/events/`, and `/en/docs/hooks/events/`.

- [ ] **Step 6: Run scaffold tests and a production build**

Run:

```bash
cd website
bun run test -- test/docs-scaffold.test.ts
bun run docs:check
bun run build
```

Expected: tests and generation check pass; Starlight builds all bilingual pages and creates Pagefind search assets without content-schema errors.

- [ ] **Step 7: Commit the documentation scaffold**

```bash
git add website/src/data/docs.ts website/src/lib/docs-scaffold.ts website/scripts/generate-docs.ts website/src/content/docs website/test/docs-scaffold.test.ts website/astro.config.ts
git commit -m "feat(website): add bilingual docs scaffold"
```

### Task 3: Add base-aware routing, i18n, shared shell, and SEO

**Files:**
- Create: `website/src/i18n/messages.ts`
- Create: `website/src/lib/routes.ts`
- Create: `website/src/components/Seo.astro`
- Create: `website/src/components/SiteHeader.astro`
- Create: `website/src/components/SiteFooter.astro`
- Create: `website/src/components/docs/DocsSiteTitle.astro`
- Create: `website/src/layouts/ProductLayout.astro`
- Create: `website/src/pages/index.astro`
- Create: `website/src/pages/404.astro`
- Create: `website/src/pages/zh/index.astro`
- Create: `website/src/pages/en/index.astro`
- Create: `website/src/styles/global.css`
- Test: `website/test/routes.test.ts`
- Modify: `website/astro.config.ts`

**Interfaces:**
- Consumes: `Language`, `BASE_PATH`, `SITE_ORIGIN`, `withBase()` from `src/lib/site.ts`.
- Produces: `messages`, `LocalizedMessages`, `routeFor(language, section, slug?)`, `alternateLanguagePath(pathname, target)`, and `preferredLanguage(languages)`.

- [ ] **Step 1: Write failing routing tests**

```ts
import { describe, expect, it } from "vitest";
import { alternateLanguagePath, preferredLanguage, routeFor } from "../src/lib/routes";

describe("localized routes", () => {
  it("builds base-aware product routes", () => {
    expect(routeFor("zh", "home")).toBe("/CodeN/zh/");
    expect(routeFor("en", "docs")).toBe("/CodeN/en/docs/");
    expect(routeFor("en", "plugins")).toBe("/CodeN/en/plugins/");
  });

  it("preserves the page when switching languages", () => {
    expect(alternateLanguagePath("/CodeN/zh/docs/hooks/events/", "en")).toBe(
      "/CodeN/en/docs/hooks/events/",
    );
  });

  it("selects Chinese only when it is explicitly preferred", () => {
    expect(preferredLanguage(["zh-CN", "en-US"])).toBe("zh");
    expect(preferredLanguage(["en-US"])).toBe("en");
    expect(preferredLanguage([])).toBe("en");
  });
});
```

- [ ] **Step 2: Run the test and verify the missing route module failure**

Run: `cd website && bun run test -- test/routes.test.ts`

Expected: FAIL because `src/lib/routes.ts` does not exist.

- [ ] **Step 3: Implement routing and typed localized messages**

Define `LocalizedMessages` once and make both locale objects satisfy it. Include navigation, Hero, feature, step, footer, marketplace, loading/error, compatibility warning, copy-state, and accessibility labels. Keep source prose concise and product-specific.

Implement route behavior with explicit section types:

```ts
export type ProductSection = "home" | "docs" | "plugins";

export function routeFor(language: Language, section: ProductSection, slug = ""): string;
export function alternateLanguagePath(pathname: string, target: Language): string;
export function preferredLanguage(languages: readonly string[]): Language;
```

`alternateLanguagePath` replaces only the locale path segment and falls back to `routeFor(target, "home")` for an unrecognized path. `preferredLanguage` returns `zh` when the first supported preference beginning with `zh` precedes an English preference; otherwise it returns `en`.

- [ ] **Step 4: Implement the product layout and accessible root entry**

`ProductLayout.astro` receives `{ language, title, description, section }`, sets `<html lang>`, renders `Seo`, skips-to-content, `SiteHeader`, `<main id="main-content">`, and `SiteFooter`. Add an inline theme bootstrap before paint that reads `localStorage.getItem("coden-theme")`, otherwise follows `prefers-color-scheme`; the toggle cycles light/dark and persists the explicit value.

`index.astro` must render visible Chinese and English links first, then run a small standard browser script using `navigator.languages` and `location.replace()` to choose `/CodeN/zh/` or `/CodeN/en/`. Do not create a blank redirect-only page.

`Seo.astro` must emit canonical, both `hreflang` alternates, `x-default`, description, Open Graph title/description/image, and theme-color metadata using `SITE_ORIGIN` and `BASE_PATH`.

- [ ] **Step 5: Add the shared header/footer and Starlight title override**

The product header contains brand placeholder, home/docs/plugins/GitHub links, language switch, and theme button. The footer contains GitHub, npm, docs, marketplace, MIT License, and the version read at build time from the root package using `new URL("../../../package.json", import.meta.url)` with standard `node:fs/promises` in the Astro frontmatter.

`DocsSiteTitle.astro` renders the same brand and product links inside Starlight’s header title area. Register it using:

```ts
components: {
  SiteTitle: "./src/components/docs/DocsSiteTitle.astro",
},
```

Do not replace Starlight search, language selection, theme selection, mobile menu, sidebar, or table of contents.

- [ ] **Step 6: Add global tokens and route shells**

Define semantic color, spacing, radius, shadow, content-width, and typography variables for light and dark themes. Use a purposeful system stack (`Inter`-style local system sans fallback plus `ui-monospace`) without remote font requests. Add `:focus-visible`, skip-link, responsive header, Starlight brand overrides, and `prefers-reduced-motion` rules.

The localized home files render `ProductLayout` with a temporary semantic heading and install command; Task 4 replaces only their body composition. The 404 page gives bilingual links to both home pages.

- [ ] **Step 7: Run focused and static checks**

Run:

```bash
cd website
bun run test -- test/routes.test.ts
bun run typecheck
bun run build
```

Expected: route tests pass; all product and docs routes build under `/CodeN/`; Starlight search, locale, and theme controls remain present.

- [ ] **Step 8: Commit the shared site shell**

```bash
git add website/src/i18n website/src/lib/routes.ts website/src/components/Seo.astro website/src/components/SiteHeader.astro website/src/components/SiteFooter.astro website/src/components/docs website/src/layouts website/src/pages/index.astro website/src/pages/404.astro website/src/pages/zh/index.astro website/src/pages/en/index.astro website/src/styles/global.css website/test/routes.test.ts website/astro.config.ts
git commit -m "feat(website): add bilingual site shell"
```

### Task 4: Build the polished landing page and CLI/TUI demo

**Files:**
- Create: `website/src/data/home.ts`
- Create: `website/src/components/home/HomePage.astro`
- Create: `website/src/components/home/Hero.astro`
- Create: `website/src/components/home/InstallCommand.tsx`
- Create: `website/src/components/home/TerminalDemo.tsx`
- Create: `website/src/components/home/Features.astro`
- Create: `website/src/components/home/GettingStarted.astro`
- Create: `website/src/styles/home.css`
- Test: `website/test/home-interactions.test.tsx`
- Modify: `website/src/pages/zh/index.astro`
- Modify: `website/src/pages/en/index.astro`

**Interfaces:**
- Consumes: `Language`, `messages`, and `routeFor()`.
- Produces: `HomePage({ language })`, `InstallCommand({ language })`, and `TerminalDemo({ language })`.

- [ ] **Step 1: Write failing interaction tests**

```tsx
// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { InstallCommand } from "../src/components/home/InstallCommand";
import { TerminalDemo } from "../src/components/home/TerminalDemo";

describe("home interactions", () => {
  it("copies the Bun install command", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    render(<InstallCommand language="en" />);
    await userEvent.click(screen.getByRole("button", { name: /copy/i }));
    expect(writeText).toHaveBeenCalledWith("bun add -g @twinklerg/coden");
  });

  it("switches from CLI to TUI with keyboard-accessible tabs", async () => {
    render(<TerminalDemo language="en" />);
    await userEvent.click(screen.getByRole("tab", { name: "TUI" }));
    expect(screen.getByRole("tabpanel")).toHaveTextContent("gpt-5-mini");
    expect(screen.getByRole("tab", { name: "TUI" })).toHaveAttribute("aria-selected", "true");
  });
});
```

- [ ] **Step 2: Run the tests and verify missing component failures**

Run: `cd website && bun run test -- test/home-interactions.test.tsx`

Expected: FAIL because the two React components do not exist.

- [ ] **Step 3: Implement command copy and terminal tabs**

`InstallCommand` defaults to Bun and offers npm as a secondary switch. It keeps exact command strings in constants, copies with `navigator.clipboard.writeText`, uses a live region for copied/failure feedback, and leaves text selectable when clipboard access is unavailable.

`TerminalDemo` uses `role="tablist"`, `role="tab"`, `aria-selected`, `aria-controls`, and `role="tabpanel"`. ArrowLeft/ArrowRight switch tabs. CLI content includes the current startup labels (model, approval mode, thinking, session ID), one user request, read/edit/test activity, and a concise completion. TUI content is a static full-screen miniature with transcript, bordered input, provider/model, workspace, approval, phase, and context status. Any progressive reveal is CSS-only and disabled under reduced motion.

- [ ] **Step 4: Implement the landing composition**

Create localized data for exactly six capability cards and three getting-started steps. `Hero.astro` renders product positioning, the prominent Bun command island, quick-start and GitHub actions, and the terminal island. `HomePage.astro` composes Hero, capabilities, workflow, a final install CTA, and the shared footer through `ProductLayout`.

Do not add external screenshots, testimonials, download counters, animated canvases, or remote fonts.

- [ ] **Step 5: Implement distinctive responsive styling**

Use an asymmetric two-column Hero on wide screens and a single column below 900px. The terminal card uses a restrained editor frame, subtle grid/noise made with CSS gradients, compact monospace typography, and theme-aware status colors. Capability cards use varied spans on desktop rather than a uniform six-card grid. Preserve readable line lengths and minimum 44px interactive targets on touch layouts.

- [ ] **Step 6: Replace localized home shells and run checks**

Both localized route files should be thin:

```astro
---
import HomePage from "../../components/home/HomePage.astro";
---

<HomePage language="en" />
```

Use `language="zh"` in the Chinese file.

Run:

```bash
cd website
bun run test -- test/home-interactions.test.tsx
bun run typecheck
bun run build
```

Expected: tests pass and both home pages contain the exact Bun command plus CLI/TUI controls.

- [ ] **Step 7: Commit the landing page**

```bash
git add website/src/data/home.ts website/src/components/home website/src/styles/home.css website/src/pages/zh/index.astro website/src/pages/en/index.astro website/test/home-interactions.test.tsx
git commit -m "feat(website): build CodeN landing page"
```

### Task 5: Implement the runtime npm plugin marketplace

**Files:**
- Create: `website/src/data/plugins.ts`
- Create: `website/src/lib/npm-registry.ts`
- Create: `website/src/components/plugins/PluginMarket.tsx`
- Create: `website/src/components/plugins/PluginCard.tsx`
- Create: `website/src/pages/zh/plugins/index.astro`
- Create: `website/src/pages/en/plugins/index.astro`
- Create: `website/src/styles/plugins.css`
- Test: `website/test/npm-registry.test.ts`
- Test: `website/test/plugin-market.test.tsx`

**Interfaces:**
- Consumes: `Language`, `messages`, `ProductLayout`, and `routeFor()`.
- Produces: `PLUGIN_CATALOG`, `PluginCatalogEntry`, `PluginSnapshot`, `registryUrls(packageName)`, `normalizeRepositoryUrl(value)`, and `loadPlugin(packageName, fetcher?, timeoutMs?)`.

- [ ] **Step 1: Write failing npm adapter tests**

```ts
import { describe, expect, it, vi } from "vitest";
import { loadPlugin, normalizeRepositoryUrl, registryUrls } from "../src/lib/npm-registry";

describe("npm registry adapter", () => {
  it("encodes package names for both npm endpoints", () => {
    expect(registryUrls("@scope/plugin")).toEqual({
      metadata: "https://registry.npmjs.org/%40scope%2Fplugin/latest",
      downloads: "https://api.npmjs.org/downloads/point/last-month/%40scope%2Fplugin",
    });
  });

  it("normalizes only secure repository links", () => {
    expect(normalizeRepositoryUrl({ url: "git+https://github.com/acme/plugin.git" })).toBe(
      "https://github.com/acme/plugin",
    );
    expect(normalizeRepositoryUrl("javascript:alert(1)")).toBeUndefined();
  });

  it("flags incompatible coden metadata without rejecting display data", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        name: "coden-msb",
        version: "0.1.0",
        description: "Sandbox plugin",
        coden: { apiVersion: 2 },
      })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ downloads: 132 })));
    const result = await loadPlugin("coden-msb", fetcher);
    expect(result.compatible).toBe(false);
    expect(result.downloads).toBe(132);
  });
});
```

- [ ] **Step 2: Run the adapter test and verify the missing module failure**

Run: `cd website && bun run test -- test/npm-registry.test.ts`

Expected: FAIL because `src/lib/npm-registry.ts` does not exist.

- [ ] **Step 3: Implement the allowlist and npm adapter**

Define the catalog exactly:

```ts
export const PLUGIN_CATALOG = [
  { packageName: "coden-modern-unix", featured: true, category: "developer-tools", order: 10 },
  { packageName: "coden-msb", featured: true, category: "sandbox", order: 20 },
] as const;
```

`PluginSnapshot` contains `packageName`, optional `version`, `description`, `license`, `homepage`, `repository`, `downloads`, `apiVersion`, `compatible`, and optional `error`. Validate that returned metadata name equals the requested package. Treat missing `coden` or `coden.apiVersion !== 1` as incompatible. Parse unknown JSON defensively; never cast unknown values directly into rendered fields.

`loadPlugin` launches metadata and download requests concurrently and consumes them with `Promise.allSettled`. A metadata failure returns a snapshot with `error` while preserving the package name. A download failure leaves `downloads` undefined but does not turn valid metadata into a full failure. Use `AbortController` and a default 8,000ms timeout, clearing the timer in `finally`.

- [ ] **Step 4: Write failing marketplace UI tests**

```tsx
// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { PluginMarket } from "../src/components/plugins/PluginMarket";

it("keeps a successful plugin visible when another request fails", async () => {
  const loader = vi.fn(async (name: string) =>
    name === "coden-modern-unix"
      ? { packageName: name, version: "1.0.1", compatible: true, downloads: 277 }
      : { packageName: name, compatible: false, error: "unavailable" },
  );
  render(<PluginMarket language="en" loader={loader} />);
  expect(await screen.findByText("coden-modern-unix")).toBeInTheDocument();
  expect(screen.getByText(/temporarily unavailable/i)).toBeInTheDocument();
});

it("filters by package name", async () => {
  render(<PluginMarket language="en" loader={async (name) => ({ packageName: name, compatible: true })} />);
  await waitFor(() => expect(screen.queryByLabelText(/loading/i)).not.toBeInTheDocument());
  await userEvent.type(screen.getByRole("searchbox"), "unix");
  expect(screen.getByText("coden-modern-unix")).toBeInTheDocument();
  expect(screen.queryByText("coden-msb")).not.toBeInTheDocument();
});
```

- [ ] **Step 5: Implement marketplace components and pages**

`PluginMarket` loads each allowlisted package independently on mount, exposes a localized searchbox, and maintains deterministic catalog order. `PluginCard` renders text nodes only, formats last-month downloads with `Intl.NumberFormat(language)`, exposes npm/homepage/repository links only after secure normalization, shows `coden.apiVersion`, and provides this exact copyable command:

```text
coden plugin install npm:<package-name>
```

Loading cards retain package names. Failed cards retain package names and installation commands. Incompatible cards show a warning rather than a verified-compatible badge. The page includes the explicit full-process-permission safety notice from the spec.

Each locale route wraps the React island in `ProductLayout`, supplies localized title/description, imports `plugins.css`, and hydrates with `client:load`.

- [ ] **Step 6: Run marketplace tests and build**

Run:

```bash
cd website
bun run test -- test/npm-registry.test.ts test/plugin-market.test.tsx
bun run typecheck
bun run build
```

Expected: all tests pass; the build performs no npm requests because requests happen only in the hydrated browser component.

- [ ] **Step 7: Commit the marketplace**

```bash
git add website/src/data/plugins.ts website/src/lib/npm-registry.ts website/src/components/plugins website/src/pages/zh/plugins website/src/pages/en/plugins website/src/styles/plugins.css website/test/npm-registry.test.ts website/test/plugin-market.test.tsx
git commit -m "feat(website): add npm plugin marketplace"
```

### Task 6: Add replaceable brand assets and built-site verification

**Files:**
- Create: `website/public/logo-placeholder.svg`
- Create: `website/public/favicon.svg`
- Create: `website/public/og-placeholder.svg`
- Create: `website/public/robots.txt`
- Create: `website/scripts/check-built-site.ts`
- Test: `website/test/check-built-site.test.ts`
- Modify: `website/src/components/Seo.astro`
- Modify: `website/src/components/SiteHeader.astro`
- Modify: `website/src/components/docs/DocsSiteTitle.astro`
- Modify: `website/src/styles/global.css`

**Interfaces:**
- Consumes: `BASE_PATH`, `SITE_ORIGIN`, all expected docs entries, and route helpers.
- Produces: `extractInternalReferences(html)`, `resolveBuiltTarget(distRoot, sourceFile, reference)`, `validateBuiltSite(distRoot)`.

- [ ] **Step 1: Write failing built-link resolver tests**

```ts
import path from "node:path";
import { describe, expect, it } from "vitest";
import { extractInternalReferences, resolveBuiltTarget } from "../scripts/check-built-site";

describe("built site validation", () => {
  it("extracts local href and src values but ignores external links", () => {
    const html = '<a href="/CodeN/en/docs/"></a><img src="/CodeN/favicon.svg"><a href="https://npmjs.com/x"></a>';
    expect(extractInternalReferences(html)).toEqual(["/CodeN/en/docs/", "/CodeN/favicon.svg"]);
  });

  it("maps a pretty route to its generated index file", () => {
    expect(resolveBuiltTarget("/tmp/dist", "/tmp/dist/en/index.html", "/CodeN/en/docs/")).toBe(
      path.join("/tmp/dist", "en/docs/index.html"),
    );
  });

  it("rejects a root-relative URL that escapes the project base", () => {
    expect(() => resolveBuiltTarget("/tmp/dist", "/tmp/dist/en/index.html", "/en/docs/")).toThrow(
      /outside \/CodeN/,
    );
  });
});
```

- [ ] **Step 2: Run the test and verify the missing checker failure**

Run: `cd website && bun run test -- test/check-built-site.test.ts`

Expected: FAIL because `scripts/check-built-site.ts` does not exist.

- [ ] **Step 3: Implement deterministic static validation**

Use only Node filesystem/path APIs. Walk all built `.html` files, extract quoted `href` and `src` attributes, ignore `http:`, `https:`, `mailto:`, fragment-only, and `data:` references, remove query/hash, require root-relative references to begin `/CodeN/`, and resolve pretty routes to `index.html`. Report every missing target before exiting non-zero.

`validateBuiltSite()` must also assert these files/routes:

```text
index.html
zh/index.html
en/index.html
zh/docs/index.html
en/docs/index.html
zh/docs/hooks/events/index.html
en/docs/hooks/events/index.html
zh/plugins/index.html
en/plugins/index.html
404.html
pagefind/pagefind.js
sitemap-index.xml (or the sitemap filename emitted by the installed @astrojs/sitemap version)
```

For each localized product page, assert one canonical URL plus `zh`, `en`, and `x-default` alternates. For each documentation page, assert one canonical URL, reciprocal `zh`/`en` alternates, and Pagefind indexing markup. Compare the generated zh/en docs route sets after removing the locale segment.

- [ ] **Step 4: Add replaceable SVG assets and crawler metadata**

Create simple geometric CodeN placeholder SVGs with no embedded scripts, remote resources, or text converted to paths. Reference `/CodeN/favicon.svg` and `/CodeN/og-placeholder.svg` through `withBase()`.

`robots.txt` contains:

```text
User-agent: *
Allow: /CodeN/
Sitemap: https://twinklerg.github.io/CodeN/sitemap-index.xml
```

If the installed sitemap integration emits `sitemap-0.xml` plus `sitemap-index.xml`, keep the declaration above. If it emits only `sitemap.xml`, update both this declaration and the checker to that observed output.

- [ ] **Step 5: Run unit, build, and built-site checks**

Run:

```bash
cd website
bun run test -- test/check-built-site.test.ts
bun run build
bun run check:built
```

Expected: all expected routes, links, assets, locale pairs, canonical tags, hreflang tags, sitemap, and Pagefind assets validate.

- [ ] **Step 6: Commit static quality infrastructure**

```bash
git add website/public website/scripts/check-built-site.ts website/test/check-built-site.test.ts website/src/components/Seo.astro website/src/components/SiteHeader.astro website/src/components/docs/DocsSiteTitle.astro website/src/styles/global.css
git commit -m "test(website): verify static Pages output"
```

### Task 7: Integrate repository commands, CI, and GitHub Pages deployment

**Files:**
- Modify: `justfile`
- Modify: `.github/workflows/ci.yml`
- Create: `.github/workflows/pages.yml`

**Interfaces:**
- Consumes: website scripts `dev`, `check`, and `build`; output directory `website/dist`.
- Produces: `just website-dev`, `just website-check`, `just website-build`, CI website validation, and main-branch Pages deployment.

- [ ] **Step 1: Add repository command recipes**

Append exact cwd-scoped recipes without changing existing CLI recipes:

```just
# Start the product website locally
website-dev:
  cd website && bun run dev

# Lint, typecheck, test, build, and validate the product website
website-check:
  cd website && bun install --frozen-lockfile && bun run check

# Build the product website
website-build:
  cd website && bun install --frozen-lockfile && bun run build
```

Keep website dependency installation isolated from the root lockfile.

- [ ] **Step 2: Add a separate website job to CI**

Do not make the existing CLI job install website dependencies. Add this sibling job to `.github/workflows/ci.yml`:

```yaml
  website:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: latest
      - uses: extractions/setup-just@v4
      - name: Check website
        run: just website-check
```

This keeps CLI and website failures independently visible while still checking both on `main` and pull requests.

- [ ] **Step 3: Create the Pages workflow**

Use GitHub’s current official Pages actions and this trigger/permission structure:

```yaml
name: Deploy website

on:
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: true

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: latest
      - run: bun install --frozen-lockfile
        working-directory: website
      - run: bun run check
        working-directory: website
      - uses: actions/upload-pages-artifact@v4
        with:
          path: website/dist

  deploy:
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    runs-on: ubuntu-latest
    needs: build
    steps:
      - name: Deploy to GitHub Pages
        id: deployment
        uses: actions/deploy-pages@v5
```

Do not add website work to `.github/workflows/release.yml`; npm publishing remains independent.

- [ ] **Step 4: Run the complete local validation**

Run:

```bash
just check
just build
just website-check
git diff --check
git status --short
```

Expected:

- existing CLI lint, typecheck, tests, and build pass;
- all website docs checks, lint, typecheck, tests, static build, Pagefind generation, link checks, SEO checks, and locale checks pass;
- `git diff --check` reports no whitespace errors;
- root `package.json` and root `bun.lock` remain exactly as they were before website implementation and are not staged.

- [ ] **Step 5: Review the built artifact manually**

Run: `cd website && bun run dev --host 127.0.0.1`

Inspect these routes at the printed local base URL:

```text
/CodeN/
/CodeN/zh/
/CodeN/en/
/CodeN/zh/docs/
/CodeN/en/docs/hooks/events/
/CodeN/zh/plugins/
/CodeN/en/plugins/
```

Verify desktop and narrow layouts, light and dark modes, keyboard navigation, language preservation, CLI/TUI tabs, command copy feedback, Pagefind language separation, both live npm cards, npm failure fallback using browser offline mode, and reduced motion using the browser preference emulator.

- [ ] **Step 6: Commit repository integration**

```bash
git add justfile .github/workflows/ci.yml .github/workflows/pages.yml
git commit -m "ci: deploy product website to GitHub Pages"
```

- [ ] **Step 7: Record final evidence**

Run:

```bash
git log -7 --oneline
git status --short
git diff --check HEAD~7..HEAD
```

Expected: the website work is split into focused commits, the only remaining working-tree entries are pre-existing user changes if still present, and the committed website range has no whitespace errors.
