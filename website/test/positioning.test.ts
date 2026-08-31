import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { HOME_CONTENT } from "../src/data/home";
import { messages } from "../src/i18n/messages";

describe("product positioning", () => {
  it("leads with the hackable agent and pluggable tool plugin identity", async () => {
    expect(messages.zh.home.title).toBe("一个有意思的 Coding Agent");
    expect(messages.en.home.title).toBe("A hackable coding agent");
    expect(messages.zh.home.description).toContain("可插拔工具插件");
    expect(messages.en.home.description).toContain("pluggable tool plugins");
    expect(HOME_CONTENT.zh.hero.intro).toContain("可插拔工具插件");
    expect(HOME_CONTENT.en.hero.intro).toContain("Pluggable tool plugins");

    const packageJson = JSON.parse(
      await readFile(path.join(process.cwd(), "..", "package.json"), "utf8"),
    ) as { description?: string };
    expect(packageJson.description).toBe(
      "A hackable coding agent built around pluggable tool plugins",
    );
  });

  it("keeps the plugin security boundary visible", () => {
    expect(messages.zh.marketplace.notice).toContain("不是安全沙箱");
    expect(messages.en.marketplace.notice).toContain("not a security sandbox");
  });
});
