import { Box, Text, useCursor, useInput } from "ink";
import type { ReactNode } from "react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { layoutEditor } from "../../cli/editor-layout.js";
import { EditorState } from "../../cli/editor-state.js";
import type { Language } from "../../i18n/language.js";
import { displayWidth, graphemes, graphemeWidth } from "../../observability/terminal-text.js";
import { parseMouseInput } from "../mouse.js";

export function inputRule(columns: number): string {
  return "─".repeat(Math.max(1, columns));
}

// The visible caret. It is rendered inline at the editor position so that
// moving the cursor changes the rendered frame, forcing Ink to do a full
// re-render instead of a cursor-only update. Ink's cursor-only path has an
// off-by-one for full-screen (no trailing newline) frames, which made the
// native cursor land one row too high after typing a trailing space or
// pressing an arrow key. Re-rendering on caret moves keeps the native cursor
// parked correctly (for IME) and always shows the caret at the right spot.
const CURSOR_CHAR = "▏";

// Split a visual row's text at a 0-based display column (within the row's
// content, i.e. layout.cursor.column - 2). Returns the text before the caret
// and the text after it. Must walk display width (grapheme width), not text
// offsets: tabs are expanded to spaces in row.text, so offset -= width for
// them, and splitting by offset would misplace the caret (the two-black-block
// bug on Tab).
function splitRowAtColumn(
  row: { text: string },
  column: number,
): { before: string; after: string } {
  let width = 0;
  let index = 0;
  for (const grapheme of graphemes(row.text)) {
    const w = graphemeWidth(grapheme);
    if (width + w > column) break;
    width += w;
    index += grapheme.length;
  }
  return { before: row.text.slice(0, index), after: row.text.slice(index) };
}

// A terminal that answers Ink's kitty keyboard probe after the 200ms fallback
// can inject the DECRPM response (\x1b[?0u) into the input stream. Ink strips
// the leading ESC from unresolved sequences, so it reaches the handler as
// "[?0u". These are protocol bytes, never user input, and must not be inserted.
const KITTY_DECRPM = /^\[\?\d*u$/;

export interface InputBarProps {
  disabled: boolean;
  active: boolean;
  language: Language;
  columns: number;
  topRow?: number;
  onSubmit(text: string): void;
  onEof(): void;
  onInterrupt(): void;
  onRowsChange?(rows: number): void;
}

export function InputBar({
  disabled,
  active,
  language,
  columns,
  topRow = 0,
  onSubmit,
  onEof,
  onInterrupt,
  onRowsChange,
}: InputBarProps) {
  const state = useRef(new EditorState()).current;
  const prompt = language === "zh" ? "任务 > " : "Task > ";
  const promptWidth = displayWidth(prompt);
  const editorColumns = Math.max(3, columns - promptWidth + 1);
  const [, redraw] = useState(0);
  const wasDisabled = useRef(disabled);
  useEffect(() => {
    if (disabled && !wasDisabled.current && state.text) {
      state.reset();
      redraw((value) => value + 1);
    }
    wasDisabled.current = disabled;
  }, [disabled, state]);
  const refresh = () => redraw((value) => value + 1);

  useInput(
    (input, key) => {
      // Defend against the keyboard probe response arriving un-stripped.
      const cleaned = input.startsWith("\u001b") ? input.slice(1) : input;
      if (KITTY_DECRPM.test(cleaned)) return;
      if (parseMouseInput(input)) return;
      if (key.ctrl && input === "c") {
        onInterrupt();
        return;
      }
      if (disabled) return;
      if (key.ctrl && input === "d") {
        if (state.endOfInput() === "eof") onEof();
        refresh();
        return;
      }
      const chunkReturn =
        !key.return &&
        (input.endsWith("\r") || input.endsWith("\n")) &&
        !/[\r\n]/.test(input.slice(0, -1));
      if (key.return || chunkReturn) {
        if (chunkReturn) state.insert(input.slice(0, -1));
        const result = state.enter(key.shift);
        if (result.type === "submit") {
          state.remember(result.text);
          state.reset();
          onSubmit(result.text);
        }
        refresh();
        return;
      }
      if (key.leftArrow) state.moveHorizontal(-1);
      else if (key.rightArrow) state.moveHorizontal(1);
      else if (key.upArrow) state.moveVertical(-1, editorColumns);
      else if (key.downArrow) state.moveVertical(1, editorColumns);
      else if (key.home || (key.ctrl && input === "a")) state.moveLineBoundary("start");
      else if (key.end || (key.ctrl && input === "e")) state.moveLineBoundary("end");
      else if (key.backspace) state.backspace();
      else if (key.delete) state.deleteForward();
      else if (key.ctrl && input === "k") state.deleteToLineBoundary("end");
      else if (key.ctrl && input === "n") state.historyNext();
      else if (key.ctrl && input === "p") state.historyPrevious();
      else if (key.ctrl && input === "u") state.deleteToLineBoundary("start");
      else if (key.ctrl && input === "w") state.deleteWordBackward();
      else if (key.meta && input === "b") state.moveWord(-1);
      else if (key.meta && input === "f") state.moveWord(1);
      else if (key.tab) state.insert("\t");
      else if (!key.ctrl && !key.meta && !key.escape && input) state.insert(input);
      refresh();
    },
    { isActive: active },
  );

  const layout = layoutEditor(state.text, state.cursor, editorColumns);
  const renderedRows = layout.rows.length;
  const { setCursorPosition } = useCursor();
  // Park the native cursor at the caret (needed for IME preedit). The caret
  // char below is what forces Ink to full-re-render (fixing cursor-only
  // off-by-ones) and marks the visible position.
  setCursorPosition(
    active && !disabled
      ? {
          x: promptWidth + Math.max(0, layout.cursor.column - 2),
          y: topRow + layout.cursor.row,
        }
      : undefined,
  );
  // Report rows in useLayoutEffect so the parent recomputes the transcript
  // height / topRow BEFORE the browser paints the frame where the input just
  // grew. Otherwise onRowsChange (useEffect, post-paint) leaves one stale frame
  // where the input has more rows than the reserved height, overflowing the
  // layout and briefly misaligning the native cursor (the two-black-block
  // flash on Shift+Enter / Tab).
  useLayoutEffect(() => onRowsChange?.(renderedRows), [onRowsChange, renderedRows]);
  // Each line (rules + content rows) is wrapped in its own Box so Ink always
  // breaks between them. Sibling <Text> nodes in a column can otherwise render
  // inline when the input is pushed down by the transcript above, merging the
  // upper rule into the first content row on narrow/multiline layouts. The
  // row content is kept inside a <Text> so the caret fragment renders correctly.
  return (
    <Box flexDirection="column">
      <Box>
        <Text dimColor>{inputRule(columns)}</Text>
      </Box>
      {layout.rows.map((row, index) => {
        const isCursorRow = index === layout.cursor.row;
        let content: ReactNode = row.text;
        if (isCursorRow) {
          const { before, after } = splitRowAtColumn(row, layout.cursor.column - 2);
          content = (
            <>
              {before}
              <Text inverse>{CURSOR_CHAR}</Text>
              {after}
            </>
          );
        }
        return (
          <Box key={`${row.start}-${row.end}`}>
            <Text>
              <Text color="cyan">{index === 0 ? prompt : " ".repeat(promptWidth)}</Text>
              {content}
            </Text>
          </Box>
        );
      })}
      <Box>
        <Text dimColor>{inputRule(columns)}</Text>
      </Box>
    </Box>
  );
}
