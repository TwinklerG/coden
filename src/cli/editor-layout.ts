import { graphemes, graphemeWidth } from "../observability/terminal-text.js";

export interface VisualPosition {
  offset: number;
  column: number;
}

export interface VisualRow {
  prefix: "> " | "  ";
  start: number;
  end: number;
  text: string;
  width: number;
  positions: VisualPosition[];
}

export interface EditorLayout {
  rows: VisualRow[];
  cursor: { row: number; column: number };
}

type Segment = {
  text: string;
  offset: number;
};

function normalizeBoundary(text: string, cursor: number): number {
  const target = Number.isFinite(cursor)
    ? Math.max(0, Math.min(text.length, Math.trunc(cursor)))
    : 0;
  let offset = 0;
  for (const grapheme of graphemes(text)) {
    const next = offset + grapheme.length;
    if (target < next) return offset;
    offset = next;
  }
  return offset;
}

function splitLogicalLines(text: string): Array<{ text: string; start: number }> {
  const lines: Array<{ text: string; start: number }> = [];
  let start = 0;
  while (start <= text.length) {
    const breakIndex = text.indexOf("\n", start);
    if (breakIndex === -1) {
      lines.push({ text: text.slice(start), start });
      break;
    }
    lines.push({ text: text.slice(start, breakIndex), start });
    start = breakIndex + 1;
    if (start === text.length) {
      lines.push({ text: "", start });
      break;
    }
  }
  if (lines.length === 0) lines.push({ text: "", start: 0 });
  return lines;
}

function logicalSegments(text: string, startOffset: number): Segment[] {
  const segments: Segment[] = [];
  let offset = startOffset;
  for (const grapheme of graphemes(text)) {
    segments.push({ text: grapheme, offset });
    offset += grapheme.length;
  }
  return segments;
}

function finalizedRow(
  prefix: "> " | "  ",
  start: number,
  end: number,
  text: string,
  width: number,
  positions: VisualPosition[],
): VisualRow {
  return { prefix, start, end, text, width, positions };
}

export function layoutEditor(
  text: string,
  cursor: number,
  terminalColumns: number,
  tabSize = 4,
): EditorLayout {
  const normalizedCursor = normalizeBoundary(text, cursor);
  const columns = Number.isFinite(terminalColumns) ? Math.trunc(terminalColumns) : 0;
  const contentColumns = Math.max(1, columns - 2);
  const resolvedTabSize = Number.isFinite(tabSize) && tabSize > 0 ? Math.trunc(tabSize) : 4;
  const rows: VisualRow[] = [];
  let visualRow = 0;
  let cursorRow = 0;
  let cursorColumn = 2;
  let cursorResolved = false;

  for (const line of splitLogicalLines(text)) {
    const segments = logicalSegments(line.text, line.start);
    if (segments.length === 0) {
      const positions = [{ offset: line.start, column: 0 }];
      rows.push(
        finalizedRow(visualRow === 0 ? "> " : "  ", line.start, line.start, "", 0, positions),
      );
      if (!cursorResolved && normalizedCursor === line.start) {
        cursorRow = rows.length - 1;
        cursorColumn = 2;
        cursorResolved = true;
      }
      visualRow += 1;
      continue;
    }

    const firstSegment = segments[0];
    if (!firstSegment) {
      continue;
    }

    let rowStart = firstSegment.offset;
    let rowText = "";
    let rowWidth = 0;
    let rowEnd = rowStart;
    let positions: VisualPosition[] = [{ offset: rowStart, column: 0 }];

    const flushRow = () => {
      rows.push(
        finalizedRow(visualRow === 0 ? "> " : "  ", rowStart, rowEnd, rowText, rowWidth, positions),
      );
      if (!cursorResolved && normalizedCursor === rowEnd) {
        cursorRow = rows.length - 1;
        cursorColumn = 2 + rowWidth;
        cursorResolved = true;
      }
      visualRow += 1;
    };

    for (const segment of segments) {
      const segmentWidth =
        segment.text === "\t"
          ? resolvedTabSize - (rowWidth % resolvedTabSize)
          : graphemeWidth(segment.text);
      const shouldWrap = rowText.length > 0 && rowWidth + segmentWidth > contentColumns;
      if (shouldWrap) {
        flushRow();
        rowStart = segment.offset;
        rowText = "";
        rowWidth = 0;
        rowEnd = rowStart;
        positions = [{ offset: rowStart, column: 0 }];
      }

      const width =
        segment.text === "\t"
          ? resolvedTabSize - (rowWidth % resolvedTabSize)
          : graphemeWidth(segment.text);

      if (
        !cursorResolved &&
        normalizedCursor === segment.offset &&
        positions.length === 1 &&
        rowText.length === 0
      ) {
        cursorRow = rows.length;
        cursorColumn = 2;
        cursorResolved = true;
      }

      const lastPosition = positions[positions.length - 1];
      if (
        !lastPosition ||
        lastPosition.offset !== segment.offset ||
        lastPosition.column !== rowWidth
      ) {
        positions.push({ offset: segment.offset, column: rowWidth });
      }
      rowText += segment.text === "\t" ? " ".repeat(width) : segment.text;
      rowWidth += width;
      rowEnd = segment.offset + segment.text.length;
      positions.push({ offset: rowEnd, column: rowWidth });
      if (!cursorResolved && normalizedCursor === rowEnd) {
        cursorRow = rows.length;
        cursorColumn = 2 + rowWidth;
        cursorResolved = true;
      }
    }

    flushRow();
  }

  if (!cursorResolved) {
    const lastRow = rows[rows.length - 1];
    cursorRow = lastRow ? rows.length - 1 : 0;
    cursorColumn =
      2 + (lastRow ? (lastRow.positions[lastRow.positions.length - 1]?.column ?? 0) : 0);
  }

  return { rows, cursor: { row: cursorRow, column: cursorColumn } };
}

export function offsetAtColumn(row: VisualRow, preferredColumn: number): number {
  let best = row.positions[0] ?? { offset: row.start, column: 0 };
  for (const position of row.positions) {
    if (Math.abs(position.column - preferredColumn) < Math.abs(best.column - preferredColumn)) {
      best = position;
    }
  }
  return best.offset;
}
