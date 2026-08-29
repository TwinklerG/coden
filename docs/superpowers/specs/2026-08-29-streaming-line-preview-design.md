# Streaming Line Preview Design

## Goal

Remove the apparent pause caused by complete-line Markdown buffering without exposing unstable partial Markdown as permanent output. While an interactive response is being generated, CodeN will show one dim transient line containing a spinner and the raw line currently being buffered.

## Scope

This change affects only interactive TTY assistant-content rendering. It does not change Markdown parsing, committed stdout content, reasoning previews, tool-call argument previews, non-TTY output, `--print`, CI, or `NO_COLOR` behavior.

## User experience

While an ordinary Markdown line is incomplete, stderr displays its sanitized raw text:

```text
⠹ **正在生成
```

The preview intentionally retains Markdown delimiters. Rendering partial Markdown would cause styles and layout to jump as delimiters arrive, whereas raw text is stable and accurately represents the buffered content.

When the line becomes complete, CodeN clears the transient preview before writing the rendered line to stdout. If the provider is still generating but has not supplied text for the next line, the transient line becomes:

```text
⠹ rendering…
```

The next delta replaces that fallback with the new raw partial line. The preview remains dim, occupies one terminal line, and retains the newest tail when it exceeds the terminal width.

For a fenced code block, the formal block remains buffered until its closing fence or provider completion. During that period, the preview displays the latest raw line in the buffered fence. This includes a line that already ended with a newline but cannot yet be committed because the fence remains open.

## Architecture

`MarkdownStreamRenderer` remains the authority for ordinary-line and fenced-block buffering. It will expose a read-only method returning the current raw preview:

- the incomplete ordinary line when one exists;
- otherwise, the latest buffered fenced-block line;
- otherwise, no preview.

The value is sanitized before storage and excludes the trailing newline. No Markdown parsing or ANSI styling is applied to it.

`TerminalRenderer` remains responsible for all transient terminal presentation. On each TTY `provider.delta`, it will:

1. clear the current transient activity line;
2. pass the delta to `MarkdownStreamRenderer`, allowing complete content to be committed cleanly to stdout;
3. restart or retain the spinner;
4. render the Markdown preview, or `rendering…` when content has started but no buffered line exists.

The existing activity-line priority becomes:

1. active streamed tool-call arguments;
2. buffered assistant-content preview;
3. normalized reasoning text before formal content starts;
4. `rendering…` after formal content starts;
5. `thinking` before formal content starts.

The first formal content delta still folds and reports reasoning as it does today, but the spinner is immediately restarted for the content preview. This reuses the existing spinner timer, ANSI styling, display-width truncation, and terminal clearing behavior instead of introducing another timer or output path.

## Lifecycle and safety

Provider completion clears the transient line, flushes any final incomplete Markdown, and stops the spinner. Provider retry, turn failure, tool start, and renderer disposal discard both the Markdown buffer and its preview. A stale preview must never reappear in a later attempt.

Assistant controls continue to pass through `sanitizeTerminalText`. The preview is single-line, and width-aware tail truncation prevents wrapping. It is written only to interactive stderr and never enters stdout, traces, persisted messages, non-TTY output, or print mode.

## Testing

Tests will verify:

1. a split Markdown line immediately appears as a dim raw preview while stdout remains empty;
2. subsequent deltas replace the preview and preserve raw Markdown delimiters;
3. completing a line clears the preview before committing rendered stdout content;
4. the spinner shows `rendering…` between a committed line and the next line;
5. a fenced block previews its latest raw line, including completed buffered code lines;
6. long and wide-character previews are tail-truncated to terminal width;
7. completion, retry, failure, tool start, and disposal clear pending previews;
8. non-TTY and print-mode output remain byte-for-byte unchanged;
9. existing reasoning and streamed tool-call preview behavior remains intact.

## Non-goals

- Permanently streaming partial Markdown to stdout.
- Parsing or styling incomplete Markdown.
- Repainting previously committed output.
- Showing more than one pending line.
- Changing fenced-block commit behavior.
