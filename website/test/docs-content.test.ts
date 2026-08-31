import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { allDocEntries } from "../src/data/docs";
import { BASE_PATH } from "../src/lib/site";

const SCAFFOLD_MARKERS = [
  "Documentation scaffold",
  "文档框架",
  "dedicated documentation task",
  "后续文档任务",
  "TBD",
  "TODO",
];

/** Product-site routes that legitimately live outside the docs tree. */
const PRODUCT_ROUTES = new Set(["plugins/"]);

function blocks(source: string): string[] {
  return [...source.matchAll(/```[^\n]*\n([\s\S]*?)```/g)].map((match) => match[1].trim());
}

function links(source: string): string[] {
  return [...source.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)]
    .map((match) => match[1])
    .filter((target) => !target.startsWith("http"));
}

/** Normalizes language-specific absolute links to a language-neutral form. */
function normalized(target: string): string {
  return target.replace(/^\/coden\/(?:zh|en)\//, "/LANG/");
}

async function page(language: "zh" | "en", slug: string): Promise<string> {
  return readFile(
    path.join(process.cwd(), "src", "content", "docs", language, "docs", `${slug}.mdx`),
    "utf8",
  );
}

describe("documentation content", () => {
  it.each(allDocEntries())(
    "replaces the $slug scaffold with substantive bilingual content",
    async ({ slug, order }) => {
      for (const language of ["zh", "en"] as const) {
        const source = await page(language, slug);
        expect(source).toContain(`  order: ${order}`);
        for (const marker of SCAFFOLD_MARKERS) expect(source).not.toContain(marker);
        expect(source.length).toBeGreaterThan(800);
        expect((source.match(/^## /gm) ?? []).length).toBeGreaterThanOrEqual(2);
      }
    },
  );

  it.each(allDocEntries())(
    "keeps code blocks and internal links aligned for $slug",
    async ({ slug }) => {
      const zh = await page("zh", slug);
      const en = await page("en", slug);
      expect(blocks(zh)).toEqual(blocks(en));
      expect(links(zh).map(normalized)).toEqual(links(en).map(normalized));
    },
  );

  it("uses absolute base-aware links for every docs link", async () => {
    const entries = allDocEntries();
    for (const entry of entries) {
      for (const language of ["zh", "en"] as const) {
        const source = await page(language, entry.slug);
        for (const target of links(source)) {
          if (target.startsWith("#")) continue;
          const prefix = `${BASE_PATH}/${language}/docs/`;
          const productPrefix = `${BASE_PATH}/${language}/`;
          if (target.startsWith(prefix)) continue;
          if (target.startsWith(productPrefix)) {
            const rest = target.slice(productPrefix.length);
            expect(
              PRODUCT_ROUTES.has(rest),
              `product link "${target}" from ${language}/${entry.slug}`,
            ).toBe(true);
            continue;
          }
          expect(
            target.startsWith("/"),
            `non-absolute link "${target}" from ${language}/${entry.slug}`,
          ).toBe(true);
        }
      }
    }
  });

  it("keeps every docs link resolvable within the docs tree", async () => {
    const entries = allDocEntries();
    const expected = new Set(entries.map((entry) => entry.slug));
    for (const entry of entries) {
      for (const language of ["zh", "en"] as const) {
        const source = await page(language, entry.slug);
        for (const target of links(source)) {
          if (target.startsWith("#")) continue;
          const prefix = `${BASE_PATH}/${language}/docs/`;
          if (!target.startsWith(prefix)) continue;
          const slug = target.slice(prefix.length).replace(/\/$/, "");
          expect(expected.has(slug), `broken link "${target}" from ${language}/${entry.slug}`).toBe(
            true,
          );
        }
      }
    }
  });

  it("locks source-backed positioning and runtime boundaries", async () => {
    const zhIndex = await page("zh", "index");
    const enIndex = await page("en", "index");
    expect(zhIndex).toContain("以可插拔工具插件为特色的 Coding Agent");
    expect(enIndex).toContain("coding agent built around pluggable tool plugins");

    const zhCli = await page("zh", "reference/cli");
    const enCli = await page("en", "reference/cli");
    expect(zhCli).toContain("默认 `coden` 进入 CLI/REPL");
    expect(enCli).toContain("Plain `coden` enters the CLI/REPL");

    const zhPlugins = await page("zh", "reference/plugins");
    const enPlugins = await page("en", "reference/plugins");
    for (const source of [zhPlugins, enPlugins]) {
      expect(source).toContain("@twinklerg/coden/plugin");
      expect(source).toContain("bun install");
      expect(source).toContain(".js");
      expect(source).toContain(".mjs");
    }

    const zhSecurity = await page("zh", "safety/security-boundaries");
    const enSecurity = await page("en", "safety/security-boundaries");
    expect(zhSecurity).toContain("不是通用沙箱");
    expect(enSecurity).toContain("Not a general-purpose sandbox");
  });
});
