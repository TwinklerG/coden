import { describe, expect, it } from "vitest";
import { alternateLanguagePath, preferredLanguage, routeFor } from "../src/lib/routes";

describe("localized routes", () => {
  it("builds base-aware product routes", () => {
    expect(routeFor("zh", "home")).toBe("/coden/zh/");
    expect(routeFor("en", "docs")).toBe("/coden/en/docs/");
    expect(routeFor("en", "plugins")).toBe("/coden/en/plugins/");
  });

  it("preserves the page when switching languages", () => {
    expect(alternateLanguagePath("/coden/zh/docs/extend/tool-plugins/", "en")).toBe(
      "/coden/en/docs/extend/tool-plugins/",
    );
  });

  it("selects Chinese only when it is explicitly preferred", () => {
    expect(preferredLanguage(["zh-CN", "en-US"])).toBe("zh");
    expect(preferredLanguage(["en-US"])).toBe("en");
    expect(preferredLanguage([])).toBe("en");
  });
});
