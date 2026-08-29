import { stripVTControlCharacters } from "node:util";
import { describe, expect, it } from "vitest";
import {
  renderTerminalTable,
  visibleWidth,
  wrapStyledText,
} from "../src/observability/markdown-table.js";

const visible = (text: string) => stripVTControlCharacters(text);

describe("renderTerminalTable", () => {
  it("draws full borders and respects left and right alignment", () => {
    const rendered = renderTerminalTable(
      {
        header: ["Name", "Status"],
        align: ["left", "right"],
        rows: [["项目", "OK"]],
      },
      80,
    );

    expect(visible(rendered)).toBe(
      [
        "┌──────┬────────┐",
        "│ Name │ Status │",
        "├──────┼────────┤",
        "│ 项目 │     OK │",
        "└──────┴────────┘",
      ].join("\n"),
    );
  });

  it("centers cells and keeps tables without body rows", () => {
    const rendered = renderTerminalTable({ header: ["Key"], align: ["center"], rows: [] }, 80);

    expect(visible(rendered)).toBe(["┌─────┐", "│ Key │", "├─────┤", "└─────┘"].join("\n"));
  });

  it("measures ANSI as zero columns, Chinese as two, and box drawing as one", () => {
    expect(visibleWidth("\u001b[1m项目\u001b[22m A")).toBe(6);
    expect(visibleWidth("┌─┐")).toBe(3);
  });

  it("wraps at whitespace and hard-wraps long tokens without loss", () => {
    expect(wrapStyledText("alpha beta", 5).map(visible)).toEqual(["alpha", "beta"]);
    expect(wrapStyledText("abcdefgh", 3).map(visible)).toEqual(["abc", "def", "gh"]);
  });

  it("balances ANSI styles in every wrapped fragment", () => {
    const lines = wrapStyledText("\u001b[31mabcdef\u001b[39m", 3);

    expect(lines.map(visible)).toEqual(["abc", "def"]);
    for (const line of lines) {
      expect(visibleWidth(line)).toBeLessThanOrEqual(3);
      expect(`${line}│`).toMatch(/\u001b\[0m│$/);
    }
  });

  it("shrinks the widest columns and normalizes visual row heights", () => {
    const rendered = visible(
      renderTerminalTable(
        {
          header: ["ID", "Description"],
          align: ["left", "left"],
          rows: [["1", "alpha beta gamma"]],
        },
        18,
      ),
    );
    const lines = rendered.split("\n");

    expect(lines.every((line) => visibleWidth(line) <= 18)).toBe(true);
    expect(rendered).toContain("alpha");
    expect(rendered).toContain("beta");
    expect(rendered).toContain("gamma");
    expect(lines.filter((line) => line.startsWith("│")).length).toBeGreaterThan(2);
  });

  it("uses a two-column minimum when a column contains wide characters", () => {
    const rendered = visible(
      renderTerminalTable({ header: ["A", "B"], align: ["left", "left"], rows: [["中", "x"]] }, 1),
    );
    const borders = rendered.split("\n").filter((line) => !line.startsWith("│"));

    expect(borders.every((line) => visibleWidth(line) === visibleWidth(borders[0] ?? ""))).toBe(
      true,
    );
    expect(rendered).toContain("中");
  });
});
