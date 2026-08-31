import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
    await expect(readFile(path.join(root, "src", "content", "docs"), "utf8")).rejects.toThrow();

    const first = await syncDocFiles(root, "write");
    expect(first.created).toHaveLength(first.expectedCount);
    expect(first.issues).toEqual([]);

    const authored = path.join(root, "src", "content", "docs", "zh", "docs", "index.mdx");
    await writeFile(authored, "---\ntitle: Authored\n---\n\n# Kept\n");

    const second = await syncDocFiles(root, "write");
    expect(second.created).toEqual([]);
    expect(second.issues).toEqual([]);
    expect(await readFile(authored, "utf8")).toContain("# Kept");
  });

  it("reports missing and unexpected MDX files in check mode without comparing bodies", async () => {
    const root = await temporaryRoot();
    await syncDocFiles(root, "write");

    const index = path.join(root, "src", "content", "docs", "en", "docs", "index.mdx");
    await writeFile(index, "---\ntitle: Custom\n---\n");
    await rm(index);

    const extra = path.join(root, "src", "content", "docs", "en", "docs", "extra.mdx");
    await mkdir(path.dirname(extra), { recursive: true });
    await writeFile(extra, "---\ntitle: Extra\n---\n");

    const result = await syncDocFiles(root, "check");
    expect(result.expectedCount).toBe(54);
    expect(result.issues.some((issue) => issue.startsWith("missing:"))).toBe(true);
    expect(result.issues.some((issue) => issue.startsWith("unexpected:"))).toBe(true);
    const custom = path.join(root, "src", "content", "docs", "zh", "docs", "index.mdx");
    await writeFile(custom, "---\ntitle: Custom zh\n---\n");
    const second = await syncDocFiles(root, "check");
    expect(second.issues.some((issue) => issue.includes("stale"))).toBe(false);
  });

  it("treats authored body differences as valid in check mode", async () => {
    const root = await temporaryRoot();
    await syncDocFiles(root, "write");
    const target = path.join(root, "src", "content", "docs", "zh", "docs", "index.mdx");
    await writeFile(target, "---\ntitle: Different\n---\n\n# Authored prose\n");
    const result = await syncDocFiles(root, "check");
    expect(result.issues.some((issue) => issue.startsWith("missing:"))).toBe(false);
    const relative = path.relative(root, target);
    expect(result.issues).not.toContain(`stale: ${relative}`);
  });
});
