import { describe, expect, it } from "vitest";
import {
  BASE_PATH,
  isLanguage,
  REPOSITORY_EDIT_URL,
  REPOSITORY_URL,
  SITE_ORIGIN,
  SUPPORTED_LANGUAGES,
  withBase,
} from "../src/lib/site";

describe("site configuration", () => {
  it("uses the GitHub project Pages origin and base", () => {
    expect(SITE_ORIGIN).toBe("https://twinklerg.github.io");
    expect(BASE_PATH).toBe("/coden");
    expect(withBase("/en/plugins/")).toBe("/coden/en/plugins/");
    expect(withBase("/coden/en/")).toBe("/coden/en/");
    expect(REPOSITORY_URL).toBe("https://github.com/TwinklerG/coden");
    expect(REPOSITORY_EDIT_URL).toBe("https://github.com/TwinklerG/coden/edit/main/website/");
  });

  it("accepts only the first-release locales", () => {
    expect(SUPPORTED_LANGUAGES).toEqual(["zh", "en"]);
    expect(isLanguage("zh")).toBe(true);
    expect(isLanguage("en")).toBe(true);
    expect(isLanguage("ja")).toBe(false);
  });
});
