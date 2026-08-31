# CodeN TUI Input and Layout Fixes Design

## Status

Approved on 2026-08-30.

## Context

The first full-screen TUI implementation has four related interaction and layout defects:

1. Terminal mouse reports are also delivered to Ink keyboard handlers. The input editor treats unrecognized mouse bytes as text, so SGR mouse sequences appear in the task input.
2. `ink-use-mouse` enables all-motion tracking (`1003`) and independently listens to `stdin` while Ink also owns that stream. Moving the pointer can therefore generate a high-frequency stream of duplicate input and render updates, eventually making the TUI unresponsive. Scrolling can trigger the same failure mode, after which `Ctrl+C` may no longer be processed.
3. Exiting while idle opens an unnecessary confirmation dialog.
4. The transcript height calculation reserves two rows that no rendered component uses, leaving the input and status bars above the bottom edge. It also assumes a fixed input height even though the editor can occupy multiple rows.

This change fixes those defects without changing runtime behavior, permission prompts, workspace-trust prompts, or the single-task execution model.

## Goals

- Preserve mouse-wheel transcript scrolling.
- Prevent every mouse protocol sequence from entering the editor text.
- Ignore mouse movement, presses, and releases without causing React state updates.
- Avoid competing raw `stdin` listeners and high-frequency all-motion tracking.
- Keep `Ctrl+C` semantics: cancel an active task, otherwise exit immediately.
- Place the status bar on the terminal's final row and the input bar directly above it.
- Keep multiline input and the optional activity row correctly accounted for during layout.

## Non-goals

- Mouse selection, clicking, hovering, dragging, or clickable controls.
- A scrollbar or scroll-position indicator.
- Changing keyboard transcript navigation (`PageUp`, `PageDown`, and `End`).
- Changing confirmation dialogs used for workspace trust or other application decisions.
- Reworking transcript rendering, runtime event projection, or permission-dialog design.

## Selected Approach

Remove `ink-use-mouse` and handle terminal mouse reporting within the same Ink input path used by the rest of the TUI.

The TUI will enable xterm button-event tracking (`1000`) together with SGR extended coordinates (`1006`). It will not enable all-motion tracking (`1003`). Button-event mode reports presses, releases, and wheel events but does not emit ordinary pointer movement, eliminating the current movement flood at the source.

A small internal mouse protocol module will:

- expose exact enable and disable sequences for `1000` and `1006`;
- recognize SGR reports in both their raw form (`ESC [ < ... M/m`) and the ESC-stripped form delivered by Ink's `useInput` parser;
- classify wheel-up and wheel-down reports;
- classify all other valid mouse reports as ignored mouse input;
- reject unrelated keyboard input.

The transcript component will respond only to wheel classifications. The input component will check for mouse input before any editor operation and return immediately for every mouse classification. This is necessary because Ink broadcasts an input event to each active `useInput` hook rather than providing event propagation cancellation.

## Component Design

### Mouse protocol lifecycle

A focused TUI hook/component at the application level will enable mouse reporting after mount and disable it during cleanup. It will write through Ink's output stream rather than hard-coding an unrelated stream. Cleanup must be idempotent and must run during normal exit, fatal unmount, and React cleanup.

The mode sequences are:

- enable: `CSI ? 1000 h` followed by `CSI ? 1006 h`;
- disable: `CSI ? 1000 l` followed by `CSI ? 1006 l`.

No `1002` or `1003` tracking mode will be enabled.

Removing `ink-use-mouse` also removes its independent `stdin.on("data")` listener and its direct `process.stdout` writes.

### Mouse event routing

`TranscriptView` keeps its existing bounded offset and follow-output behavior:

- wheel up moves three logical rows upward;
- wheel down moves three logical rows downward;
- reaching the latest row restores follow mode;
- scrolling away from the latest row disables follow mode;
- presses, releases, and any defensively received motion report do nothing;
- mouse input must not call the editor or produce transcript text.

`InputBar` performs the mouse classification before return, arrow, control-key, or printable-text handling. Any recognized mouse report is ignored. This defense remains even though `1000` should stop ordinary movement reports, because terminals can retain stale modes or send reports during mode transitions.

### Exit behavior

`TuiController.requestExit()` will retain two states:

- if a runtime turn is active, abort only that turn and keep the TUI open;
- if no runtime turn is active, call `shutdown()` immediately.

It will no longer open the exit confirmation dialog. `/quit` and EOF continue to shut down directly. Generic confirmation dialogs remain available for workspace trust and other application interactions.

### Bottom-anchored layout

The root layout will account for actual rendered chrome instead of subtracting a fixed four rows.

The input component will report its current rendered row count when editor wrapping or terminal width changes it. The root computes:

```text
transcript rows = terminal rows
                - input rows
                - 1 status row
                - optional 1 activity row
```

The result is clamped to at least one transcript row. The vertical render order remains transcript, optional activity, input, then status. Their total height therefore fills the root terminal height, placing the status bar on the last row and the input directly above it. When input grows or shrinks, transcript capacity adjusts by the same number of rows; resize also recomputes the value.

The permission dialog remains an absolute overlay and does not consume layout rows.

## Failure Handling and Terminal Restoration

- Mouse mode cleanup must execute even when bootstrap or runtime handling fails.
- TUI shutdown remains idempotent.
- A failed or partially recognized escape sequence must never be inserted merely because it resembles mouse input. Complete valid mouse reports are consumed; unrelated keyboard sequences continue through Ink's existing key handling.
- `Ctrl+C` remains available because pointer movement no longer generates an unbounded input/render stream and no second library listener competes for `stdin`.

## Dependency Changes

Remove the direct `ink-use-mouse` dependency. No replacement package is required. The implementation uses Ink hooks, React lifecycle APIs, and a small project-owned SGR parser.

## Testing

### Protocol unit tests

Cover:

- raw and Ink ESC-stripped SGR wheel-up reports;
- raw and Ink ESC-stripped SGR wheel-down reports;
- press and release classification;
- defensive motion classification;
- ordinary text and keyboard escape sequences not being classified as mouse input;
- exact mouse enable/disable modes, including the absence of `1002` and `1003`.

### Component tests

Cover:

- wheel reports changing transcript offset and follow mode;
- press, release, and motion reports causing no scroll update;
- all recognized mouse reports leaving `InputBar` content unchanged;
- ordinary keyboard input and submission continuing to work;
- multiline editor row-count reporting after wrapping and reset.

### Controller tests

Cover:

- idle `requestExit()` immediately disposing and exiting without opening a dialog;
- active `requestExit()` aborting the turn without exiting;
- a later idle `requestExit()` exiting successfully.

### Layout tests

Extract or expose a pure row-allocation calculation and verify:

- one-row input with no activity uses `rows - 2` transcript rows;
- activity consumes exactly one additional row;
- each additional input row consumes exactly one transcript row;
- transcript rows never fall below one;
- the composed frame contains no unexplained blank rows below the status bar.

### Acceptance checks

Run focused TUI tests, the full project check, the Node build, and a PTY smoke test. The PTY smoke must verify wheel scrolling, ignored clicks/movement, clean idle exit, active-turn cancellation, and restoration of mouse modes and the primary screen.

## Compatibility

Keyboard-only terminals retain `PageUp`, `PageDown`, and `End` navigation. Non-TTY routing remains unchanged. The CLI and print interfaces are unaffected. The TUI continues to require the existing Node 22+ runtime contract.
