import { describe, expect, it } from "vitest";
import { DOC_GROUPS } from "../src/data/docs";
import { allDocEntries, renderScaffold } from "../src/lib/docs-scaffold";

describe("documentation metadata and scaffolds", () => {
  it("has unique slugs and complete translations", () => {
    const entries = allDocEntries();
    expect(new Set(entries.map((entry) => entry.slug)).size).toBe(entries.length);

    for (const entry of entries) {
      expect(entry.zh.title.length).toBeGreaterThan(0);
      expect(entry.en.title.length).toBeGreaterThan(0);
    }
  });

  it("contains the approved top-level groups", () => {
    expect(DOC_GROUPS.map((group) => group.slug)).toEqual([
      "start",
      "agent",
      "extend",
      "safety",
      "operate",
      "reference",
    ]);
  });

  it("renders a minimal localized MDX page", () => {
    const extensions = allDocEntries().find((entry) => entry.slug === "extend/choose-an-extension");
    expect(extensions).toBeDefined();
    if (!extensions) return;

    expect(renderScaffold(extensions, "zh")).toContain("title: 选择扩展机制");
    expect(renderScaffold(extensions, "zh")).toContain("本页面已建立文档结构");
    expect(renderScaffold(extensions, "en")).toContain(
      "This page establishes the documentation structure",
    );
  });
});
