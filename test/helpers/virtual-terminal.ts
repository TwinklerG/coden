import { graphemes, graphemeWidth } from "../../src/observability/terminal-text.js";

export class VirtualTerminal {
  private readonly grid: string[][];
  private readonly touched: number[];
  cursor = { row: 0, column: 0 };

  constructor(
    private columns = 80,
    private readonly rows = 80,
  ) {
    this.grid = Array.from({ length: rows }, () => Array.from({ length: columns }, () => " "));
    this.touched = Array.from({ length: rows }, () => 0);
  }

  apply(chunk: string): void {
    let index = 0;
    while (index < chunk.length) {
      const character = chunk[index] ?? "";
      if (character === "\u001b" && chunk[index + 1] === "[") {
        const match = /^((?:\?\d+|\d*))(?:;(\d+))?([ABCDJKhl])/.exec(chunk.slice(index + 2));
        if (match) {
          const count = Number(match[1]?.replace("?", "") || 1);
          this.applyCsi(match[3] ?? "", count);
          index += 2 + match[0].length;
          continue;
        }
      }
      if (character === "\r") {
        this.cursor.column = 0;
      } else if (character === "\n") {
        this.cursor.row = Math.min(this.rows - 1, this.cursor.row + 1);
        this.cursor.column = 0;
      } else if (character >= " ") {
        const grapheme = graphemes(chunk.slice(index))[0] ?? character;
        this.write(grapheme);
        index += grapheme.length;
        continue;
      }
      index += 1;
    }
  }

  lines(): string[] {
    const last = this.touched.reduce((result, value, index) => (value > 0 ? index : result), 0);
    return this.grid
      .slice(0, last + 1)
      .map((line, row) => line.slice(0, this.touched[row]).join(""));
  }

  resize(columns: number): void {
    this.columns = columns;
  }

  private applyCsi(final: string, count: number): void {
    if (final === "A") this.cursor.row = Math.max(0, this.cursor.row - count);
    if (final === "B") this.cursor.row = Math.min(this.rows - 1, this.cursor.row + count);
    if (final === "C") this.cursor.column = Math.min(this.columns - 1, this.cursor.column + count);
    if (final === "K") this.eraseLine();
    if (final === "J") this.eraseDown();
  }

  private write(grapheme: string): void {
    const width = graphemeWidth(grapheme);
    if (this.cursor.column >= this.columns || this.cursor.column + width > this.columns) {
      this.cursor.column = 0;
      this.cursor.row = Math.min(this.rows - 1, this.cursor.row + 1);
    }
    const row = this.grid[this.cursor.row];
    if (!row) return;
    row[this.cursor.column] = grapheme;
    for (let offset = 1; offset < width; offset++) {
      if (this.cursor.column + offset < this.columns) {
        row[this.cursor.column + offset] = "";
      }
    }
    this.cursor.column += width;
    this.touched[this.cursor.row] = Math.max(
      this.touched[this.cursor.row] ?? 0,
      this.cursor.column,
    );
  }

  private eraseLine(): void {
    this.grid[this.cursor.row]?.fill(" ", this.cursor.column);
    this.touched[this.cursor.row] = this.cursor.column;
  }

  private eraseDown(): void {
    this.eraseLine();
    for (let row = this.cursor.row + 1; row < this.rows; row++) {
      this.grid[row]?.fill(" ");
      this.touched[row] = 0;
    }
  }
}
