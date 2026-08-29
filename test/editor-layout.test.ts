import { describe, expect, it } from "vitest";
import { layoutEditor, offsetAtColumn } from "../src/cli/editor-layout.js";
import { displayWidth, graphemes } from "../src/observability/terminal-text.js";

describe("editor layout", () => {
  it("segments combining text and emoji as whole graphemes", () => {
    expect(graphemes("e\u0301👨‍👩‍👧‍👦中")).toEqual(["e\u0301", "👨‍👩‍👧‍👦", "中"]);
    expect(displayWidth("e\u0301👨‍👩‍👧‍👦中")).toBe(5);
  });

  it("uses > only on the first row and two spaces thereafter", () => {
    const layout = layoutEditor("abcd\n中文x", 8, 6);
    expect(layout.rows.map((row) => row.prefix)).toEqual(["> ", "  ", "  "]);
    expect(layout.rows.map((row) => [row.start, row.end])).toEqual([
      [0, 4],
      [5, 7],
      [7, 8],
    ]);
    expect(layout.cursor.column).toBe(3);
  });

  it("uses four-column tab stops and maps preferred columns", () => {
    const layout = layoutEditor("a\tb\nxy", 3, 10);
    const secondRow = layout.rows[1];
    expect(layout.rows[0]?.width).toBe(5);
    expect(secondRow).toBeDefined();
    if (!secondRow) {
      throw new Error("expected second row");
    }
    expect(offsetAtColumn(secondRow, 4)).toBe(6);
  });

  it("recomputes tab width after wrapping onto a new row", () => {
    const layout = layoutEditor("ab\t", 3, 5);
    expect(layout.rows.map((row) => row.text)).toEqual(["ab", "    "]);
    expect(layout.rows.map((row) => row.width)).toEqual([2, 4]);
  });

  it("keeps blank logical lines and a cursor at the trailing empty line", () => {
    const layout = layoutEditor("a\n\n", 3, 20);
    expect(layout.rows).toHaveLength(3);
    expect(layout.rows.map((row) => row.prefix)).toEqual(["> ", "  ", "  "]);
    expect(layout.cursor).toEqual({ row: 2, column: 2 });
  });
});
