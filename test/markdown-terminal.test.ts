import { stripVTControlCharacters } from "node:util";
import { describe, expect, it } from "vitest";
import { MarkdownStreamRenderer } from "../src/observability/markdown.js";

function harness() {
  let output = "";
  const renderer = new MarkdownStreamRenderer((text) => {
    output += text;
  });
  return { renderer, output: () => stripVTControlCharacters(output) };
}

describe("MarkdownStreamRenderer", () => {
  it("renders common Markdown without exposing delimiters", () => {
    const h = harness();
    h.renderer.push("# Heading\n**bold** and *italic* with `code`\n");
    h.renderer.push("- first\n1. second\n> quote\n[text](https://example.com)\n");

    const output = h.output();
    expect(output).toContain("Heading");
    expect(output).toContain("bold and italic with code");
    expect(output).toContain("• first");
    expect(output).toContain("1. second");
    expect(output).toContain("│ quote");
    expect(output).toContain("text (https://example.com)");
    expect(output).not.toContain("**bold**");
    expect(output).not.toContain("`code`");
    expect(output).not.toContain("[text](");
  });

  it("waits for a complete line across provider deltas", () => {
    const h = harness();
    h.renderer.push("**bo");
    expect(h.output()).toBe("");
    h.renderer.push("ld**\n");
    expect(h.output()).toBe("bold\n");
  });

  it("buffers a fenced block until its closing fence", () => {
    const h = harness();
    h.renderer.push("```ts\nconst value");
    expect(h.output()).toBe("");
    h.renderer.push(" = 1;\n```\nAfter\n");
    expect(h.output()).toContain("ts\nconst value = 1;\nAfter\n");
    expect(h.output()).not.toContain("```");
  });

  it("flushes incomplete lines and unclosed fences on completion", () => {
    const line = harness();
    line.renderer.push("**final**");
    line.renderer.complete();
    expect(line.output()).toBe("final");

    const fence = harness();
    fence.renderer.push("```text\nunclosed");
    fence.renderer.complete();
    expect(fence.output()).toContain("text\nunclosed");
    expect(fence.output()).not.toContain("```");
  });

  it("drops pending content on reset and strips terminal controls", () => {
    const h = harness();
    h.renderer.push("discard me");
    h.renderer.reset();
    h.renderer.push("safe\u001b[31mred\u001b[0m\u0007\n");
    expect(h.output()).toBe("safered\n");
  });

  it("keeps unsupported table syntax readable", () => {
    const h = harness();
    h.renderer.push("| a | b |\n| - | - |\n| 1 | 2 |\n");
    expect(h.output()).toContain("a");
    expect(h.output()).toContain("1");
    expect(h.output()).toContain("2");
  });
});
