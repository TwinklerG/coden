# Resume History Display Design

## Goal

When resuming a session with `--resume <id>` in the interactive terminal, render the full prior conversation in a way that closely matches how it appeared during the original session, instead of the current "last few messages collapsed into `┌ role ...` single-line summaries."

## Scope

This change covers the interactive `--resume <id>` path only:

- replay all prior `user` and `assistant` text messages in original order;
- render assistant content with the existing Markdown terminal renderer;
- truncate each assistant reply to a fixed length, appending an omission notice;
- show a one-line tool-usage summary at the end of the transcript.

It does not change `--print`, session listing, non-TTY output, or the live turn rendering path.

## Background

Today `renderResumeBanner` collapses the latest few `user`/`assistant` messages into indented single-line summaries like:

```text
Resumed session <id> (N messages).
Showing last 2 of N messages.
┌ user      hello world
┌ assistant hi there
```

This loses multi-line content, Markdown structure, and tool context, and is not friendly to read. The goal is to render the transcript the same way the conversation originally appeared.

## Current Flow

In `src/cli/agent-command.ts`, when `--resume <id>` is given, the recovered messages are stored in `initialMessages`, and `renderResumeBanner` produces a banner written before the REPL prompt. `renderResumeBanner` lives in `src/cli/format.ts` and only renders a small preview.

## Design

### Message Selection

From the recovered message list, keep only messages whose role is `user` or `assistant`. Drop system, tool (assistant `toolCalls` and `tool` result) messages from display. Display them in original order.

### User Messages

Render the user's content as plain multi-line text in a style that mirrors the interactive input. The first line is prefixed with `> `, and subsequent lines are indented by two spaces to align under the prompt:

```text
> 第一行
  第二行（多行内容保持原样）
```

Preserve the user's original newlines; do not collapse whitespace.

### Assistant Messages

Each assistant reply is rendered through a `MarkdownStreamRenderer`-style path (the same renderer used for live TTY content) so headings, lists, code fences, tables, emphasis, and inline code appear as they did at the time. Each reply is rendered independently, so an unclosed code fence or table in one message cannot leak styling into the next message.

### Assistant Truncation

Each assistant reply is truncated by Unicode character count (code points, not bytes or display columns). The default limit is **2000 characters**, keeping the leading portion. When truncated, the reply is followed by a separate line:

```text
…（已省略 1234 个字符）
```

The omitted count equals `originalLength - 2000`. If the reply is within the limit, the full content is shown and no notice is appended. Truncation happens before Markdown rendering, so a partial Markdown block may be truncated mid-stream but is still rendered through the normal renderer.

### Tool-Usage Summary

After all displayed messages, if the session used any tools, show a single summary line:

```text
Tools: 12 calls — read ×5, bash ×4, edit ×3; 1 failed
```

The summary contains:

- total tool call count;
- per-tool call counts (sorted by count descending, then name);
- failed call count, shown only when greater than zero.

The counts are derived from the recovered `tool` result messages (`isError` marks failures) and assistant `toolCalls`. Parameters, outputs, and per-call status are not shown. If the session used no tools, the line is omitted.

### Renderer Choice

A dedicated transcript renderer is used rather than replaying runtime events. Replaying `provider.delta`, `tool.completed`, etc. through `TerminalRenderer` would re-introduce spinner, timing, and per-tool status lines that should not appear in a restored transcript, and would couple the transcript to event semantics. `MarkdownStreamRenderer` is reused purely for its Markdown rendering, but the assistant content is pushed directly through a renderer instance rather than through fake runtime events.

## Output

The banner becomes a transcript renderer that outputs, in order:

1. `Resumed session <id> (N messages).`
2. Each user message in the `>` prompt style.
3. Each assistant message rendered as Markdown, with truncation applied.
4. The optional tool-usage summary line.

`--print` is unaffected: it never renders the transcript and continues to behave as today. Non-TTY output is unaffected.

## Testing

Tests will cover:

1. a multi-turn history rendered in original order with all user and assistant messages;
2. multi-line user content preserved verbatim under the `>` prompt;
3. assistant Markdown (headings, code fence, table, list) rendered through the Markdown path;
4. truncation at exactly 2000 characters and just under, with the omission count correct;
5. truncation boundary with Unicode / surrogate-pair characters counted as code points;
6. tool-usage summary: total calls, per-tool counts, failed count, and omission when zero tools;
7. code fence or table leaking across adjacent assistant messages is prevented;
8. system and tool messages are hidden;
9. `--print` behavior is unchanged;
10. all existing CLI, format, terminal, Markdown, runtime, and plugin tests continue to pass.

## Non-goals

- Replaying spinner, timing, or per-tool status lines.
- Showing tool arguments, outputs, or execution status.
- A configurable truncation length or a user-visible way to expand truncated replies.
- Changing `--print` or non-TTY output.
- Pagination or interactive scrolling through long histories.
