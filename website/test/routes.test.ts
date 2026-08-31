import { describe, expect, it } from "vitest";
import { alternateLanguagePath, preferredLanguage, routeFor } from "../src/lib/routes";

describe("localized routes", () => {
  it("builds base-aware product routes", () => {
    expect(routeFor("zh", "home")).toBe("/CodeN/zh/");
    expect(routeFor("en", "docs")).toBe("/CodeN/en/docs/");
    expect(routeFor("en", "plugins")).toBe("/CodeN/en/plugins/");
  });

  it("preserves the page when switching languages", () => {
    expect(alternateLanguagePath("/CodeN/zh/docs/hooks/events/", "en")).toBe(
      "/CodeN/en/docs/hooks/events/",
    );
  });

  it("selects Chinese only when it is explicitly preferred", () => {
    expect(preferredLanguage(["zh-CN", "en-US"])).toBe("zh");
    expect(preferredLanguage(["en-US"])).toBe("en");
    expect(preferredLanguage([])).toBe("en");
  });
});
