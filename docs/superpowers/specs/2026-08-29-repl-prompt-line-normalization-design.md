# REPL Prompt Line Normalization Design

## Problem

In an interactive terminal, submitting the main `> ` prompt can leave either zero or one blank row before the temporary `thinking` activity line. The prompt is managed by Node readline while the activity line is managed independently by `TerminalRenderer`. Both write ANSI control sequences to stderr, but neither owns the complete prompt-to-activity cursor transition. Terminal, PTY, and IME newline behavior can therefore leave the cursor on an inconsistent row.

This is a presentation defect only; requests and model output are unaffected.

## Requirements

- After submitting the interactive `> ` prompt, the activity line must occupy the immediately following visual row.
- Support ordinary text, Chinese text, edited input, pasted input, and input that wraps across terminal rows.
- Preserve readline editing and history behavior.
- Do not change permission prompts, non-TTY output, `--print` output, or pipeline behavior.
- Keep spinner updates ephemeral and on one terminal row.

## Approach

Anchor and canonically redraw the main prompt submission.

Immediately before readline displays the main prompt, save the terminal cursor position. After readline returns the final input:

1. Restore the saved cursor position.
2. Clear the display from that position downward.
3. Redraw `> ` followed by the final input and exactly one newline.
4. Continue turn execution from this known cursor position.

This replaces terminal-dependent readline submission layout with one canonical layout while retaining readline for editing. It also handles wrapped input because the terminal performs wrapping again while the final input is redrawn from the original anchor.

The normalization applies only when stdin and stderr are interactive TTYs. Mainstream ANSI terminals support the required cursor save, restore, and clear-down operations. If the process is not interactive, no control sequences or redraw are emitted.

When a provider attempt starts, `TerminalRenderer` will render the first activity frame immediately. The existing 80 ms interval remains responsible only for subsequent animation frames. This removes the timing gap between canonical prompt submission and visible activity.

## Components

### Main prompt helper

The REPL prompt path will use a focused helper that:

- detects whether cursor normalization is available;
- saves the cursor before invoking readline;
- restores and clears after a successful submitted line;
- sanitizes the redrawn final input so it cannot inject terminal control sequences;
- emits exactly one trailing newline.

EOF, cancellation, readline closure, and non-TTY operation retain their current behavior. The generic permission-question path remains unchanged.

### Terminal renderer

`startProviderAttempt()` will start the spinner and immediately call the existing activity-line renderer. No extra newline is written. Existing stop and clear behavior remains unchanged.

## Safety and Error Handling

The redraw must use sanitized terminal text rather than writing raw user control characters. Cursor normalization is best-effort only when both input and output are TTYs; unsupported/non-interactive environments use the current readline behavior without introducing ANSI output.

Restoration and clearing happen only after readline has completed the main prompt, so active input editing is never interrupted.

## Testing

Add focused tests for:

- canonical redraw of ordinary input;
- Chinese input;
- long input that may wrap;
- removal of pre-existing extra rows below the saved prompt anchor;
- no ANSI normalization in non-TTY mode;
- immediate first `thinking` frame followed by in-place timer updates;
- unchanged permission prompt behavior.

Tests should validate the emitted cursor-control sequence and use a small stateful terminal model or equivalent row assertion, rather than only searching an append-only sink string. This ensures the final visual state has no blank row between the submitted prompt and activity line.
