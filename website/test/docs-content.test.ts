import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { allDocEntries } from "../src/data/docs";

const SCAFFOLD_MARKERS = [
  "Documentation scaffold",
  "文档框架",
  "dedicated documentation task",
  "后续文档任务",
  "TBD",
  "TODO",
];

function blocks(source: string): string[] {
  return [...source.matchAll(/```[^\n]*\n([\s\S]*?)```/g)].map((match) => match[1].trim());
}

function links(source: string): string[] {
  return [...source.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)]
    .map((match) => match[1])
    .filter((target) => !target.startsWith("http"));
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
      expect(links(zh)).toEqual(links(en));
    },
  );

  it("keeps every internal link resolvable within the docs tree", async () => {
    const entries = allDocEntries();
    const expected = new Set(entries.map((entry) => entry.slug));
    for (const entry of entries) {
      for (const language of ["zh", "en"] as const) {
        const source = await page(language, entry.slug);
        for (const target of links(source)) {
          if (target.startsWith("#") || target.startsWith("/")) continue;
          const resolved = path.posix.normalize(
            path.posix.join(path.posix.dirname(entry.slug), target),
          );
          if (resolved.startsWith("../")) continue;
          const candidate = resolved.replace(/\.mdx?$/, "").replace(/\/$/, "");
          expect(
            expected.has(candidate),
            `broken link "${target}" from ${language}/${entry.slug}`,
          ).toBe(true);
        }
      }
    }
  });
});
