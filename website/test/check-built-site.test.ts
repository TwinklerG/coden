import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  extractInternalReferences,
  extractStylesheetReferences,
  resolveBuiltTarget,
} from "../scripts/check-built-site";

describe("built site validation", () => {
  it("extracts local href and src values but ignores external links", () => {
    const html =
      '<a href="/CodeN/en/docs/"></a><img src="/CodeN/favicon.svg"><a href="https://npmjs.com/x"></a>';
    expect(extractInternalReferences(html)).toEqual(["/CodeN/en/docs/", "/CodeN/favicon.svg"]);
  });

  it("extracts local stylesheet references regardless of attribute order", () => {
    const html = [
      '<link rel="stylesheet" href="/CodeN/_astro/home.css">',
      '<link href="/CodeN/_astro/theme.css" media="screen" rel="stylesheet">',
      '<link rel="preload" href="/CodeN/_astro/client.js">',
    ].join("");

    expect(extractStylesheetReferences(html)).toEqual([
      "/CodeN/_astro/home.css",
      "/CodeN/_astro/theme.css",
    ]);
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
