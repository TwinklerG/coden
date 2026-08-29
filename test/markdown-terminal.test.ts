import { stripVTControlCharacters } from "node:util";
import { describe, expect, it } from "vitest";
import { MarkdownStreamRenderer } from "../src/observability/markdown.js";

function harness(columns = 80) {
  let output = "";
  const renderer = new MarkdownStreamRenderer(
    (text) => {
      output += text;
    },
    () => columns,
  );
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

  it("exposes the sanitized raw incomplete line as a preview", () => {
    const h = harness();

    h.renderer.push("**bo\u001b[31m");
    expect(h.renderer.preview()).toBe("**bo");
    expect(h.output()).toBe("");

    h.renderer.push("ld**\n");
    expect(h.renderer.preview()).toBeUndefined();
    expect(h.output()).toBe("bold\n");
  });

  it("previews the latest buffered fenced-code line", () => {
    const h = harness();

    h.renderer.push("```ts\nconst first = 1;\n");
    expect(h.output()).toBe("");
    expect(h.renderer.preview()).toBe("const first = 1;");

    h.renderer.push("const second");
    expect(h.renderer.preview()).toBe("const second");

    h.renderer.push(" = 2;\n```\n");
    expect(h.renderer.preview()).toBeUndefined();
    expect(h.output()).toContain("const first = 1;\nconst second = 2;");
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
    expect(line.renderer.preview()).toBe("**final**");
    line.renderer.complete();
    expect(line.renderer.preview()).toBeUndefined();
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
    expect(h.renderer.preview()).toBe("discard me");
    h.renderer.reset();
    expect(h.renderer.preview()).toBeUndefined();
    h.renderer.push("safe\u001b[31mred\u001b[0m\u0007\n");
    expect(h.output()).toBe("safered\n");
  });

  it("buffers and renders a complete GFM table", () => {
    const h = harness();
    h.renderer.push("| Name | Status |\n");
    expect(h.output()).toBe("");
    expect(h.renderer.preview()).toBe("| Name | Status |");

    h.renderer.push("|:---|---:|\n| **项目** | `ok` |\n");
    expect(h.output()).toBe("");
    expect(h.renderer.preview()).toBe("| **项目** | `ok` |");

    h.renderer.complete();
    expect(h.output()).toContain("┌");
    expect(h.output()).toContain("│ Name");
    expect(h.output()).toContain("项目");
    expect(h.output()).toContain("ok");
    expect(h.output()).not.toContain("|:---|---:|");
  });

  it("supports GFM tables without outer pipes and flushes on a blank line", () => {
    const h = harness();
    h.renderer.push("Name | Value\n--- | ---:\na | 1\n\nAfter\n");

    expect(h.output()).toContain("┌");
    expect(h.output()).toContain("│ Name");
    expect(h.output()).toContain("After\n");
    expect(h.output().indexOf("└")).toBeLessThan(h.output().indexOf("After"));
  });

  it("falls back without losing pipe-containing prose or invalid delimiters", () => {
    const h = harness();
    h.renderer.push("use a | b here\nnot a delimiter\nAfter\n");
    h.renderer.complete();

    expect(h.output()).toContain("use a | b here\nnot a delimiter\nAfter\n");
    expect(h.output()).not.toContain("┌");
  });

  it("does not detect tables inside fenced code", () => {
    const h = harness();
    h.renderer.push("```text\n| a | b |\n| - | - |\n| 1 | 2 |\n```\n");

    expect(h.output()).toContain("| a | b |");
    expect(h.output()).not.toContain("┌");
  });

  it("recognizes table syntax split across provider deltas", () => {
    const h = harness();
    h.renderer.push("Name | Va");
    h.renderer.push("lue\n--- | ---");
    expect(h.output()).toBe("");
    h.renderer.push("\na | b");
    h.renderer.complete();

    expect(h.output()).toContain("┌");
    expect(h.output()).toContain("Value");
    expect(h.output()).toContain("a");
  });

  it("flushes a lone candidate on completion and drops table state on reset", () => {
    const lone = harness();
    lone.renderer.push("a | b");
    lone.renderer.complete();
    expect(lone.output()).toBe("a | b");

    const reset = harness();
    reset.renderer.push("a | b\n--- | ---\n1 | 2\n");
    reset.renderer.reset();
    reset.renderer.push("clean\n");
    expect(reset.output()).toBe("clean\n");
  });
});
