# Multiline REPL Input Design

## Problem

The interactive REPL currently reads its main `> ` prompt with
`readline.question()`. Pressing Enter therefore finishes the question immediately:
the user cannot compose or edit a multiline message, and pasted multiline text may
be split into separate REPL requests.

CodeN needs a focused multiline editor for the main REPL prompt without replacing
single-line permission and trust questions or introducing a general TUI framework.

## Requirements

- Enter submits the complete draft.
- Shift+Enter inserts a newline when the terminal reports it distinctly from Enter.
- A trailing unescaped backslash followed by Enter provides a terminal-independent
  continuation mechanism.
- Users can insert, delete, and move the cursor anywhere in a multiline draft.
- Bracketed multiline paste is inserted as one operation and never submits the
  draft.
- The first visual row uses the two-column prefix `> `; every subsequent logical or
  wrapped visual row uses exactly two spaces.
- Editing supports Chinese text, emoji, combining characters, tabs, terminal wraps,
  resizing, and current-process input history.
- Permission questions, non-TTY behavior, print mode, and model-turn cancellation
  retain their existing semantics; draft cancellation follows the rules below.
- No new runtime dependency is added.

## Chosen Approach

Implement a small, purpose-built terminal editor using Node standard APIs and TTY
raw mode. It owns only the main REPL prompt. Existing readline-based single-line
questions remain unchanged and are active only while the editor is stopped.

A terminal UI framework would add disproportionate dependency and architectural
cost. Extending readline by changing private line and cursor fields would remain a
single-line rendering model, depend on unstable internals, and be difficult to make
correct across Node versions.

Traditional terminals may encode Shift+Enter exactly like Enter. CodeN cannot
recover modifier information the terminal does not send. The editor recognizes
common distinct Shift+Enter encodings; trailing-backslash continuation is the
portable fallback.

## Architecture

Add a focused main-prompt component under `src/cli/`, with two separable layers.

### Editor state

A pure state layer stores:

- the draft and logical cursor position;
- the preferred display column used for vertical movement;
- current-process history and its navigation index;
- the unsent draft saved before entering history navigation.

It implements insertion, deletion, line and word movement, newline insertion,
history selection, cancellation, and submission preparation. It has no stream or
terminal dependencies and operates on grapheme clusters so edits do not split emoji
or combining sequences.

### Terminal editor

An imperative terminal layer:

- temporarily enables raw mode and bracketed paste;
- decodes input chunks into editing operations;
- lays out logical content into terminal-width visual rows;
- redraws the complete owned input region with ANSI cursor operations;
- responds to terminal resize;
- restores the terminal and removes every listener on all exit paths.

The editor returns a submitted message or EOF to the REPL. A nonempty-draft
Ctrl+C cancellation clears the draft and starts a fresh prompt; it does not reach
the runtime.

The main editor and other terminal writers never operate concurrently. It is
stopped before model execution. `TerminalRenderer`, permission prompts, and trust
prompts run only after the editor has restored normal terminal state.

## Interaction Semantics

### Submission and continuation

- Enter submits the complete draft.
- A recognized Shift+Enter inserts `\n` at the cursor.
- A trailing unescaped `\` followed by Enter, when the cursor is at the end of the
  entire draft, removes that continuation marker, inserts `\n`, and continues
  editing instead of submitting.
- Only the trailing run of backslashes is interpreted when Enter is pressed at the
  end of the draft. It uses parity semantics: each `\\` pair represents one literal
  backslash, while a final unpaired backslash is the continuation marker. Thus a
  draft ending in `\\` submits with one literal trailing backslash; internal
  backslashes remain untouched.
- Backslash continuation does not trigger while the cursor is inside the draft.

### Paste

The editor enables bracketed paste while active. A bracketed paste payload is
inserted at the current cursor as one operation. CRLF and CR become LF; tabs and
newlines are retained; unsafe control characters and terminal control sequences are
removed. Newlines inside the payload never submit the draft.

A terminal without bracketed-paste support cannot reliably distinguish pasted
newlines from typed Enter and retains that compatibility limitation.

### Display and layout

The editor reserves two columns for every visual-row prefix:

```text
> first logical line
  second logical line
  wrapped continuation
```

Only the first visual row contains `> `. Every later visual row begins with two
ASCII spaces, including automatic wraps and blank logical lines. Content width is
therefore `terminalColumns - 2`. The layout accounts for grapheme display width,
Chinese wide characters, combining characters, and tab stops.

A resize recomputes every visual row, clears the previous owned region, redraws it,
and restores the logical cursor to its new visual position. Submission performs one
canonical final redraw and writes exactly one newline, leaving the activity line on
the immediately following row.

### Submitted text

Line endings are normalized to LF. CodeN uses a trimmed view only to detect empty
input and recognize commands. The text sent to the runtime and persisted in the
session otherwise retains leading and trailing whitespace, indentation, tabs, and
newlines. Backslash continuation markers are transformed according to the parity
rule above.

A REPL command is recognized only when the submitted text is a single logical line
whose trimmed value exactly matches the command. Multiline text beginning with
`/help` or another command name is an ordinary model request.

## Editing and History

The editor supports:

- Left and Right: move by grapheme cluster.
- Up and Down: move by visual row while preserving a preferred display column.
- Home, End, Ctrl+A, and Ctrl+E: move to the current logical line boundary.
- Backspace and Delete: delete across logical line boundaries.
- Alt+B and Alt+F: move by word.
- Ctrl+W: delete the previous word.
- Ctrl+U and Ctrl+K: delete to the current logical line start or end.
- Tab: insert a tab, displayed using four-column tab stops.
- Shift+Enter: insert a newline when represented distinctly by the terminal.

Up from the first visual row and Down from the final visual row navigate history.
Ctrl+P and Ctrl+N always navigate history. The editor saves the current draft when
history navigation begins and restores it when navigation returns past the newest
entry. Selected history entries are editable copies.

History remains process-local, matching the current readline scope. Successful
nonempty submissions, including REPL commands, enter history; immediately repeated
entries are stored once.

## Cancellation and Cleanup

- Ctrl+C with a nonempty draft clears the entire draft and displays a fresh `> `.
- Ctrl+C or Ctrl+D with an empty draft exits the REPL.
- Ctrl+D with a nonempty draft performs forward delete and does not submit.
- During model execution, the existing `runTurn()` Ctrl+C behavior continues to
  cancel only the active request.

Editor startup records the previous raw-mode state. Normal submission, EOF,
cancellation, exceptions, disposal, and catchable shutdown signals all use one
idempotent cleanup path that disables bracketed paste, restores the prior raw-mode state, and
removes input and resize listeners. No editor listener remains installed during a
permission question or model turn.

Unsupported escape sequences are ignored rather than inserted. The decoder buffers
partial escape sequences across input chunks. `TERM=dumb`, non-TTY stdin, or
non-TTY stderr uses the existing non-ANSI readline path.

## Testing

### Pure editor-state tests

Cover insertion and deletion at arbitrary positions, cross-line edits, grapheme
movement, Chinese text, emoji, combining characters, tabs, preferred-column
vertical movement, line and word operations, history draft restoration, history
copy editing, duplicate suppression, Ctrl+C/Ctrl+D behavior, and backslash parity.

### Input-decoder tests

Cover ordinary Enter, supported Shift+Enter sequences, sequences split across
chunks, unknown sequences, bracketed paste boundaries split across chunks, CRLF
normalization, multiline paste without submission, and control-character filtering.

### Layout and rendering tests

Cover the `> ` first-row prefix, two-space continuation prefixes, blank lines,
logical lines, automatic wrapping, Chinese and grapheme widths, tabs, narrow
terminals, content shrinkage, history replacement, and resize.

Use a small stateful virtual terminal to apply cursor and clear operations and
assert the final screen and cursor position. Append-only ANSI substring assertions
are insufficient. Verify that canonical submission leaves the first `thinking` row
immediately below the final input row with no blank row or stale content.

### CLI regression tests

Verify unchanged single-line commands, permission and trust questions, non-TTY
operation, print mode, EOF, and turn cancellation. Verify that multiline text reaches
the runtime, session store, and resumed transcript with its intended whitespace and
line breaks, and that every editor exit path restores raw mode and bracketed paste.
