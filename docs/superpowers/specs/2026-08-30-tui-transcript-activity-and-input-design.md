# TUI transcript activity and multiline input design

## Objective

Improve the full-screen TUI in two related areas:

1. Show transient thinking and other activity at the current conversation position instead of in a fixed row above the input.
2. Make multiline input reliable, with `Shift+Enter` for newlines, predictable cursor movement, and clear horizontal boundaries around the input area.

The provider-to-runtime streaming path remains unchanged. Assistant text must continue to appear from real `provider.delta` events; this work must not add simulated typing, replay, or response buffering.

## Current problems

The TUI currently renders `ActivityLine` between the transcript and input. This anchors thinking near the bottom of the screen rather than after the current user message. When the first assistant delta clears that row and creates an assistant block, the visual jump can look like a completed response is being replayed even though the underlying stream is real.

The shared editor already has newline and visual-layout support, but the TUI does not enable enhanced modifier-key reporting. As a result, some terminals cannot distinguish `Shift+Enter` from `Enter`. In addition, `EditorState.moveVertical()` currently enters history navigation when an arrow reaches the first or last visual row. This makes multiline drafts appear to lose position or change content unexpectedly.

The input area also lacks a strong visual boundary from the transcript and status bar.

## Scope

### In scope

- Transient activity blocks inside the transcript.
- Thinking spinner and reasoning preview at the current conversation position.
- Existing tool preparation and smart-approval activity represented through the same transient mechanism.
- Real streaming assistant output replacing transient thinking in place.
- `Shift+Enter` newline support where the terminal can report the modifier.
- Existing trailing `\` plus `Enter` continuation as a compatibility fallback.
- Correct horizontal and vertical cursor movement through logical newlines and automatically wrapped visual rows.
- Input-area rules above and below the editable content.
- Layout, cursor-coordinate, lifecycle, and regression tests.

### Out of scope

- Provider, runtime, or event-bus protocol changes.
- Persisting reasoning or transient activity in conversation history.
- Simulated typing or throttled response playback.
- A new input widget or an independent stdin listener.
- Mouse-selection behavior changes.
- Changes to assistant Markdown semantics.

## User-visible layout

The full-screen layout becomes:

```text
conversation transcript
transient thinking / tool activity / streamed assistant output
────────────────────────────────────────
Task > first input line
       second input line
────────────────────────────────────────
provider/model · workspace · mode · phase
```

The two rules span the current terminal width. They belong to the input region: the upper rule separates transcript output from the draft, and the lower rule separates the draft from the status bar.

There is no separate fixed activity row. Consequently, transient activity consumes transcript content space and participates in transcript scrolling instead of reducing transcript height as a special bottom row.

## Transcript activity model

Add a transient `activity` variant to `TranscriptBlock`. It contains the active phase and current preview text. It is presentation state only and is never converted into an `AgentMessage` or written to session history.

`TuiStore` exclusively owns the transient block lifecycle through focused create/update/remove/replace operations. Rendering code must not infer lifecycle from unrelated blocks.

### Lifecycle

1. **Turn/provider start**
   - Create or refresh one transient activity block after the current user message.
   - Its empty-text fallback is the localized thinking label.
   - Repeated start events must update the existing block rather than append duplicates.

2. **Reasoning delta**
   - Append the delta to the transient preview.
   - Preserve the current behavior: normalize whitespace, render as one line, and tail-truncate to available width.
   - Reasoning remains transient and is not copied into the final assistant message.

3. **First assistant text delta**
   - Replace the transient block at the same array position with the active assistant Markdown block.
   - Append that delta immediately, then append every later `provider.delta` to the same block.
   - No timer or completed-response buffer is introduced.

4. **Tool-call preparation**
   - Reuse the transient block for the existing tool name and streamed argument preview.
   - Remove it when preparation ends or tool execution starts.
   - Existing durable tool-start and tool-completion transcript blocks remain unchanged.

5. **Smart approval**
   - Reuse the transient block for the existing review activity.
   - Remove it when review completes or fails.

6. **Subsequent provider pass**
   - After a tool completes, the next `provider.started` creates a new thinking block at the new end of the transcript.

7. **Retry, failure, cancellation, completion, close**
   - Retry removes failed-attempt assistant output and all transient activity before the next attempt.
   - Provider completion removes any remaining transient block.
   - Turn failure, cancellation, and store close remove transient activity so a stopped spinner cannot remain visible.

There can be at most one transient activity block at any time.

## Activity rendering

`TranscriptView` renders the activity block as a regular virtualized transcript line. The visual format remains the existing spinner followed by the activity preview. The spinner advances at the current cadence while the phase is active.

Activity formatting should be extracted or reused rather than duplicated between an obsolete bottom component and the transcript renderer. Once transcript rendering owns it, the standalone bottom `ActivityLine` placement is removed.

Follow-output behavior remains unchanged:

- In follow mode, activity updates and assistant deltas keep the latest content visible.
- If the user scrolls upward, updates do not force the viewport back to the bottom.

## Multiline input behavior

### Enter semantics

- `Enter` submits the current non-continuing draft.
- `Shift+Enter` inserts `\n` at the current grapheme boundary and does not submit.
- An odd trailing backslash followed by `Enter` retains the existing continuation behavior and remains the fallback for terminals that cannot report modified Enter.
- Bracketed or ordinary multiline paste inserts one draft and never submits merely because pasted text contains newlines.

Ink rendering enables Kitty keyboard support in automatic mode. Ink will query/enable it only on supported terminals and restore terminal state on shutdown. Unsupported terminals continue to work without it and retain the backslash fallback.

No second stdin listener is introduced because it could conflict with Ink, mouse report consumption, terminal mode restoration, and IME input.

### Direction-key semantics

- `Left` and `Right` move by grapheme boundary and may cross explicit newline boundaries.
- `Up` and `Down` move to the adjacent **visual row**, preserving the preferred content column as closely as possible.
- A visual row may be produced by an explicit newline or by terminal-width wrapping.
- At the first or last visual row, vertical movement stops.
- Arrow keys never navigate command history.
- `Ctrl+P` and `Ctrl+N` remain the only history-navigation keys.

These semantics belong in the shared `EditorState`, not in a TUI-only interception layer. Both classic multiline input and TUI input therefore receive the same predictable behavior.

### Coordinate consistency

Input rendering, vertical movement, and real terminal cursor placement must use the same effective editor width and the same `layoutEditor` output. The prompt width, continuation indentation, CJK width, emoji graphemes, combining marks, tabs, explicit newlines, and automatic wrapping must all resolve through this shared layout.

## Input boundaries and row allocation

The input component renders:

1. one upper horizontal rule;
2. one or more editor rows;
3. one lower horizontal rule.

Each rule contains `max(1, columns)` box-drawing characters and updates after terminal resize.

The transcript row calculation reserves:

- every rendered editor row;
- two rule rows;
- one status row.

It no longer reserves a special activity row. At extreme terminal heights, the transcript and editor must each retain their existing minimum viable row behavior even if the rendered tree necessarily exceeds the reported height.

The real cursor's vertical coordinate points to the editor content, so it is offset by one additional row for the upper rule. Its horizontal coordinate continues to account for the localized prompt width and layout prefix. Resizing, adding explicit lines, and automatic wrapping must trigger both row-count and cursor-position recomputation.

## Components and responsibilities

### `TuiStore`

- Reduces runtime events into durable transcript blocks and one transient activity block.
- Enforces the single-transient-block invariant.
- Replaces thinking with the first streamed assistant block in place.
- Cleans transient state on every terminal lifecycle path.

### `TranscriptView` and transcript rendering

- Virtualize activity exactly like other transcript content.
- Animate the spinner and format/truncate the one-line preview.
- Keep Markdown rendering exclusive to assistant blocks.

### `InputBar`

- Maps Ink key events to `EditorState` operations.
- Renders both horizontal rules and all visual editor rows.
- Reports the total editor content row count needed by the parent layout.
- Places the real terminal cursor on the matching visual row.

### `EditorState` / `layoutEditor`

- Own grapheme-safe editing and visual movement semantics.
- Stop vertical movement at visual boundaries.
- Keep history access explicit through `Ctrl+P` and `Ctrl+N`.

### TUI application

- Enables Ink Kitty keyboard auto-detection.
- Calculates transcript height without a fixed activity row and with both input rules.
- Supplies the corrected input cursor origin.

## Failure handling and terminal safety

- Enhanced keyboard support is opt-in through Ink automatic detection; unsupported terminals are not forced into the protocol.
- Ink remains responsible for protocol restoration during normal unmount and fatal shutdown.
- Transient state is removed on retry, abort, failure, completion, and disposal.
- Empty, malformed, or unexpected activity deltas must not create duplicate blocks or crash rendering.
- Existing mouse protocol setup/cleanup and Shift-drag terminal selection behavior remain unchanged.

## Verification

Automated tests must cover:

1. Activity creation on turn/provider start without duplicates.
2. Reasoning accumulation, whitespace normalization, spinner rendering, and tail truncation.
3. First text delta replacing activity at the same transcript position.
4. Multiple text deltas being appended as they are received.
5. Tool preparation and approval review reusing transient activity.
6. Retry, tool start, provider completion, turn failure, cancellation, and close cleanup.
7. Follow mode and manually scrolled transcript behavior with activity updates.
8. `Shift+Enter` inserting a newline and ordinary `Enter` submitting.
9. Trailing-backslash continuation remaining functional.
10. Left/right movement across newline boundaries.
11. Up/down movement across explicit and wrapped visual rows at the closest preferred column.
12. Up/down stopping at boundaries without recalling history; `Ctrl+P/N` still recalling history.
13. CJK, emoji, combining-mark, and tab cursor movement/layout cases.
14. Horizontal rules spanning narrow and normal terminal widths and responding to resize.
15. Transcript row allocation reserving two rules plus all editor rows and status.
16. Real cursor coordinates including the upper-rule offset.
17. Kitty keyboard auto-mode configuration and terminal shutdown regression coverage where practical.

Project validation should run the standard commands:

```text
just check
just build
```

A Node execution smoke test of the built CLI should also remain successful.

## Acceptance criteria

- Thinking appears immediately after the current user interaction in transcript flow, not in a fixed bottom activity row.
- The first real assistant delta replaces thinking in place and later deltas update the visible answer without simulated streaming.
- No reasoning preview is persisted to conversation history.
- Multiline drafts can be created with `Shift+Enter` on supported terminals and with trailing `\` plus `Enter` everywhere currently supported.
- All four direction keys behave predictably in explicit and wrapped multiline drafts; arrows never switch history.
- The input is enclosed by terminal-width rules above and below, with the status outside the lower rule.
- Input growth and resize preserve transcript allocation and real cursor placement.
- Existing tool, approval, mouse, cancellation, IME cursor, CLI fallback, and terminal restoration behavior does not regress.
