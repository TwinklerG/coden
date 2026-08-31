import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { allDocEntries, expectedDocFiles, renderScaffold } from "../src/lib/docs-scaffold";
import { SUPPORTED_LANGUAGES } from "../src/lib/site";

const ROOT = process.cwd();
const DOCS_ROOT = path.join(ROOT, "src", "content", "docs");
const CHECK_MODE = process.argv.includes("--check");

async function main(): Promise<void> {
  const desired = new Map<string, string>();

  for (const entry of allDocEntries()) {
    for (const language of SUPPORTED_LANGUAGES) {
      const filePath = path.join(DOCS_ROOT, language, "docs", `${entry.slug}.mdx`);
      desired.set(filePath, renderScaffold(entry, language));
    }
  }

  await mkdir(DOCS_ROOT, { recursive: true });

  if (CHECK_MODE) {
    const issues = await collectIssues(desired);
    if (issues.length > 0) {
      for (const issue of issues) {
        console.error(issue);
      }
      process.exitCode = 1;
      return;
    }

    console.log(`checked ${desired.size} generated docs files`);
    return;
  }

  for (const [filePath, content] of desired) {
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, content);
  }

  console.log(`generated ${desired.size} docs files`);
}

async function collectIssues(desired: Map<string, string>): Promise<string[]> {
  const issues: string[] = [];
  const expectedPaths = new Set(expectedDocFiles(ROOT));
  const actualPaths = new Set(await walkGeneratedFiles(DOCS_ROOT));

  for (const filePath of expectedPaths) {
    if (!desired.has(filePath)) {
      continue;
    }

    try {
      const content = await readFile(filePath, "utf8");
      if (content !== desired.get(filePath)) {
        issues.push(`stale: ${path.relative(ROOT, filePath)}`);
      }
    } catch {
      issues.push(`missing: ${path.relative(ROOT, filePath)}`);
    }
  }

  for (const filePath of actualPaths) {
    if (!desired.has(filePath)) {
      issues.push(`unexpected: ${path.relative(ROOT, filePath)}`);
    }
  }

  return issues;
}

async function walkGeneratedFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  for (const language of SUPPORTED_LANGUAGES) {
    const baseDir = path.join(root, language, "docs");
    try {
      await collectMdxFiles(baseDir, files);
    } catch {
      // Missing directories are reported against the expected set.
    }
  }

  return files;
}

async function collectMdxFiles(directory: string, target: string[]): Promise<void> {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const filePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await collectMdxFiles(filePath, target);
    } else if (entry.isFile() && entry.name.endsWith(".mdx")) {
      target.push(filePath);
    }
  }
}

await main();
