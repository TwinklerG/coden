#!/usr/bin/env node
// Migrate relative links in the bilingual docs to absolute BASE_PATH links.
// Usage: bun run scripts/rewrite-docs-links.ts
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { BASE_PATH } from "../src/lib/site.js";

const DOCS_ROOT = path.join(process.cwd(), "src", "content", "docs");

function collectMdx(directory: string, files: string[] = []): string[] {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const filePath = path.join(directory, entry.name);
    if (entry.isDirectory()) collectMdx(filePath, files);
    else if (entry.isFile() && entry.name.endsWith(".mdx")) files.push(filePath);
  }
  return files;
}

const files = collectMdx(DOCS_ROOT);
let changed = 0;

for (const file of files) {
  const rel = path.relative(DOCS_ROOT, file);
  const [language, , ...slugParts] = rel.split(path.sep);
  if (language !== "zh" && language !== "en") continue;
  const dirParts = slugParts.slice(0, -1);
  const dir = dirParts.join("/");
  const source = readFileSync(file, "utf8");
  const next = source.replace(/\]\((?<target>(?:\.\/|\.\.\/)[^)#]+)\)/g, (_match, target) => {
    const joined = target.replace(/^\.\.[/]|^\.\//, "");
    const targetDir = target.startsWith("../") ? dir.replace(/\/?[^/]+$/, "") : dir;
    const slug = [targetDir, joined].filter(Boolean).join("/");
    return `](${BASE_PATH}/${language}/docs/${slug}/)`;
  });
  if (next !== source) {
    writeFileSync(file, next);
    changed++;
  }
}
console.log(`rewrote links in ${changed} files`);
