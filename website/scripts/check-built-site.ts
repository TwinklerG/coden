import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const SITE_ORIGIN = "https://twinklerg.github.io";
const BASE_PATH = "/CodeN";

export function extractInternalReferences(html: string): string[] {
  const references = new Set<string>();
  const matcher = /\b(?:href|src)=(["'])([^"']+)\1/g;
  for (const match of html.matchAll(matcher)) {
    const reference = normalizeReference(match[2]);
    if (!reference) continue;
    if (!isInternalReference(reference)) continue;
    references.add(reference);
  }
  return [...references];
}

export function extractStylesheetReferences(html: string): string[] {
  const references: string[] = [];
  for (const match of html.matchAll(/<link\b[^>]*>/g)) {
    const tag = match[0];
    const rel = tag.match(/\brel=(["'])([^"']+)\1/)?.[2];
    const href = tag.match(/\bhref=(["'])([^"']+)\1/)?.[2];
    if (!rel?.split(/\s+/).includes("stylesheet") || !href) continue;
    const reference = normalizeReference(href);
    if (reference && isInternalReference(reference)) references.push(reference);
  }
  return references;
}

export function resolveBuiltTarget(
  distRoot: string,
  sourceFile: string,
  reference: string,
): string {
  const target = normalizeReference(reference);
  if (!target) {
    throw new Error(`Cannot resolve empty reference from ${sourceFile}`);
  }

  if (!target.startsWith(`${BASE_PATH}/`) && target !== BASE_PATH) {
    throw new Error(`Reference ${reference} is outside ${BASE_PATH}`);
  }

  const relative = target === BASE_PATH ? "" : target.slice(BASE_PATH.length + 1);
  if (relative.length === 0) {
    return path.join(distRoot, "index.html");
  }

  const resolved =
    target.endsWith("/") || path.extname(relative).length === 0
      ? path.join(distRoot, relative, "index.html")
      : path.join(distRoot, relative);

  return resolved;
}

export async function validateBuiltSite(distRoot: string): Promise<void> {
  const { htmlFiles, fileSet } = await listFiles(distRoot);
  const errors: string[] = [];

  for (const required of [
    "index.html",
    "zh/index.html",
    "en/index.html",
    "zh/docs/index.html",
    "en/docs/index.html",
    "zh/docs/hooks/events/index.html",
    "en/docs/hooks/events/index.html",
    "zh/plugins/index.html",
    "en/plugins/index.html",
    "404.html",
  ]) {
    if (!fileSet.has(path.join(distRoot, required))) {
      errors.push(`missing built file: ${required}`);
    }
  }

  if (!fileSet.has(path.join(distRoot, "pagefind", "pagefind.js"))) {
    errors.push("missing built file: pagefind/pagefind.js");
  }

  if (
    !(await hasAllPrefixedEntries(path.join(distRoot, "pagefind"), [
      "pagefind.zh-cn_",
      "pagefind.en_",
    ]))
  ) {
    errors.push("missing pagefind language metadata");
  }

  const sitemapCandidates = ["sitemap-index.xml", "sitemap.xml"];
  if (!(await hasAnyPrefixedEntry(distRoot, sitemapCandidates))) {
    errors.push("missing sitemap: sitemap-index.xml or sitemap.xml");
  }

  const docsZh = new Set<string>();
  const docsEn = new Set<string>();
  const stylesheetCache = new Map<string, string>();

  for (const filePath of htmlFiles) {
    const html = await readFile(filePath, "utf8");
    const relative = path.relative(distRoot, filePath);
    const references = extractInternalReferences(html);

    for (const reference of references) {
      const target = resolveBuiltTarget(distRoot, filePath, reference);
      if (!fileSet.has(target)) {
        errors.push(
          `${relative}: missing target for ${reference} -> ${path.relative(distRoot, target)}`,
        );
      }
    }

    if (relative === "index.html") {
      continue;
    }

    if (isProductPage(relative)) {
      const selfUrl = pageUrl(relative);
      assertLink(html, "canonical", selfUrl, relative, errors);
      assertAlternate(html, "zh", `${SITE_ORIGIN}${BASE_PATH}/zh/`, relative, errors);
      assertAlternate(html, "en", `${SITE_ORIGIN}${BASE_PATH}/en/`, relative, errors);
      assertAlternate(html, "x-default", `${SITE_ORIGIN}${BASE_PATH}/`, relative, errors);
      await assertLinkedStylesheetMarker(
        html,
        distRoot,
        filePath,
        "--coden-grid",
        relative,
        errors,
        stylesheetCache,
      );
      continue;
    }

    if (isDocsPage(relative)) {
      const locale = relative.startsWith("zh/") ? "zh" : "en";
      const counterpart = relative.replace(/^zh\//, "en/").replace(/^en\//, "zh/");
      const selfUrl = pageUrl(relative);
      const counterpartUrl = pageUrl(counterpart);
      const defaultUrl = pageUrl(relative.replace(/^(zh|en)\//, "zh/"));
      assertPagefindMarkup(html, relative, errors);
      await assertLinkedStylesheetMarker(
        html,
        distRoot,
        filePath,
        "--coden-doc-grid",
        relative,
        errors,
        stylesheetCache,
      );
      assertLink(html, "canonical", selfUrl, relative, errors);
      assertAlternate(html, locale, selfUrl, relative, errors);
      assertAlternate(html, locale === "zh" ? "en" : "zh", counterpartUrl, relative, errors);
      assertAlternate(html, "x-default", defaultUrl, relative, errors);
      const docsRelative = relative.replace(/^(zh|en)\//, "");
      (locale === "zh" ? docsZh : docsEn).add(docsRelative);
    }
  }

  if (!setsEqual(docsZh, docsEn)) {
    errors.push("zh/en docs route sets differ");
  }

  if (errors.length > 0) {
    throw new Error(errors.join("\n"));
  }
}

async function main(): Promise<void> {
  const distRoot = path.join(process.cwd(), "dist");
  await validateBuiltSite(distRoot);
  console.log(`validated built site at ${distRoot}`);
}

function normalizeReference(reference: string): string {
  const trimmed = reference.trim();
  if (!trimmed || trimmed.startsWith("#")) return "";
  const [withoutQuery] = trimmed.split("?");
  const [withoutHash] = withoutQuery.split("#");
  return withoutHash;
}

function isInternalReference(reference: string): boolean {
  if (reference.startsWith("//")) return false;
  if (/^[a-zA-Z][a-zA-Z\d+.-]*:/.test(reference)) return false;
  return reference.startsWith(`${BASE_PATH}/`) || reference === BASE_PATH;
}

async function listFiles(root: string): Promise<{ htmlFiles: string[]; fileSet: Set<string> }> {
  const files: string[] = [];
  await walk(root, files);
  return {
    htmlFiles: files.filter((file) => file.endsWith(".html")),
    fileSet: new Set(files),
  };
}

async function walk(directory: string, files: string[]): Promise<void> {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const filePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await walk(filePath, files);
    } else {
      files.push(filePath);
    }
  }
}

async function hasAllPrefixedEntries(root: string, prefixes: string[]): Promise<boolean> {
  try {
    const entries = await readdir(root, { withFileTypes: true });
    return prefixes.every((prefix) => entries.some((entry) => entry.name.startsWith(prefix)));
  } catch {
    return false;
  }
}

async function hasAnyPrefixedEntry(root: string, prefixes: string[]): Promise<boolean> {
  try {
    const entries = await readdir(root, { withFileTypes: true });
    return prefixes.some((prefix) => entries.some((entry) => entry.name.startsWith(prefix)));
  } catch {
    return false;
  }
}

function isProductPage(relative: string): boolean {
  return /^(zh|en)\/(index|plugins\/index)\.html$/.test(relative);
}

function isDocsPage(relative: string): boolean {
  return /^(zh|en)\/docs\/.+\.html$/.test(relative);
}

function pageUrl(relative: string): string {
  const route = relative.replace(/index\.html$/, "");
  return `${SITE_ORIGIN}${BASE_PATH}/${route}`;
}

function assertLink(
  html: string,
  rel: string,
  href: string,
  relative: string,
  errors: string[],
): void {
  const found = html.includes(`rel="${rel}"`) && html.includes(href);
  if (!found) {
    errors.push(`${relative}: missing ${rel} ${href}`);
  }
}

function assertAlternate(
  html: string,
  hreflang: string,
  href: string,
  relative: string,
  errors: string[],
): void {
  const found = html.includes(`hreflang="${hreflang}`) && html.includes(href);
  if (!found) {
    errors.push(`${relative}: missing alternate ${hreflang} -> ${href}`);
  }
}

function assertPagefindMarkup(html: string, relative: string, errors: string[]): void {
  if (!html.includes("data-pagefind-body")) {
    errors.push(`${relative}: missing Pagefind body marker`);
  }
}

async function assertLinkedStylesheetMarker(
  html: string,
  distRoot: string,
  sourceFile: string,
  marker: string,
  relative: string,
  errors: string[],
  cache: Map<string, string>,
): Promise<void> {
  const stylesheets = extractStylesheetReferences(html);
  for (const reference of stylesheets) {
    const target = resolveBuiltTarget(distRoot, sourceFile, reference);
    let css = cache.get(target);
    if (css === undefined) {
      try {
        css = await readFile(target, "utf8");
        cache.set(target, css);
      } catch {
        continue;
      }
    }
    if (css.includes(marker)) return;
  }
  errors.push(`${relative}: linked stylesheets are missing ${marker}`);
}

function setsEqual(left: Set<string>, right: Set<string>): boolean {
  if (left.size !== right.size) return false;
  for (const value of left) {
    if (!right.has(value)) return false;
  }
  return true;
}

if (process.argv[1]?.includes("check-built-site")) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
