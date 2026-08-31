import { describe, expect, it } from "vitest";
import { DOC_GROUPS } from "../src/data/docs";
import { allDocEntries, renderScaffold } from "../src/lib/docs-scaffold";

describe("documentation scaffold", () => {
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
      "getting-started",
      "concepts",
      "interfaces",
      "configuration",
      "skills",
      "plugins",
      "hooks",
      "advanced",
      "reference",
    ]);
  });

  it("renders a minimal localized MDX page", () => {
    const hooks = allDocEntries().find((entry) => entry.slug === "hooks/events");
    expect(hooks).toBeDefined();
    if (!hooks) return;

    expect(renderScaffold(hooks, "zh")).toContain("title: Agent Hooks 事件");
    expect(renderScaffold(hooks, "zh")).toContain("本页面已建立文档结构");
    expect(renderScaffold(hooks, "en")).toContain(
      "This page establishes the documentation structure",
    );
  });
});
