import path from "node:path";
import { describe, expect, it } from "vitest";
import { extractInternalReferences, resolveBuiltTarget } from "../scripts/check-built-site";

describe("built site validation", () => {
  it("extracts local href and src values but ignores external links", () => {
    const html =
      '<a href="/CodeN/en/docs/"></a><img src="/CodeN/favicon.svg"><a href="https://npmjs.com/x"></a>';
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
