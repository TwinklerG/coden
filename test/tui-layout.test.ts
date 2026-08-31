import { describe, expect, it } from "vitest";
import {
  calculateInputCursorTopRow,
  calculateTranscriptRows,
  TUI_RENDER_OPTIONS,
} from "../src/tui/app.js";
import { calculateInputBarLayout, inputRule } from "../src/tui/components/input-bar.js";

describe("TUI row allocation", () => {
  it("reserves two input rules and a status row", () => {
    expect(calculateTranscriptRows(24, 1)).toBe(20);
    expect(calculateTranscriptRows(24, 3)).toBe(18);
    expect(20 + 1 + 2 + 1).toBe(24);
  });

  it("always leaves one transcript row", () => {
    expect(calculateTranscriptRows(2, 3)).toBe(1);
  });

  it("offsets the real cursor past the upper input rule", () => {
    expect(calculateInputCursorTopRow(20)).toBe(21);
  });

  it("derives transcript allocation from the same editor layout", () => {
    const one = calculateInputBarLayout("a", 1, "en", 20);
    const two = calculateInputBarLayout("a\nb", 3, "en", 20);
    expect(calculateTranscriptRows(24, one.editor.rows.length)).toBe(20);
    expect(calculateTranscriptRows(24, two.editor.rows.length)).toBe(19);
  });

  it("draws at least one rule cell and follows terminal width", () => {
    expect(inputRule(0)).toBe("─");
    expect(inputRule(4)).toBe("────");
  });

  it("uses safe automatic Kitty keyboard detection", () => {
    expect(TUI_RENDER_OPTIONS.kittyKeyboard).toEqual({
      mode: "auto",
      flags: ["disambiguateEscapeCodes"],
    });
  });
});
