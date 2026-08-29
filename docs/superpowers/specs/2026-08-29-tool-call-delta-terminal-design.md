# Tool Call Delta Terminal Display Design

## Goal

Keep the terminal visibly active while the model streams tool-call arguments. Today, `tool_call_delta` events are consumed only by `accumulateStream`, so a long `write` payload can make CodeN appear stuck.

## Scope

This change affects only streaming observability and TTY rendering. It does not change tool-call assembly, JSON parsing, execution, permission checks, session persistence, or non-TTY output.

## Event flow

`accumulateStream` will accept callbacks for the tool-call lifecycle in addition to its existing text and reasoning callbacks:

- start: tool index, call ID, and tool name;
- delta: tool index and the latest argument fragment;
- end: tool index.

`AgentRuntime.requestWithRetry` will translate these callbacks into `provider.tool_call_start`, `provider.tool_call_delta`, and `provider.tool_call_end` runtime events. This preserves `accumulateStream` as the provider-stream assembler while keeping terminal-specific state and formatting in `TerminalRenderer`.

A failed or retried provider attempt may have emitted partial tool arguments. Those events are transient only; the existing retry path clears the renderer state, and incomplete arguments are never executed or persisted.

## TTY rendering

`TerminalRenderer` will maintain the active streamed tool name and accumulated argument text for the current provider attempt. Before formal assistant text starts, each tool-call delta will refresh the existing single-line spinner on `stderr` in dim styling, for example:

```text
⠋ preparing write… {"path":"src/a.ts","content":"…
```

The rendered argument preview will:

- collapse whitespace to a single space;
- fit the current terminal width;
- retain the newest tail when too long, prefixed with `…`;
- remain an ephemeral line rather than adding one line per delta.

The preview is cleared when the tool call ends, formal assistant text begins, the provider completes, a retry occurs, the turn fails, a tool starts, or the renderer is disposed. If multiple tool calls are streamed, the latest active call is displayed while all lifecycle events remain independently identified by index.

## Output safety

Tool argument previews are shown only in interactive TTY mode. Non-TTY and piped output will not print tool-call arguments, preserving stable stdout/stderr behavior and avoiding accidental payload disclosure in logs. The preview uses `stderr`; assistant content remains on `stdout`.

## Error handling

Unknown or out-of-order tool-call events must not make the renderer throw. The renderer ignores deltas or ends for calls it does not know. Existing validation in `accumulateStream` remains authoritative and continues to reject arguments arriving before a start, incomplete calls, and invalid JSON.

## Testing

Tests will cover:

1. `accumulateStream` invokes start, delta, and end callbacks while still assembling the same parsed `ToolCall`.
2. `AgentRuntime` emits the three tool-call lifecycle runtime events with the turn ID and expected data.
3. TTY rendering displays a dim, single-line `preparing <tool>` preview, accumulates fragments, collapses whitespace, and truncates to terminal width.
4. The temporary preview is cleared on end, text output, provider completion, retry, failure, tool start, and disposal.
5. Non-TTY output never contains streamed tool arguments.

## Non-goals

- Pretty-printing partial JSON.
- Persisting streamed argument fragments.
- Showing full tool payloads in non-TTY or verbose logs.
- Changing the existing completed-tool status messages.
