import { graphemes } from "../observability/terminal-text.js";
import { layoutEditor, offsetAtColumn } from "./editor-layout.js";

export type ResolvedEnter =
  | { type: "continue"; text: string; cursor: number }
  | { type: "submit"; text: string };

export type EnterResult = { type: "continue" } | { type: "submit"; text: string };
export type InterruptResult = "cleared" | "eof";
export type DeleteResult = "deleted" | "eof";

type DraftSnapshot = {
  text: string;
  cursor: number;
};

function normalizeCursor(text: string, cursor: number): number {
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

function graphemeBoundaries(text: string): number[] {
  const boundaries = [0];
  let offset = 0;
  for (const grapheme of graphemes(text)) {
    offset += grapheme.length;
    boundaries.push(offset);
  }
  return boundaries;
}

function isWhitespaceGrapheme(grapheme: string): boolean {
  for (const character of grapheme) {
    if (!/\s/u.test(character)) return false;
  }
  return grapheme.length > 0;
}

function trailingBackslashes(text: string): number {
  let count = 0;
  for (let index = text.length - 1; index >= 0 && text[index] === "\\"; index--) count++;
  return count;
}

export function resolveEnter(text: string, cursor: number, shift: boolean): ResolvedEnter {
  const normalizedCursor = normalizeCursor(text, cursor);
  if (shift) {
    return {
      type: "continue",
      text: `${text.slice(0, normalizedCursor)}\n${text.slice(normalizedCursor)}`,
      cursor: normalizedCursor + 1,
    };
  }

  if (normalizedCursor < text.length) {
    return { type: "submit", text };
  }

  const slashCount = trailingBackslashes(text);
  if (slashCount === 0) {
    return { type: "submit", text };
  }

  const trimmed = text.slice(0, text.length - slashCount) + "\\".repeat(Math.floor(slashCount / 2));
  if (slashCount % 2 === 1) {
    return {
      type: "continue",
      text: `${trimmed}\n`,
      cursor: trimmed.length + 1,
    };
  }

  return { type: "submit", text: trimmed };
}

export class EditorState {
  private _text = "";
  private _cursor = 0;
  private preferredColumn: number | undefined;
  private readonly _entries: string[];
  private historyIndex: number | null = null;
  private savedDraft: DraftSnapshot | null = null;

  constructor(history: string[] = []) {
    this._entries = [...history];
  }

  get text(): string {
    return this._text;
  }

  get cursor(): number {
    return this._cursor;
  }

  get entries(): readonly string[] {
    return this._entries;
  }

  private setDraft(text: string, cursor = text.length): void {
    this._text = text;
    this._cursor = normalizeCursor(text, cursor);
  }

  private resetPreferredColumn(): void {
    this.preferredColumn = undefined;
  }

  private boundaries(): number[] {
    return graphemeBoundaries(this._text);
  }

  private loadHistory(index: number): void {
    const entry = this._entries[index];
    if (entry === undefined) return;
    this.historyIndex = index;
    this.setDraft(entry, entry.length);
    this.resetPreferredColumn();
  }

  insert(text: string): void {
    if (!text) return;
    const cursor = normalizeCursor(this._text, this._cursor);
    this._text = `${this._text.slice(0, cursor)}${text}${this._text.slice(cursor)}`;
    this._cursor = cursor + text.length;
    this.resetPreferredColumn();
  }

  backspace(): void {
    const boundaries = this.boundaries();
    const cursor = normalizeCursor(this._text, this._cursor);
    const index = boundaries.indexOf(cursor);
    if (index <= 0) return;
    const previous = boundaries[index - 1] ?? 0;
    this._text = `${this._text.slice(0, previous)}${this._text.slice(cursor)}`;
    this._cursor = normalizeCursor(this._text, cursor);
    this.resetPreferredColumn();
  }

  deleteForward(): void {
    const boundaries = this.boundaries();
    const cursor = normalizeCursor(this._text, this._cursor);
    const index = boundaries.indexOf(cursor);
    if (index < 0 || index >= boundaries.length - 1) return;
    const next = boundaries[index + 1] ?? this._text.length;
    this._text = `${this._text.slice(0, cursor)}${this._text.slice(next)}`;
    this._cursor = cursor;
    this.resetPreferredColumn();
  }

  moveHorizontal(direction: -1 | 1): void {
    const boundaries = this.boundaries();
    const cursor = normalizeCursor(this._text, this._cursor);
    const index = boundaries.indexOf(cursor);
    if (index < 0) return;
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= boundaries.length) return;
    this._cursor = boundaries[nextIndex] ?? cursor;
    this.resetPreferredColumn();
  }

  moveVertical(direction: -1 | 1, columns: number): void {
    const layout = layoutEditor(this._text, this._cursor, columns);
    const contentColumn = Math.max(0, layout.cursor.column - 2);
    if (this.preferredColumn === undefined) this.preferredColumn = contentColumn;

    const targetRowIndex = layout.cursor.row + direction;
    if (targetRowIndex < 0 || targetRowIndex >= layout.rows.length) return;

    const targetRow = layout.rows[targetRowIndex];
    if (targetRow) this._cursor = offsetAtColumn(targetRow, this.preferredColumn);
  }

  /**
   * True when the cursor sits on the top (direction -1) or bottom (direction 1)
   * visual row, so an arrow key would leave the draft and should instead recall
   * the previous/next history entry. Mirrors readline's up/down-at-boundary
   * behavior: moving up at the first row recalls history, moving down at the
   * last row returns toward the saved draft.
   */
  atVerticalBoundary(direction: -1 | 1, columns: number): boolean {
    const layout = layoutEditor(this._text, this._cursor, columns);
    const targetRowIndex = layout.cursor.row + direction;
    return targetRowIndex < 0 || targetRowIndex >= layout.rows.length;
  }

  historyPrevious(): void {
    if (this._entries.length === 0) return;
    if (this.historyIndex === null) {
      this.savedDraft = { text: this._text, cursor: this._cursor };
      this.loadHistory(this._entries.length - 1);
      return;
    }
    if (this.historyIndex > 0) {
      this.loadHistory(this.historyIndex - 1);
    }
  }

  historyNext(): void {
    if (this.historyIndex === null) return;
    if (this.historyIndex < this._entries.length - 1) {
      this.loadHistory(this.historyIndex + 1);
      return;
    }

    const draft = this.savedDraft ?? { text: "", cursor: 0 };
    this.historyIndex = null;
    this.setDraft(draft.text, draft.cursor);
    this.resetPreferredColumn();
  }

  moveLineBoundary(boundary: "start" | "end"): void {
    const cursor = normalizeCursor(this._text, this._cursor);
    const nextCursor =
      boundary === "start"
        ? this._text.lastIndexOf("\n", Math.max(0, cursor - 1)) + 1
        : (() => {
            const index = this._text.indexOf("\n", cursor);
            return index === -1 ? this._text.length : index;
          })();
    if (nextCursor === cursor) return;
    this._cursor = nextCursor;
    this.resetPreferredColumn();
  }

  moveWord(direction: -1 | 1): void {
    const segments = graphemes(this._text);
    const boundaries = graphemeBoundaries(this._text);
    let index = boundaries.indexOf(normalizeCursor(this._text, this._cursor));
    if (index < 0) return;

    if (direction < 0) {
      while (index > 0 && isWhitespaceGrapheme(segments[index - 1] ?? "")) index--;
      while (index > 0 && !isWhitespaceGrapheme(segments[index - 1] ?? "")) index--;
    } else {
      while (index < segments.length && !isWhitespaceGrapheme(segments[index] ?? "")) index++;
      while (index < segments.length && isWhitespaceGrapheme(segments[index] ?? "")) index++;
    }

    const nextCursor = boundaries[index] ?? this._text.length;
    if (nextCursor === this._cursor) return;
    this._cursor = nextCursor;
    this.resetPreferredColumn();
  }

  deleteWordBackward(): void {
    const start = this._cursor;
    this.moveWord(-1);
    const nextCursor = this._cursor;
    if (nextCursor === start) return;
    this._text = `${this._text.slice(0, nextCursor)}${this._text.slice(start)}`;
    this._cursor = nextCursor;
    this.resetPreferredColumn();
  }

  deleteToLineBoundary(boundary: "start" | "end"): void {
    const cursor = normalizeCursor(this._text, this._cursor);
    const nextCursor =
      boundary === "start"
        ? this._text.lastIndexOf("\n", Math.max(0, cursor - 1)) + 1
        : (() => {
            const index = this._text.indexOf("\n", cursor);
            return index === -1 ? this._text.length : index;
          })();
    if (nextCursor === cursor) return;
    if (boundary === "start") {
      this._text = `${this._text.slice(0, nextCursor)}${this._text.slice(cursor)}`;
      this._cursor = nextCursor;
    } else {
      this._text = `${this._text.slice(0, cursor)}${this._text.slice(nextCursor)}`;
      this._cursor = cursor;
    }
    this.resetPreferredColumn();
  }

  enter(shift: boolean): EnterResult {
    const result = resolveEnter(this._text, this._cursor, shift);
    if (result.type === "continue") {
      this._text = result.text;
      this._cursor = normalizeCursor(result.text, result.cursor);
      this.resetPreferredColumn();
      return { type: "continue" };
    }
    return result;
  }

  interrupt(): InterruptResult {
    if (!this._text) return "eof";
    this.reset();
    return "cleared";
  }

  endOfInput(): DeleteResult {
    if (!this._text) return "eof";
    this.deleteForward();
    return "deleted";
  }

  remember(text: string): void {
    if (!text.trim()) return;
    if (this._entries[this._entries.length - 1] === text) return;
    this._entries.push(text);
  }

  reset(): void {
    this._text = "";
    this._cursor = 0;
    this.preferredColumn = undefined;
    this.historyIndex = null;
    this.savedDraft = null;
  }
}
