# Terminal Content Rendering Design

## Goal

Make CodeN's interactive CLI easier to read without turning it into a full-screen TUI. Interactive terminals should render common Markdown and present every built-in or third-party tool consistently. `--print`, redirected output, and other non-TTY use must retain the current raw, script-friendly behavior.

## Scope

This change covers:

- common Markdown in streamed assistant responses;
- structured tool input in permission prompts;
- compact invocation and completion status for every tool;
- bounded rendering, terminal-width handling, control-character safety, and lifecycle cleanup.

It does not add a full-screen interface, syntax highlighting, collapsible cards, tool-result output, or plugin-specific display APIs.

## Architecture

The existing `AgentRuntime -> EventBus -> TerminalRenderer` flow remains authoritative. Presentation logic will be split into three responsibilities.

### Markdown stream renderer

A new Markdown stream renderer will receive `provider.delta` text from `TerminalRenderer`. It will use `marked` only to parse Markdown; CodeN will own the ANSI terminal rendering rather than adopting a pre-styled terminal renderer.

In interactive TTY mode, the renderer will buffer complete lines. Ordinary complete lines can then be rendered without exposing transient Markdown delimiters. Fenced code blocks remain buffered until their closing fence or provider completion so their content is never interpreted as Markdown. Any final incomplete line is flushed when the provider completes.

The renderer will support:

- headings;
- bold and italic emphasis;
- inline code;
- ordered and unordered lists;
- block quotes;
- links;
- fenced code blocks.

A fenced block will retain whitespace and show a dim language label when present, but will not receive syntax highlighting. Tables will degrade to stable, readable text rather than receive box drawing. Unsupported tokens will render their readable textual content.

`TerminalRenderer` will reset uncommitted Markdown state on provider retry, turn failure, and disposal. Already emitted TTY lines remain visible, matching the existing streaming model. Non-TTY mode bypasses Markdown parsing and continues using the existing retry-safe raw text buffer.

### Generic tool input formatter

A pure formatter will accept a tool name, effective risk, JSON Schema, and input value. It will produce two bounded representations:

- a multi-line representation for permission prompts;
- a compact one-line summary for lifecycle status.

The formatter will not branch on built-in tool names. It will use schema property order when available and otherwise preserve object insertion order. This gives built-in and third-party tools the same behavior without expanding the plugin API.

Formatting rules:

- short scalar fields render as `key: value`;
- strings containing real newline characters render as indented blocks;
- arrays render as indented list items;
- objects render recursively;
- null and empty collections receive explicit readable forms;
- depth, character count, and line count are bounded;
- every truncation includes an omission marker.

Default limits are 20 rendered lines, 2,000 characters per value, and four nested levels. The compact status summary is constrained to one terminal line and prioritizes the first useful scalar field. Values are formatted directly rather than passed through `JSON.stringify`, so newline characters do not appear as literal `\n` sequences.

Although valid tool inputs are JSON values and therefore acyclic, the formatter will defensively detect repeated object references and display `[circular]`.

### Terminal renderer and permission prompt

`TerminalRenderer` remains responsible for TTY detection, color, spinner state, lifecycle cleanup, and output streams. It delegates assistant content to the Markdown stream renderer and tool values to the generic formatter.

The permission prompt changes from a raw single-line JSON value to a structured block such as:

```text
MODIFY  write

  path: a.ts
  content:
    line 1
    line 2

Allow? [y]es / [s]ession / [N]o:
```

Risk remains visible as text and also receives color. Dangerous tools continue to omit the session-wide choice. Permission semantics do not change.

In interactive TTY mode, every tool receives compact lifecycle feedback, including read-risk tools and tools allowed automatically:

```text
◇ read  src/core/runtime.ts
✓ read  12ms

◇ custom_search  query: terminal markdown
✗ custom_search  438ms
```

The executor will derive a bounded compact summary from the registered tool schema and validated input before emitting `tool.started`. Only that summary, not the complete input, is added to the lifecycle event. The permission prompt formats the existing `ToolCall` directly. This avoids introducing a second full-argument copy into traces while allowing all tools to display useful invocation context.

The existing ephemeral `preparing <tool>...` streamed-argument line remains temporary and single-line. Formal tool status appears only after arguments have been assembled and validated.

## Output behavior

Interactive TTY output uses restrained ANSI styling:

- headings and Markdown emphasis use bold or italic terminal styles;
- inline code and fenced blocks use a distinct but subdued color;
- quotes use a dim `|` marker;
- link labels are underlined and followed by a dim URL;
- `◇`, `✓`, and `✗` distinguish invocation, success, and failure;
- risk and failure use color but never rely on color alone.

`NO_COLOR`, CI, `--print`, redirected output, and explicit non-TTY rendering preserve raw assistant Markdown and the existing stable stdout/stderr conventions. They receive no ANSI styling, no newly expanded tool inputs, and no invocation summaries beyond the existing generic tool status messages.

## Safety and degradation

Assistant text and tool values will have unsafe terminal control characters removed before TTY rendering. Newline and tab remain meaningful where appropriate; ANSI escape sequences can only originate from CodeN's renderer.

Width-aware output will use the stream's current column count and default to 80 columns when unavailable. Existing wide-character measurement will be shared or extracted so Chinese and other wide characters are not truncated as single-column ASCII.

A Markdown parsing failure falls back to sanitized readable text. A tool formatting failure falls back to the tool name and a safe bounded value. Presentation errors must never block permission decisions or tool execution.

An unclosed Markdown fence is flushed as code when the provider completes. Incomplete inline syntax is emitted as readable text. Retry, failure, and disposal clear pending lines and code blocks so stale content cannot reappear later.

## Testing

Tests will cover:

1. emphasis, headings, inline code, lists, quotes, links, and fenced blocks;
2. Markdown delimiters split across provider deltas;
3. complete-line buffering and final incomplete-line flushing;
4. unclosed fences and parser fallback;
5. retry, failure, and disposal cleanup;
6. exact preservation of raw non-TTY and `--print` output;
7. multi-line tool strings rendering as real lines rather than literal `\n`;
8. generic third-party inputs containing nested objects, arrays, nulls, and unusual schemas;
9. line, value, depth, width, and wide-character truncation;
10. control-character removal and defensive circular-reference handling;
11. permission choices and dangerous-tool policy remaining unchanged;
12. compact lifecycle summaries for built-in and third-party tools;
13. all existing terminal, runtime, plugin, and integration tests continuing to pass.

## Non-goals

- Full-screen terminal UI or replacement of readline.
- Markdown tables with elaborate borders.
- Source-code syntax highlighting.
- Tool-specific hard-coded layouts.
- A plugin API for custom render components.
- Displaying complete tool results to the user.
- Changing execution, validation, permission, or trace semantics beyond adding a bounded invocation summary.
