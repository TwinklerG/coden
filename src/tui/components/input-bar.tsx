import { Box, Text, useCursor, useInput } from "ink";
import type { EditorLayout } from "../../cli/editor-layout.js";
import { layoutEditor } from "../../cli/editor-layout.js";
import type { EditorState } from "../../cli/editor-state.js";
import type { Language } from "../../i18n/language.js";
import { displayWidth } from "../../observability/terminal-text.js";
import { parseMouseInput } from "../mouse.js";

export function inputRule(columns: number): string {
  return "─".repeat(Math.max(1, columns));
}

const KITTY_DECRPM = /^\[\?\d*u$/;

export interface InputBarLayout {
  prompt: string;
  promptWidth: number;
  editorColumns: number;
  editor: EditorLayout;
}

export function calculateInputBarLayout(
  text: string,
  cursor: number,
  language: Language,
  columns: number,
): InputBarLayout {
  const prompt = language === "zh" ? "任务 > " : "Task > ";
  const promptWidth = displayWidth(prompt);
  const editorColumns = Math.max(3, columns - promptWidth + 1);
  return {
    prompt,
    promptWidth,
    editorColumns,
    editor: layoutEditor(text, cursor, editorColumns),
  };
}

export interface InputBarProps {
  state: EditorState;
  layout: InputBarLayout;
  disabled: boolean;
  active: boolean;
  language: Language;
  columns: number;
  topRow?: number;
  onSubmit(text: string): void;
  onEof(): void;
  onInterrupt(): void;
  onEditorChange(): void;
}

export function InputBar({
  state,
  layout,
  disabled,
  active,
  columns,
  topRow = 0,
  onSubmit,
  onEof,
  onInterrupt,
  onEditorChange,
}: InputBarProps) {
  useInput(
    (input, key) => {
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
        onEditorChange();
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
          onEditorChange();
          onSubmit(result.text);
          return;
        }
        onEditorChange();
        return;
      }

      let handled = true;
      if (key.leftArrow) state.moveHorizontal(-1);
      else if (key.rightArrow) state.moveHorizontal(1);
      else if (key.upArrow) state.moveVertical(-1, layout.editorColumns);
      else if (key.downArrow) state.moveVertical(1, layout.editorColumns);
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
      else handled = false;
      if (handled) onEditorChange();
    },
    { isActive: active },
  );

  const { setCursorPosition } = useCursor();
  setCursorPosition(
    active && !disabled
      ? {
          x: layout.promptWidth + Math.max(0, layout.editor.cursor.column - 2),
          y: topRow + layout.editor.cursor.row,
        }
      : undefined,
  );

  return (
    <Box flexDirection="column">
      <Box>
        <Text dimColor>{inputRule(columns)}</Text>
      </Box>
      {layout.editor.rows.map((row, index) => (
        <Box key={`${row.start}-${row.end}`}>
          <Text>
            <Text color="cyan">{index === 0 ? layout.prompt : " ".repeat(layout.promptWidth)}</Text>
            {row.text}
          </Text>
        </Box>
      ))}
      <Box>
        <Text dimColor>{inputRule(columns)}</Text>
      </Box>
    </Box>
  );
}
