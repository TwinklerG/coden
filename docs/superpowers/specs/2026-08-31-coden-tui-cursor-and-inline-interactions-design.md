# CodeN TUI Cursor, Layout, and Inline Interactions Design

## Status

Approved on 2026-08-31.

## Context

The full-screen Ink TUI currently has three related rendering and interaction problems:

1. Continuing multiline input with a trailing `\` can leave the blinking native cursor on the previous row while a second, application-rendered `▏` caret appears at the new editor position.
2. Backspacing across a newline can briefly render the status bar one row above its final position before the layout corrects itself.
3. Permission and confirmation requests use an absolute overlay dialog instead of appearing in the transcript like CLI prompts.

The cursor defects are consequences of two existing workarounds. `InputBar` renders a visible `▏` to force Ink away from its cursor-only update path, while input height is reported from the child to `TuiApp` through a layout effect. The first approach necessarily creates two cursor representations. The second allows Ink to observe one commit with the new editor height and the old transcript allocation before the parent commits the corrected allocation.

This change removes those workarounds, fixes the underlying full-screen cursor positioning, and replaces every TUI dialog with persistent transcript interaction.

## Goals

- Display exactly one cursor: the terminal's native blinking cursor.
- Keep the native cursor at the editor position after continuation, navigation, insertion, deletion, wrapping, reset, and resize.
- Keep the status bar on the terminal's final row without transient upward frames when input grows or shrinks.
- Remove all dialog overlays, including tool permission, workspace trust, and plugin confirmation dialogs.
- Show confirmations in the transcript and retain the complete request, available choices, and selected answer after resolution.
- Keep the task input visible but disabled while an inline confirmation is pending.
- Preserve current permission decisions, cancellation semantics, transcript scrolling, multiline editing semantics, and IME positioning.

## Non-goals

- Changing permission policy or smart-approval decisions.
- Supporting multiple simultaneous confirmation prompts.
- Allowing task drafting while confirmation is pending.
- Persisting TUI-only interaction blocks into the runtime session history.
- Replacing Ink or building a project-owned full-screen ANSI renderer.
- Changing CLI or print-mode presentation.

## Selected Approach

Fix the cursor bug at the Ink rendering boundary, lift editor layout ownership into `TuiApp`, and model all confirmation requests as transcript interactions.

Ink will be pinned to an exact version and patched through Bun's dependency patch mechanism. The patch will make cursor placement use the actual terminal row at the end of the rendered frame, accounting for whether the frame has a trailing newline. Both full render and cursor-only paths must use the corrected calculation. Application-level invisible marker characters or ANSI-style toggles will not be used.

The editor model and layout will be controlled above `InputBar`. A single state update after each editor operation will cause `TuiApp` to derive editor rows, transcript capacity, and cursor coordinates together. The current child-to-parent `onRowsChange` feedback loop will be removed.

All permission and generic confirmation requests will append a persistent interaction block to the transcript. A separate pending-interaction state will route confirmation keys while keeping the task editor disabled. Resolution updates the transcript and pending state atomically before settling the waiting Promise.

## Input and Cursor Architecture

### Controlled editor model

`TuiApp` will own the `EditorState` instance and the revision state that makes its mutations observable to React. Editor input handling will mutate the model and schedule one parent update. The resulting render will read one coherent editor snapshot containing text and cursor offset.

The editor layout will be calculated from that snapshot and the current terminal width before allocating rows:

```text
editor snapshot + terminal columns
                -> editor visual layout
                -> input content rows
                -> transcript rows
                -> absolute editor cursor coordinates
```

The root layout will therefore commit the transcript, input, and status positions together. `InputBar` will receive the already-current editor state or layout and will no longer report its row count with `onRowsChange` or `useLayoutEffect`.

The existing row allocation remains conceptually:

```text
transcript rows = terminal rows
                - editor content rows
                - 2 input rules
                - 1 status row
```

The transcript allocation remains clamped to at least one row for very small terminals.

### Native cursor only

`InputBar` will render only editor text. The inline inverse `▏`, `CURSOR_CHAR`, and caret-specific row splitting will be removed. Tabs will continue to be expanded by the editor layout, but no visual caret insertion will split their rendered representation.

`useCursor()` remains responsible for showing and positioning the native cursor so IME candidate windows can follow the editor position. Its coordinates will be derived directly from the root layout:

- horizontal position: prompt display width plus the cursor's editor-content column;
- vertical position: transcript height, upper input rule, and cursor row;
- no application-level compensating row offset.

The cursor is hidden whenever the task input is inactive, disabled by a running task, or blocked by a pending interaction.

### Ink dependency correction

Ink's cursor renderer currently assumes that output ends immediately after the final visible line. In a full-screen frame without a trailing newline, the terminal can instead remain on the final visible row. Relative cursor movement based on the wrong end row produces a one-row error, especially when output text is unchanged and only cursor position changes.

The dependency patch will pass enough frame-ending information into cursor-suffix construction to distinguish frames with and without trailing newlines. Cursor positioning must use the actual output-end row in:

- standard full rendering;
- incremental full rendering;
- cursor-only updates;
- cursor synchronization after external writes.

Return-to-bottom logic and cursor visibility transitions must remain symmetrical. The patch will be committed as a project patch and represented in `bun.lock`. The Ink dependency will be exact-version pinned so an incompatible release cannot silently receive the old patch.

## Atomic Layout Updates

Every editor operation that can affect height must update layout through the same parent render:

- trailing-`\` continuation;
- Shift+Enter insertion;
- Backspace or forward-delete across a newline;
- text insertion and paste;
- Tab expansion;
- automatic wrapping;
- history replacement;
- submit, disable, and reset;
- terminal resizing.

There must be no render in which editor content uses its new number of rows while transcript capacity still reflects the old number. When the editor shrinks by one visual row, the transcript gains that row and the status remains on the final terminal row in the same commit. When it grows, the transcript releases the required row in that same commit.

The input rules and every editor content row remain explicit block rows so Ink cannot merge sibling text into one terminal line.

## Transcript Interaction Model

### Types and state

The dialog-specific `TuiDialog` and `snapshot.dialog` model will be removed. The TUI will instead have:

- a persistent transcript interaction block with a stable ID, semantic prompt data, current state, and optional answer;
- at most one private pending resolver in `TuiStore`;
- a lightweight public pending-interaction descriptor that tells `TuiApp` which keys are valid.

Interaction blocks have two prompt categories:

1. permission: tool name, risk, complete formatted input, and whether session approval is allowed;
2. confirm: sanitized confirmation message with yes/no choices.

Their state is `pending`, `resolved`, or `cancelled`. A resolved block records the selected answer. A cancelled block explicitly records cancellation or safe rejection so a stale prompt never appears to be awaiting input.

### Rendering

Permission interactions will follow the CLI presentation:

- terminal-width horizontal rule;
- uppercase risk and tool name;
- complete tool input without the dialog's current 12-line truncation;
- another horizontal rule;
- risk-aware choices.

Normal permission choices are `[y]es / [s]ession / [N]o`. Dangerous permissions omit the session choice. Generic confirmations show their sanitized message and `[y]es / [N]o` choices.

The horizontal rule is generated at transcript-render time using current terminal columns. Semantic prompt data therefore remains resize-safe. Long tool input flows through normal transcript wrapping and can be inspected with existing scrolling controls.

While pending, the final prompt ends after the answer separator. After resolution, the same block renders the user's actual answer, for example:

```text
Allow? [y]es / [s]ession / [N]o: s
```

The complete request, choices, and answer remain in the transcript for the life of the TUI.

### Input routing

When an interaction is pending:

- `InputBar` remains rendered but is inactive and visually disabled;
- the editor draft is not modified or submitted;
- a focused interaction input handler accepts `y`, `s`, and `n` according to the prompt;
- `Esc` safely denies;
- invalid keys do nothing;
- dangerous permissions ignore `s`;
- PageUp, PageDown, End, and mouse-wheel transcript navigation remain available.

`Ctrl+C` preserves existing behavior. During a running turn it aborts the turn. The interaction's abort signal then settles the request safely and marks the transcript block cancelled or denied. During bootstrap confirmation, shutdown closes the pending interaction and restores the terminal.

### Resolution ordering

A valid answer is processed in this order:

1. verify that the interaction ID is still pending;
2. replace the transcript block with its resolved form and recorded answer;
3. clear public and private pending-interaction state;
4. notify subscribers once with the coherent snapshot;
5. remove abort listeners;
6. settle the waiting Promise exactly once.

Clearing pending state before resolving prevents a rapidly arriving second key from resolving twice or leaking into the task editor when runtime execution resumes.

## Failure and Concurrency Handling

- At most one interaction can be pending. An unexpected overlapping request is safely rejected and an error block is added to the transcript.
- Store close, fatal shutdown, and abort settle every pending Promise exactly once.
- Permission fallback is `deny`; generic confirmation fallback is `false`.
- A cancelled or aborted interaction remains visible and is clearly marked, rather than being removed or left pending.
- Terminal control bytes in confirmation text and tool values continue to be sanitized.
- Repeated choice keys after resolution have no effect.
- TUI shutdown remains idempotent and must restore cursor visibility, alternate-screen state, mouse modes, and keyboard modes.
- Ink patch application is validated during dependency installation. Upgrading Ink requires explicitly regenerating or removing the patch and rerunning PTY regression tests.

## Component Changes

### `TuiApp`

- Own the editor model/revision and derive editor layout before root row allocation.
- Route editor actions and pending-interaction keys through mutually exclusive active handlers.
- Disable the visible task input when a runtime turn or interaction is active.
- Remove permission overlay rendering and dialog-specific global input handling.

### `InputBar`

- Become controlled by the editor snapshot/layout supplied by the parent.
- Remove its local `EditorState`, row-count callback, layout effect, visible caret, and caret row splitting.
- Continue rendering rules, prompt text, multiline rows, and native cursor placement.

### `TranscriptView` and transcript renderer

- Render semantic interaction blocks at the current terminal width.
- Retain normal virtualization, wrapping, follow-output, and manual scrolling behavior.
- Keep the pending prompt at the tail only when follow mode is enabled, consistent with other new blocks.

### `TuiStore`

- Replace dialog methods and state with interaction creation, resolution, cancellation, and persistent block updates.
- Continue exposing Promise-based `confirm` and `permission` interfaces to `AgentApplication`; runtime and permission policy APIs remain unchanged.

### Removed component

`src/tui/components/permission-dialog.tsx` and its component tests will be deleted. No dialog overlay replacement component is needed.

## Testing

### Ink cursor patch tests

Use bounded virtual-terminal tests to cover frames with and without trailing newlines:

- full render to each valid row;
- cursor-only horizontal and vertical movement;
- transition between cursor-visible and cursor-hidden states;
- render shrink and growth;
- synchronization after external output.

The resulting terminal cursor coordinates, not only generated escape strings, must be asserted.

### Editor and component tests

Cover:

- trailing `\` followed by Enter moving the native cursor to the continuation row;
- Shift+Enter and Backspace across newline boundaries;
- trailing spaces and arrow-only movements;
- Tab, grapheme clusters, CJK width, wrapping, paste, history, reset, and resize;
- absence of the `▏` character from every input frame;
- cursor hidden while input is disabled or an interaction is pending.

### Frame-sequence layout tests

Capture every terminal write or decoded terminal frame, not only `lastFrame()`:

- when deleting an editor row, the status text never appears on the penultimate terminal row;
- when adding a row, the status text never overflows below the terminal;
- transcript capacity and editor height change together;
- the native cursor never appears on the previous logical input row after continuation.

### Interaction tests

Cover:

- normal permission choices `y`, `s`, and `n`;
- dangerous permission rejecting `s`;
- generic confirmation `y` and `n`;
- `Esc`, `Ctrl+C`, abort, close, and fatal shutdown;
- repeated answers settling once;
- unexpected concurrent request fallback;
- task editor content remaining unchanged while pending;
- transcript scrolling while pending;
- complete request, choices, and selected answer remaining visible after resolution;
- resize-aware rules and wrapping for long tool input;
- terminal-text sanitization.

### Acceptance checks

Run:

- focused TUI, editor, store, and cursor tests;
- `just check`;
- `just build`;
- Node-built artifact smoke test;
- a real PTY alternate-screen scenario for continuation, newline deletion, inline permission, cancellation, and terminal restoration.

The PTY acceptance trace must show exactly one native cursor at the editor position, no rendered `▏`, no transient status row displacement, and no dialog overlay.

## Compatibility

CLI and print interfaces are unchanged. Permission policy and application interaction APIs remain Promise-based and unchanged. Keyboard-only transcript navigation and mouse-wheel scrolling remain supported. The TUI continues to use Ink 7, React 19, Node 22+, and the existing Bun-managed toolchain without relying on Bun runtime-only APIs.
