import { describe, expect, it } from "vitest";
import { BASE_PATH, isLanguage, SITE_ORIGIN, SUPPORTED_LANGUAGES, withBase } from "../src/lib/site";

describe("site configuration", () => {
  it("uses the GitHub project Pages origin and base", () => {
    expect(SITE_ORIGIN).toBe("https://twinklerg.github.io");
    expect(BASE_PATH).toBe("/CodeN");
    expect(withBase("/en/plugins/")).toBe("/CodeN/en/plugins/");
    expect(withBase("/CodeN/en/")).toBe("/CodeN/en/");
  });

  it("accepts only the first-release locales", () => {
    expect(SUPPORTED_LANGUAGES).toEqual(["zh", "en"]);
    expect(isLanguage("zh")).toBe(true);
    expect(isLanguage("en")).toBe(true);
    expect(isLanguage("ja")).toBe(false);
  });
});
