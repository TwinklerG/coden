import { stripVTControlCharacters } from "node:util";
import pc from "picocolors";
import { characterWidth, displayWidth } from "./terminal-text.js";

export type TableAlignment = "left" | "center" | "right";

export interface TerminalTable {
  header: string[];
  align: TableAlignment[];
  rows: string[][];
}

type StyledGlyph = {
  value: string;
  width: number;
  state: string;
};

const ESCAPE = "\u001b";
const RESET = `${ESCAPE}[0m`;
const ANSI_PREFIX = new RegExp(`^${ESCAPE}\\[[0-?]*[ -/]*[@-~]`);

export function visibleWidth(text: string): number {
  return displayWidth(stripVTControlCharacters(text));
}

function styledGlyphs(text: string): StyledGlyph[] {
  const glyphs: StyledGlyph[] = [];
  let offset = 0;
  let state = "";
  while (offset < text.length) {
    const ansi = text.slice(offset).match(ANSI_PREFIX)?.[0];
    if (ansi) {
      if (ansi.endsWith("m")) {
        state = ansi === `${ESCAPE}[m` || ansi === RESET ? "" : `${state}${ansi}`;
      }
      offset += ansi.length;
      continue;
    }
    const point = text.codePointAt(offset);
    if (point === undefined) break;
    const value = String.fromCodePoint(point);
    glyphs.push({ value, width: characterWidth(value), state });
    offset += value.length;
  }
  return glyphs;
}

function renderGlyphs(glyphs: StyledGlyph[]): string {
  return glyphs
    .map((glyph) => (glyph.state ? `${glyph.state}${glyph.value}${RESET}` : glyph.value))
    .join("");
}

function wrapGlyphs(glyphs: StyledGlyph[], columns: number): string[] {
  if (glyphs.length === 0) return [""];
  const lines: string[] = [];
  let remaining = glyphs;
  while (remaining.length > 0) {
    if (lines.length > 0) {
      while (remaining[0] && /\s/u.test(remaining[0].value)) remaining = remaining.slice(1);
      if (remaining.length === 0) break;
    }
    let used = 0;
    let take = 0;
    let lastWhitespace = -1;
    while (take < remaining.length) {
      const glyph = remaining[take];
      if (!glyph || (take > 0 && used + glyph.width > columns)) break;
      used += glyph.width;
      if (/\s/u.test(glyph.value)) lastWhitespace = take;
      take += 1;
      if (used >= columns) break;
    }
    if (take >= remaining.length) {
      lines.push(renderGlyphs(remaining));
      break;
    }
    if (lastWhitespace >= 0) {
      lines.push(renderGlyphs(remaining.slice(0, lastWhitespace)));
      remaining = remaining.slice(lastWhitespace + 1);
      while (remaining[0] && /\s/u.test(remaining[0].value)) remaining = remaining.slice(1);
      continue;
    }
    lines.push(renderGlyphs(remaining.slice(0, Math.max(1, take))));
    remaining = remaining.slice(Math.max(1, take));
  }
  return lines.length > 0 ? lines : [""];
}

export function wrapStyledText(text: string, columns: number): string[] {
  const width = Math.max(1, columns);
  return text.split("\n").flatMap((line) => wrapGlyphs(styledGlyphs(line), width));
}

function minimumWidth(values: string[]): number {
  return values.some((value) => styledGlyphs(value).some((glyph) => glyph.width > 1)) ? 2 : 1;
}

function naturalWidth(values: string[]): number {
  return Math.max(1, ...values.flatMap((value) => value.split("\n").map(visibleWidth)));
}

function allocateWidths(table: TerminalTable, columns: number): number[] {
  const columnCount = table.header.length;
  const values = table.header.map((header, index) => [
    header,
    ...table.rows.map((row) => row[index] ?? ""),
  ]);
  const minimums = values.map(minimumWidth);
  const widths = values.map(naturalWidth);
  const available = Math.max(
    minimums.reduce((sum, width) => sum + width, 0),
    columns - (3 * columnCount + 1),
  );
  while (widths.reduce((sum, width) => sum + width, 0) > available) {
    let widest = -1;
    for (let index = 0; index < widths.length; index += 1) {
      const width = widths[index] ?? 0;
      const minimum = minimums[index] ?? 1;
      if (width > minimum && (widest < 0 || width > (widths[widest] ?? 0))) widest = index;
    }
    if (widest < 0) break;
    widths[widest] = (widths[widest] ?? 1) - 1;
  }
  return widths;
}

function pad(text: string, width: number, align: TableAlignment): string {
  const remaining = Math.max(0, width - visibleWidth(text));
  const left = align === "right" ? remaining : align === "center" ? Math.floor(remaining / 2) : 0;
  return `${" ".repeat(left)}${text}${" ".repeat(remaining - left)}`;
}

function border(left: string, middle: string, right: string, widths: number[]): string {
  return pc.dim(`${left}${widths.map((width) => "─".repeat(width + 2)).join(middle)}${right}`);
}

function renderRow(cells: string[], align: TableAlignment[], widths: number[]): string[] {
  const wrapped = widths.map((width, index) => wrapStyledText(cells[index] ?? "", width));
  const height = Math.max(1, ...wrapped.map((lines) => lines.length));
  return Array.from({ length: height }, (_, lineIndex) => {
    const content = widths.map((width, columnIndex) =>
      pad(wrapped[columnIndex]?.[lineIndex] ?? "", width, align[columnIndex] ?? "left"),
    );
    return `${pc.dim("│")} ${content.join(` ${pc.dim("│")} `)} ${pc.dim("│")}`;
  });
}

export function renderTerminalTable(table: TerminalTable, columns: number): string {
  if (table.header.length === 0) return "";
  const widths = allocateWidths(table, Math.max(1, columns));
  const align = widths.map((_, index) => table.align[index] ?? "left");
  const lines = [
    border("┌", "┬", "┐", widths),
    ...renderRow(table.header, align, widths),
    border("├", "┼", "┤", widths),
    ...table.rows.flatMap((row) => renderRow(row, align, widths)),
    border("└", "┴", "┘", widths),
  ];
  return lines.join("\n");
}
