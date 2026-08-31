import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const stylesRoot = new URL("../src/styles/", import.meta.url);

describe("documentation responsive styles", () => {
  it("keeps the Starlight title in a single-row layout", async () => {
    const docsCss = await readFile(new URL("docs.css", stylesRoot), "utf8");
    const titleRule = docsCss.match(/\.docs-title-shell\s*\{(?<declarations>[^}]*)\}/)?.groups
      ?.declarations;

    expect(titleRule).toContain("min-width: 0");
    expect(titleRule).toContain("flex-direction: row");
    expect(titleRule).toContain("padding: 0");
  });

  it("does not apply the product header mobile stack to the Starlight title", async () => {
    const globalCss = await readFile(new URL("global.css", stylesRoot), "utf8");
    const mobileRules = globalCss.slice(globalCss.indexOf("@media (max-width: 900px)"));
    const stackedHeaderRule = mobileRules.match(
      /\.site-header,\s*\.site-footer\s*\{(?<declarations>[^}]*)\}/,
    )?.groups?.declarations;

    expect(stackedHeaderRule).toContain("flex-direction: column");
    expect(mobileRules).not.toMatch(/\.docs-title-shell[^{}]*\{[^}]*flex-direction:\s*column/);
  });
});
