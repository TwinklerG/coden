# Markdown Table Rendering Design

## Goal

Render GFM Markdown tables as readable, width-aware Unicode tables in CodeN's interactive terminal while preserving the existing streaming experience and raw, script-friendly non-TTY output.

## Scope

This change covers GFM tables in streamed assistant content:

- full Unicode borders;
- header and inline Markdown styling;
- GFM column alignment;
- terminal-width-aware column allocation;
- lossless cell wrapping;
- streaming detection, preview, cleanup, and safe fallback.

It does not change non-TTY output, introduce a general terminal UI, add horizontal scrolling, or add a third-party table-rendering dependency.

## Architecture

`MarkdownStreamRenderer` remains the sole owner of Markdown stream buffering and rendering. It gains two table-related states alongside its existing incomplete-line and fenced-code states:

1. **Table candidate**: one pipe-containing ordinary line is held until the following complete line determines whether the pair starts a GFM table.
2. **Confirmed table block**: after `marked` recognizes the header and delimiter as a `table` token, subsequent table rows remain buffered until the block ends.

Fenced-code handling takes precedence, so pipe characters inside a code fence never participate in table detection.

`marked` remains the Markdown syntax authority. Candidate validation and row continuation are decided from lexer output rather than a second handwritten GFM parser. This preserves support for optional leading and trailing pipes, escaped pipes, and alignment markers. When a new line no longer belongs to the current table token, the renderer first flushes the confirmed table and then reprocesses that line through the ordinary Markdown path.

The renderer's `preview()` method exposes the latest uncommitted raw line. For a table candidate or confirmed table, this is the most recently buffered table line without its trailing newline. The existing transient activity line therefore continues to show progress while the table is withheld for layout.

`TerminalRenderer` supplies a dynamic terminal-width reader to `MarkdownStreamRenderer`. Width resolution uses stdout columns first, stderr columns second, and 80 columns as the fallback. The width is read when a table is rendered rather than captured at construction, so terminal resizing before block completion is respected.

## Table Token Rendering

A confirmed `marked` table token is converted into a table model containing:

- header cells;
- body rows;
- per-column left, center, or right alignment;
- each cell's inline token sequence.

Cell inline tokens use the existing Markdown styles for emphasis, code, and links. Header content is additionally bold. Borders use restrained dim styling and the following full box-drawing shape:

```text
┌──────────┬────────────┐
│ Name     │     Status │
├──────────┼────────────┤
│ 项目 A   │         OK │
│ very     │ processing │
│ long     │            │
└──────────┴────────────┘
```

Each cell has one display column of padding on both sides. The header is separated from body rows by `├─┼┤`. Body rows are not separated from one another, keeping larger tables compact. Empty headers, empty cells, and tables with no body rows remain valid and retain their borders.

## Width Allocation and Wrapping

Width calculations operate on terminal display columns, not JavaScript string length. ANSI styling sequences occupy zero columns, ASCII occupies one column, and Chinese and other characters covered by the existing wide-character rule occupy two columns.

The renderer first computes every column's natural content width from its header and body cells. The table's structural width is:

- one left and one right outer border;
- one separator between adjacent columns;
- two padding columns per cell;
- the allocated content width of every column.

If the natural table fits, all natural widths are retained. Otherwise, the renderer repeatedly reduces the widest reducible columns until the table fits or every column reaches its minimum content width. A column's minimum is one display column when it contains only one-column characters and two when it contains any indivisible two-column character. This largest-first policy avoids shrinking already narrow identifier or status columns while one prose-heavy column dominates the table, and it never assigns a width that cannot contain one of the column's characters.

Cell content wraps independently to its allocated column width:

1. prefer the latest whitespace boundary that fits;
2. remove the consumed wrapping whitespace from the next visual line;
3. hard-wrap an unbroken token by display width when no boundary fits;
4. never truncate or discard non-whitespace content.

ANSI-aware wrapping measures styled text after removing control sequences and ensures each visual fragment has balanced styling so color or emphasis cannot leak into padding and borders. After wrapping all cells in one logical row, shorter cells receive blank visual lines until they match that row's maximum height. Each visual fragment is padded according to the column's GFM alignment: left by default, centered for `:---:`, and right-aligned for `---:`.

If the terminal is narrower than the structural minimum of borders, padding, separators, and each column's one- or two-column character minimum, the table retains every column at that minimum. This is the only case where output may exceed the terminal width; preserving the complete table, content, and aligned borders takes priority over silently dropping columns.

## Streaming Data Flow

For each sanitized complete line in TTY mode:

1. If a code fence is open, process the line using the existing fence rules.
2. If a table is confirmed, ask `marked` whether adding the line extends that table token.
   - If it does, retain the expanded table block.
   - If it does not, render the existing table and reprocess the line from step 1.
3. If one table candidate is pending, lex the candidate and current line together.
   - If they begin a table token that consumes both lines, enter confirmed-table state.
   - Otherwise, render the candidate as ordinary Markdown and reprocess the current line.
4. If the ordinary line contains at least one literal `|` character, retain it as a candidate. This deliberately broad, one-line lookahead avoids duplicating GFM syntax rules; `marked` makes the actual table decision when the next line arrives.
5. Otherwise, render it immediately using the existing line-oriented path.

`complete()` renders a confirmed table or flushes a lone candidate through ordinary Markdown rendering. `reset()` clears candidates and confirmed tables together with incomplete lines and fences. Provider retry, turn failure, tool start, and disposal already call this lifecycle cleanup and continue to prevent stale buffered content from reappearing.

## Output Compatibility

Table rendering applies only to the existing interactive TTY path. `--print`, redirected streams, CI, `NO_COLOR`, and explicit non-TTY rendering continue to bypass `MarkdownStreamRenderer` and emit the original Markdown exactly as received after the provider attempt succeeds.

No table border, wrapping, ANSI styling, or expanded buffering is introduced into the non-TTY path.

## Safety and Degradation

Assistant content is sanitized before entering table detection, as it is for existing TTY Markdown rendering. ANSI sequences can originate only from CodeN's renderer.

Only a `marked` lexer result that explicitly identifies a GFM table enables table drawing. A pipe-containing sentence, invalid delimiter row, or malformed candidate falls back to ordinary Markdown without losing or reordering lines.

If table parsing, model construction, width allocation, or rendering throws, CodeN emits the sanitized raw table source. Presentation failure must not interrupt provider completion or the surrounding terminal renderer.

## Testing

Tests will cover:

1. standard GFM tables with and without leading and trailing pipes;
2. left, center, right, and default alignment;
3. bold headers and cells containing emphasis, inline code, and links;
4. ASCII, Chinese wide characters, empty cells, and tables with no body rows;
5. headers, delimiters, and body rows split across provider deltas;
6. transient preview of candidate and confirmed-table lines;
7. natural-width rendering and dynamic width lookup;
8. largest-first column shrinking, whitespace wrapping, and hard wrapping;
9. row-height normalization and ANSI style isolation at borders;
10. terminals too narrow for the structural minimum, including columns containing two-column characters;
11. pipe characters inside fenced code blocks;
12. pipe-containing prose and invalid table delimiters degrading without lost content;
13. completion flushing lone candidates and confirmed tables;
14. reset, retry, failure, tool start, and disposal clearing buffered table state;
15. exact preservation of non-TTY, `--print`, CI, and `NO_COLOR` output;
16. all existing Markdown, terminal, runtime, and plugin tests continuing to pass.

## Non-goals

- HTML table syntax.
- Row or column spans.
- Horizontal scrolling or interactive table navigation.
- User-configurable border themes.
- Cell truncation.
- A new table-rendering runtime dependency.
- Replacing the existing wide-character policy with a full Unicode grapheme-width engine.
