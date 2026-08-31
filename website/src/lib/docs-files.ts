import type { Dirent } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { allDocEntries, renderScaffold } from "./docs-scaffold";
import { SUPPORTED_LANGUAGES } from "./site";

export type DocsSyncMode = "write" | "check";

export interface DocsSyncResult {
  expectedCount: number;
  created: string[];
  issues: string[];
}

interface ExpectedEntry {
  slug: string;
  filePath: string;
  language: (typeof SUPPORTED_LANGUAGES)[number];
}

function expectedEntries(root: string): ExpectedEntry[] {
  const entries: ExpectedEntry[] = [];
  for (const doc of allDocEntries()) {
    for (const language of SUPPORTED_LANGUAGES) {
      entries.push({
        slug: doc.slug,
        filePath: path.join(root, "src", "content", "docs", language, "docs", `${doc.slug}.mdx`),
        language,
      });
    }
  }
  return entries;
}

/**
 * Synchronizes the documentation inventory without ever touching authored
 * content: in "write" mode only missing files are created from scaffold
 * templates, and in "check" mode only the inventory (missing or unexpected
 * MDX files) is validated. Existing file bodies are never compared against
 * template output.
 */
export async function syncDocFiles(root: string, mode: DocsSyncMode): Promise<DocsSyncResult> {
  const docsRoot = path.join(root, "src", "content", "docs");
  const entries = expectedEntries(root);
  const desired = new Set(entries.map((entry) => entry.filePath));
  const bySlug = new Map(allDocEntries().map((doc) => [doc.slug, doc]));
  const created: string[] = [];
  const issues: string[] = [];

  if (mode === "write") {
    for (const entry of entries.sort((a, b) => a.filePath.localeCompare(b.filePath))) {
      try {
        await readFile(entry.filePath, "utf8");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        await mkdir(path.dirname(entry.filePath), { recursive: true });
        const doc = bySlug.get(entry.slug);
        if (!doc) continue;
        await writeFile(entry.filePath, renderScaffold(doc, entry.language));
        created.push(path.relative(root, entry.filePath));
      }
    }
  } else {
    const actual = new Set(await walkMdxFiles(docsRoot));
    for (const filePath of [...desired].sort()) {
      if (!actual.has(filePath)) issues.push(`missing: ${path.relative(root, filePath)}`);
    }
    for (const filePath of [...actual].sort()) {
      if (!desired.has(filePath)) issues.push(`unexpected: ${path.relative(root, filePath)}`);
    }
  }

  return {
    expectedCount: desired.size,
    created,
    issues,
  };
}

async function walkMdxFiles(directory: string): Promise<string[]> {
  const files: string[] = [];
  let entries: Dirent[] | undefined;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return files;
    throw error;
  }
  for (const entry of entries) {
    const filePath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await walkMdxFiles(filePath)));
    else if (entry.isFile() && entry.name.endsWith(".mdx")) files.push(filePath);
  }
  return files;
}

export { allDocEntries };
