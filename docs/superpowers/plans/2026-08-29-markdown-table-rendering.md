# Markdown Table Rendering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render streamed GFM Markdown tables as aligned, width-aware Unicode tables in interactive terminals without changing raw non-TTY output.

**Architecture:** Add a focused pure terminal-table layout module, then teach `MarkdownStreamRenderer` to hold one candidate line and complete table blocks until `marked` can emit a structured table token. `TerminalRenderer` injects a dynamic stdout/stderr width reader; existing reset and non-TTY paths remain authoritative.

**Tech Stack:** TypeScript 5.9, Bun, Node.js terminal APIs, `marked` 18, `picocolors`, Vitest, Biome, Just

**Spec:** `docs/superpowers/specs/2026-08-29-markdown-table-rendering-design.md`

## Global Constraints

- Render tables only in the existing interactive TTY path.
- Preserve raw Markdown exactly in `--print`, redirected, CI, `NO_COLOR`, and explicit non-TTY paths.
- Use full Unicode box-drawing borders and preserve GFM left, center, and right alignment.
- Wrap cell content without truncating non-whitespace content.
- Use the existing one-column/two-column character policy; do not add a grapheme-width dependency.
- Do not add a terminal-table runtime dependency.
- Treat `marked` lexer output as the GFM syntax authority.
- Keep fences higher priority than table detection and clear all table buffers on existing lifecycle resets.
- Use Bun-compatible TypeScript without Bun-only runtime APIs.

---

## File Structure

- Modify `src/observability/terminal-text.ts`: count Unicode box-drawing glyphs as one terminal column while retaining the existing broad width policy.
- Create `src/observability/markdown-table.ts`: pure ANSI-aware cell measurement, wrapping, width allocation, alignment, and box drawing.
- Create `test/markdown-table.test.ts`: focused layout tests independent of stream and event lifecycle behavior.
- Modify `src/observability/markdown.ts`: table candidate/confirmed-block buffering, `marked` table-token conversion, preview, completion, and reset.
- Modify `test/markdown-terminal.test.ts`: stream detection, delta boundaries, fallback, fence precedence, token styling, and cleanup tests.
- Modify `src/observability/terminal.ts`: inject dynamic terminal columns into the Markdown renderer.
- Modify `test/plugin-terminal.test.ts`: terminal-width integration and raw non-TTY compatibility tests.

### Task 1: Build the pure terminal-table layout module

**Files:**
- Modify: `src/observability/terminal-text.ts`
- Create: `src/observability/markdown-table.ts`
- Create: `test/markdown-table.test.ts`

**Interfaces:**
- Consumes: `characterWidth(text: string): number` and `displayWidth(text: string): number` from `src/observability/terminal-text.ts`; ANSI SGR strings produced by `picocolors`.
- Produces from `terminal-text.ts`: the existing width API with U+2500–U+257F box-drawing glyphs measured as one column.
- Produces: `TableAlignment`, `TerminalTable`, `visibleWidth(text: string): number`, `wrapStyledText(text: string, columns: number): string[]`, and `renderTerminalTable(table: TerminalTable, columns: number): string`.

- [ ] **Step 1: Write failing tests for borders, display width, and alignment**

Create `test/markdown-table.test.ts` with these initial tests:

```ts
import { stripVTControlCharacters } from "node:util";
import { describe, expect, it } from "vitest";
import {
  renderTerminalTable,
  visibleWidth,
  wrapStyledText,
} from "../src/observability/markdown-table.js";

const visible = (text: string) => stripVTControlCharacters(text);

describe("renderTerminalTable", () => {
  it("draws full borders and respects left and right alignment", () => {
    const rendered = renderTerminalTable(
      {
        header: ["Name", "Status"],
        align: ["left", "right"],
        rows: [["项目", "OK"]],
      },
      80,
    );

    expect(visible(rendered)).toBe(
      [
        "┌──────┬────────┐",
        "│ Name │ Status │",
        "├──────┼────────┤",
        "│ 项目 │     OK │",
        "└──────┴────────┘",
      ].join("\n"),
    );
  });

  it("centers cells and keeps tables without body rows", () => {
    const rendered = renderTerminalTable(
      { header: ["Key"], align: ["center"], rows: [] },
      80,
    );

    expect(visible(rendered)).toBe(
      ["┌─────┐", "│ Key │", "├─────┤", "└─────┘"].join("\n"),
    );
  });

  it("measures ANSI as zero columns, Chinese as two, and box drawing as one", () => {
    expect(visibleWidth("\u001b[1m项目\u001b[22m A")).toBe(6);
    expect(visibleWidth("┌─┐")).toBe(3);
  });
});
```

- [ ] **Step 2: Run the focused tests and verify the missing module failure**

Run:

```bash
bun run test -- test/markdown-table.test.ts
```

Expected: FAIL because `src/observability/markdown-table.ts` does not exist.

- [ ] **Step 3: Add failing wrapping and constrained-width tests**

Append tests that require whitespace wrapping, hard wrapping, row-height normalization, ANSI isolation, and the structural-minimum rule:

```ts
it("wraps at whitespace and hard-wraps long tokens without loss", () => {
  expect(wrapStyledText("alpha beta", 5).map(visible)).toEqual(["alpha", "beta"]);
  expect(wrapStyledText("abcdefgh", 3).map(visible)).toEqual(["abc", "def", "gh"]);
});

it("balances ANSI styles in every wrapped fragment", () => {
  const lines = wrapStyledText("\u001b[31mabcdef\u001b[39m", 3);

  expect(lines.map(visible)).toEqual(["abc", "def"]);
  for (const line of lines) {
    expect(visibleWidth(line)).toBeLessThanOrEqual(3);
    expect(`${line}│`).toMatch(/\u001b\[0m│$/);
  }
});

it("shrinks the widest columns and normalizes visual row heights", () => {
  const rendered = visible(
    renderTerminalTable(
      {
        header: ["ID", "Description"],
        align: ["left", "left"],
        rows: [["1", "alpha beta gamma"]],
      },
      18,
    ),
  );
  const lines = rendered.split("\n");

  expect(lines.every((line) => visibleWidth(line) <= 18)).toBe(true);
  expect(rendered).toContain("alpha");
  expect(rendered).toContain("beta");
  expect(rendered).toContain("gamma");
  expect(lines.filter((line) => line.startsWith("│")).length).toBeGreaterThan(2);
});

it("uses a two-column minimum when a column contains wide characters", () => {
  const rendered = visible(
    renderTerminalTable(
      { header: ["A", "B"], align: ["left", "left"], rows: [["中", "x"]] },
      1,
    ),
  );
  const borders = rendered.split("\n").filter((line) => !line.startsWith("│"));

  expect(borders.every((line) => visibleWidth(line) === visibleWidth(borders[0] ?? ""))).toBe(
    true,
  );
  expect(rendered).toContain("中");
});
```

- [ ] **Step 4: Add the narrow box-drawing exception to the shared width helper**

Change `characterWidth` in `src/observability/terminal-text.ts` without otherwise broadening its Unicode policy:

```ts
export function characterWidth(character: string): number {
  const point = character.codePointAt(0) ?? 0;
  if (point >= 0x2500 && point <= 0x257f) return 1;
  return point <= 0xff ? 1 : 2;
}
```

This makes table borders measurable by the same API as content while retaining the established Chinese-width behavior.

- [ ] **Step 5: Implement ANSI-aware glyph wrapping and table layout**

Create `src/observability/markdown-table.ts`. Keep this module independent of `marked`; it accepts already-rendered cell strings:

```ts
import { stripVTControlCharacters } from "node:util";
import pc from "picocolors";
import { characterWidth, displayWidth } from "./terminal-text.js";

export type TableAlignment = "left" | "center" | "right";

export interface TerminalTable {
  header: string[];
  align: TableAlignment[];
  rows: string[][];
}

type StyledGlyph = {
  value: string;
  width: number;
  state: string;
};

const RESET = "\u001b[0m";
const ANSI_PREFIX = /^\u001b\[[0-?]*[ -/]*[@-~]/;

export function visibleWidth(text: string): number {
  return displayWidth(stripVTControlCharacters(text));
}

function styledGlyphs(text: string): StyledGlyph[] {
  const glyphs: StyledGlyph[] = [];
  let offset = 0;
  let state = "";
  while (offset < text.length) {
    const ansi = text.slice(offset).match(ANSI_PREFIX)?.[0];
    if (ansi) {
      if (ansi.endsWith("m")) {
        state = /^\u001b\[(?:0)?m$/.test(ansi) ? "" : `${state}${ansi}`;
      }
      offset += ansi.length;
      continue;
    }
    const point = text.codePointAt(offset);
    if (point === undefined) break;
    const value = String.fromCodePoint(point);
    glyphs.push({ value, width: characterWidth(value), state });
    offset += value.length;
  }
  return glyphs;
}

function renderGlyphs(glyphs: StyledGlyph[]): string {
  return glyphs
    .map((glyph) => (glyph.state ? `${glyph.state}${glyph.value}${RESET}` : glyph.value))
    .join("");
}

function wrapGlyphs(glyphs: StyledGlyph[], columns: number): string[] {
  if (glyphs.length === 0) return [""];
  const lines: string[] = [];
  let remaining = glyphs;
  while (remaining.length > 0) {
    if (lines.length > 0) {
      while (remaining[0] && /\s/u.test(remaining[0].value)) remaining = remaining.slice(1);
      if (remaining.length === 0) break;
    }
    let used = 0;
    let take = 0;
    let lastWhitespace = -1;
    while (take < remaining.length) {
      const glyph = remaining[take];
      if (!glyph || (take > 0 && used + glyph.width > columns)) break;
      used += glyph.width;
      if (/\s/u.test(glyph.value)) lastWhitespace = take;
      take += 1;
      if (used >= columns) break;
    }
    if (take >= remaining.length) {
      lines.push(renderGlyphs(remaining));
      break;
    }
    if (lastWhitespace >= 0) {
      lines.push(renderGlyphs(remaining.slice(0, lastWhitespace)));
      remaining = remaining.slice(lastWhitespace + 1);
      while (remaining[0] && /\s/u.test(remaining[0].value)) remaining = remaining.slice(1);
      continue;
    }
    lines.push(renderGlyphs(remaining.slice(0, Math.max(1, take))));
    remaining = remaining.slice(Math.max(1, take));
  }
  return lines.length > 0 ? lines : [""];
}

export function wrapStyledText(text: string, columns: number): string[] {
  const width = Math.max(1, columns);
  return text.split("\n").flatMap((line) => wrapGlyphs(styledGlyphs(line), width));
}

function minimumWidth(values: string[]): number {
  return values.some((value) => styledGlyphs(value).some((glyph) => glyph.width > 1)) ? 2 : 1;
}

function naturalWidth(values: string[]): number {
  return Math.max(1, ...values.flatMap((value) => value.split("\n").map(visibleWidth)));
}

function allocateWidths(table: TerminalTable, columns: number): number[] {
  const columnCount = table.header.length;
  const values = table.header.map((header, index) => [
    header,
    ...table.rows.map((row) => row[index] ?? ""),
  ]);
  const minimums = values.map(minimumWidth);
  const widths = values.map(naturalWidth);
  const available = Math.max(
    minimums.reduce((sum, width) => sum + width, 0),
    columns - (3 * columnCount + 1),
  );
  while (widths.reduce((sum, width) => sum + width, 0) > available) {
    let widest = -1;
    for (let index = 0; index < widths.length; index += 1) {
      const width = widths[index] ?? 0;
      const minimum = minimums[index] ?? 1;
      if (width > minimum && (widest < 0 || width > (widths[widest] ?? 0))) widest = index;
    }
    if (widest < 0) break;
    widths[widest] = (widths[widest] ?? 1) - 1;
  }
  return widths;
}

function pad(text: string, width: number, align: TableAlignment): string {
  const remaining = Math.max(0, width - visibleWidth(text));
  const left = align === "right" ? remaining : align === "center" ? Math.floor(remaining / 2) : 0;
  return `${" ".repeat(left)}${text}${" ".repeat(remaining - left)}`;
}

function border(left: string, middle: string, right: string, widths: number[]): string {
  return pc.dim(`${left}${widths.map((width) => "─".repeat(width + 2)).join(middle)}${right}`);
}

function renderRow(cells: string[], align: TableAlignment[], widths: number[]): string[] {
  const wrapped = widths.map((width, index) => wrapStyledText(cells[index] ?? "", width));
  const height = Math.max(1, ...wrapped.map((lines) => lines.length));
  return Array.from({ length: height }, (_, lineIndex) => {
    const content = widths.map((width, columnIndex) =>
      pad(
        wrapped[columnIndex]?.[lineIndex] ?? "",
        width,
        align[columnIndex] ?? "left",
      ),
    );
    return `${pc.dim("│")} ${content.join(` ${pc.dim("│")} `)} ${pc.dim("│")}`;
  });
}

export function renderTerminalTable(table: TerminalTable, columns: number): string {
  if (table.header.length === 0) return "";
  const widths = allocateWidths(table, Math.max(1, columns));
  const align = widths.map((_, index) => table.align[index] ?? "left");
  const lines = [
    border("┌", "┬", "┐", widths),
    ...renderRow(table.header, align, widths),
    border("├", "┼", "┤", widths),
    ...table.rows.flatMap((row) => renderRow(row, align, widths)),
    border("└", "┴", "┘", widths),
  ];
  return lines.join("\n");
}
```

The per-glyph SGR replay is intentionally simple and bounded by model output size. It ensures every visible glyph is reset before padding and border output; do not attempt to parse arbitrary terminal protocols.

- [ ] **Step 6: Run the focused tests and fix only layout defects**

Run:

```bash
bun run test -- test/markdown-table.test.ts
```

Expected: PASS. Borders align after ANSI stripping; no non-whitespace cell content is lost; constrained tables fit unless their structural minimum exceeds the requested width.

- [ ] **Step 7: Run formatting and type checks**

Run:

```bash
bun run format
bun run typecheck
bun run test -- test/markdown-table.test.ts
```

Expected: all commands PASS. If Biome reformats the implementation snippets, retain Biome's result.

- [ ] **Step 8: Commit the pure layout unit**

```bash
git add src/observability/terminal-text.ts src/observability/markdown-table.ts test/markdown-table.test.ts
git commit -m "feat: render width-aware terminal tables"
```

### Task 2: Detect streamed GFM tables and render `marked` table tokens

**Files:**
- Modify: `src/observability/markdown.ts`
- Modify: `test/markdown-terminal.test.ts`

**Interfaces:**
- Consumes: `renderTerminalTable(table: TerminalTable, columns: number): string` from Task 1 and `marked.lexer(source)`.
- Produces: `new MarkdownStreamRenderer(write: (text: string) => void, columns?: () => number)`, with existing `push`, `preview`, `complete`, and `reset` methods plus table candidate/confirmed buffering.

- [ ] **Step 1: Replace the readability-only table test with failing rendering tests**

In `test/markdown-terminal.test.ts`, change `harness` so tests can inject width:

```ts
function harness(columns = 80) {
  let output = "";
  const renderer = new MarkdownStreamRenderer(
    (text) => {
      output += text;
    },
    () => columns,
  );
  return { renderer, output: () => stripVTControlCharacters(output) };
}
```

Replace `keeps unsupported table syntax readable` with:

```ts
it("buffers and renders a complete GFM table", () => {
  const h = harness();
  h.renderer.push("| Name | Status |\n");
  expect(h.output()).toBe("");
  expect(h.renderer.preview()).toBe("| Name | Status |");

  h.renderer.push("|:---|---:|\n| **项目** | `ok` |\n");
  expect(h.output()).toBe("");
  expect(h.renderer.preview()).toBe("| **项目** | `ok` |");

  h.renderer.complete();
  expect(h.output()).toContain("┌");
  expect(h.output()).toContain("│ Name");
  expect(h.output()).toContain("项目");
  expect(h.output()).toContain("ok");
  expect(h.output()).not.toContain("|:---|---:|");
});

it("supports GFM tables without outer pipes and flushes on a blank line", () => {
  const h = harness();
  h.renderer.push("Name | Value\n--- | ---:\na | 1\n\nAfter\n");

  expect(h.output()).toContain("┌");
  expect(h.output()).toContain("│ Name");
  expect(h.output()).toContain("After\n");
  expect(h.output().indexOf("└")).toBeLessThan(h.output().indexOf("After"));
});
```

- [ ] **Step 2: Add failing fallback, fence, delta, completion, and reset tests**

Append:

```ts
it("falls back without losing pipe-containing prose or invalid delimiters", () => {
  const h = harness();
  h.renderer.push("use a | b here\nnot a delimiter\nAfter\n");
  h.renderer.complete();

  expect(h.output()).toContain("use a | b here\nnot a delimiter\nAfter\n");
  expect(h.output()).not.toContain("┌");
});

it("does not detect tables inside fenced code", () => {
  const h = harness();
  h.renderer.push("```text\n| a | b |\n| - | - |\n| 1 | 2 |\n```\n");

  expect(h.output()).toContain("| a | b |");
  expect(h.output()).not.toContain("┌");
});

it("recognizes table syntax split across provider deltas", () => {
  const h = harness();
  h.renderer.push("Name | Va");
  h.renderer.push("lue\n--- | ---");
  expect(h.output()).toBe("");
  h.renderer.push("\na | b");
  h.renderer.complete();

  expect(h.output()).toContain("┌");
  expect(h.output()).toContain("Value");
  expect(h.output()).toContain("a");
});

it("flushes a lone candidate on completion and drops table state on reset", () => {
  const lone = harness();
  lone.renderer.push("a | b");
  lone.renderer.complete();
  expect(lone.output()).toBe("a | b");

  const reset = harness();
  reset.renderer.push("a | b\n--- | ---\n1 | 2\n");
  reset.renderer.reset();
  reset.renderer.push("clean\n");
  expect(reset.output()).toBe("clean\n");
});
```

- [ ] **Step 3: Run stream tests and verify raw table output still fails expectations**

Run:

```bash
bun run test -- test/markdown-terminal.test.ts
```

Expected: FAIL because complete lines are still rendered independently and `renderToken` has no `table` case.

- [ ] **Step 4: Add table state and width injection to `MarkdownStreamRenderer`**

In `src/observability/markdown.ts`:

1. Import marked token types and the Task 1 renderer:

```ts
import { marked, type Token, type Tokens } from "marked";
import { renderTerminalTable, type TableAlignment } from "./markdown-table.js";
```

2. Replace the local `RenderToken` type with `Token` in `renderTokens` and `renderToken`. Add state and a backwards-compatible width callback:

```ts
private table: { lines: string[]; confirmed: boolean } | undefined;

constructor(
  private readonly write: (text: string) => void,
  private readonly columns: () => number = () => 80,
) {}
```

3. Add lexer-authoritative helpers. A source is accepted only when the first token is a table and that token consumes the complete source:

```ts
private tableToken(source: string): Tokens.Table | undefined {
  const token = marked.lexer(source)[0];
  return token?.type === "table" && token.raw === source ? token : undefined;
}

private flushTable(): void {
  const table = this.table;
  this.table = undefined;
  if (!table) return;
  this.renderUnit(table.lines.join(""));
}
```

4. In `consumeLine`, keep existing open-fence handling first when no table exists. Before ordinary rendering, process table state as follows:

```ts
if (this.table) {
  const source = `${this.table.lines.join("")}${line}`;
  const token = this.tableToken(source);
  if (this.table.confirmed) {
    if (token) {
      this.table.lines.push(line);
      return;
    }
    this.flushTable();
    this.consumeLine(line);
    return;
  }
  if (token) {
    this.table.lines.push(line);
    this.table.confirmed = true;
    return;
  }
  this.flushTable();
  this.consumeLine(line);
  return;
}
```

After the existing opening-fence check and before `renderUnit(line)`, add the broad one-line candidate lookahead:

```ts
if (withoutNewline.includes("|")) {
  this.table = { lines: [line], confirmed: false };
  return;
}
```

Do not add a handwritten delimiter-row regex. `marked` must make the confirmation decision.

- [ ] **Step 5: Render the structured table token and preserve fallback behavior**

Add a `table` case in `renderToken`:

```ts
case "table": {
  const table = token as Tokens.Table;
  return renderTerminalTable(
    {
      header: table.header.map((cell) => pc.bold(this.renderTokens(cell.tokens))),
      align: table.align.map((align): TableAlignment => align ?? "left"),
      rows: table.rows.map((row) => row.map((cell) => this.renderTokens(cell.tokens))),
    },
    Math.max(1, this.columns()),
  );
}
```

Keep this inside the existing `renderUnit` `try/catch`. Any lexer or layout exception will therefore write `sanitizeTerminalText(source)` exactly as required by the spec.

Update lifecycle methods:

```ts
preview(): string | undefined {
  if (this.pending) return this.pending;
  const latestTableLine = this.table?.lines.at(-1);
  if (latestTableLine !== undefined) {
    return latestTableLine.endsWith("\n") ? latestTableLine.slice(0, -1) : latestTableLine;
  }
  const latestFenceLine = this.fence?.lines.at(-1);
  if (latestFenceLine === undefined) return undefined;
  return latestFenceLine.endsWith("\n") ? latestFenceLine.slice(0, -1) : latestFenceLine;
}

complete(): void {
  if (this.pending) {
    const line = this.pending;
    this.pending = "";
    this.consumeLine(line);
  }
  this.flushTable();
  if (this.fence) {
    this.renderUnit(this.fence.lines.join(""));
    this.fence = undefined;
  }
}

reset(): void {
  this.pending = "";
  this.fence = undefined;
  this.table = undefined;
}
```

Ensure ordinary `renderUnit` newline preservation still adds exactly one trailing newline when the buffered table source ended in a newline.

- [ ] **Step 6: Run Markdown tests and the strict type checker**

Run:

```bash
bun run test -- test/markdown-table.test.ts test/markdown-terminal.test.ts
bun run typecheck
```

Expected: PASS. Candidate prose is delayed by at most one complete line, tables render only after termination/completion, and fences remain unchanged.

- [ ] **Step 7: Format and commit stream integration**

Run and commit:

```bash
bun run format
bun run test -- test/markdown-table.test.ts test/markdown-terminal.test.ts
git add src/observability/markdown.ts test/markdown-terminal.test.ts
git commit -m "feat: render streamed markdown tables"
```

Expected: formatter and tests PASS, then one commit containing only stream/token integration.

### Task 3: Wire dynamic terminal width and verify lifecycle compatibility

**Files:**
- Modify: `src/observability/terminal.ts`
- Modify: `test/plugin-terminal.test.ts`

**Interfaces:**
- Consumes: `new MarkdownStreamRenderer(write, columns)` from Task 2.
- Produces: TTY table width resolved dynamically as `stdout.columns ?? stderr.columns ?? 80`; no event or non-TTY interface changes.

- [ ] **Step 1: Add a failing terminal-width integration test**

In `test/plugin-terminal.test.ts`, import the shared width helper:

```ts
import { displayWidth } from "../src/observability/terminal-text.js";
```

Then add:

```ts
it("renders Markdown tables at the latest stdout terminal width", async () => {
  const out = new Sink();
  const err = new Sink();
  Object.assign(out, { columns: 40 });
  Object.assign(err, { columns: 30 });
  const events = new EventBus();
  const renderer = new TerminalRenderer(events, { stdout: out, stderr: err, tty: true });

  await events.emit("provider.started");
  await events.emit("provider.delta", {
    text: "ID | Description\n--- | ---\n1 | alpha beta gamma delta\n",
  });
  Object.assign(out, { columns: 18 });
  await events.emit("provider.completed", {});
  renderer.dispose();

  const tableLines = visibleTerminal(out.value)
    .split("\n")
    .filter((line) => /^[┌├└│]/u.test(line));
  expect(tableLines.length).toBeGreaterThan(4);
  expect(tableLines.every((line) => displayWidth(line) <= 18)).toBe(true);
  expect(visibleTerminal(out.value)).toContain("delta");
});
```

This test mutates stdout width after table buffering but before completion, proving width is read dynamically rather than captured early or taken only from stderr.

- [ ] **Step 2: Extend compatibility and lifecycle tests for buffered tables**

Expand `preserves raw Markdown in non-TTY and print modes` so its delta is a table and the exact expected string includes delimiters:

```ts
const raw = "| a | b |\n| - | - |\n| 1 | 2 |\n";
await events.emit("provider.started");
await events.emit("provider.delta", { text: raw });
await events.emit("provider.completed", {});
expect(out.value).toBe(raw);
```

Keep the existing ordinary retry test unchanged and add a separate confirmed-table retry test:

```ts
it("drops a buffered Markdown table when a provider attempt retries", async () => {
  const out = new Sink();
  const err = new Sink();
  const events = new EventBus();
  const renderer = new TerminalRenderer(events, { stdout: out, stderr: err, tty: true });

  await events.emit("provider.started");
  await events.emit("provider.delta", { text: "old | table\n--- | ---\nstale | value\n" });
  await events.emit("provider.retry", { attempt: 1 });
  await events.emit("provider.started");
  await events.emit("provider.delta", { text: "new | table\n--- | ---\nkept | value\n" });
  await events.emit("provider.completed", {});
  renderer.dispose();

  expect(visibleTerminal(out.value)).toContain("kept");
  expect(visibleTerminal(out.value)).not.toContain("stale");
});
```

- [ ] **Step 3: Run the integration tests and verify width injection fails**

Run:

```bash
bun run test -- test/plugin-terminal.test.ts
```

Expected: the new table-width test FAILS because `TerminalRenderer` still constructs `MarkdownStreamRenderer` without a width callback. Raw non-TTY behavior should already pass.

- [ ] **Step 4: Inject dynamic stdout/stderr width resolution**

In the `TerminalRenderer` constructor in `src/observability/terminal.ts`, replace the Markdown renderer initialization with:

```ts
this.markdown = new MarkdownStreamRenderer(
  (text) => this.stdout.write(text),
  () => {
    const stdoutColumns = (this.stdout as NodeJS.WritableStream & { columns?: number }).columns;
    const stderrColumns = (this.stderr as NodeJS.WritableStream & { columns?: number }).columns;
    return stdoutColumns ?? stderrColumns ?? 80;
  },
);
```

Do not move table rendering into `TerminalRenderer`; it remains responsible only for stream selection, TTY policy, and dynamic terminal metadata.

- [ ] **Step 5: Run focused terminal and Markdown suites**

Run:

```bash
bun run test -- test/markdown-table.test.ts test/markdown-terminal.test.ts test/plugin-terminal.test.ts
```

Expected: PASS, including dynamic stdout width, retry cleanup, spinner preview, and exact raw non-TTY tables.

- [ ] **Step 6: Run repository-wide validation**

Run:

```bash
just check
just build
node dist/index.js --version
npm pack --dry-run
```

Expected:

- Biome, strict TypeScript, and all offline tests PASS.
- Build succeeds using Bun with no Bun-only source APIs.
- CLI version remains `0.1.2` unless a separate release task intentionally changes it.
- npm dry run continues to publish only the configured built artifacts and metadata; no `src` files appear.

- [ ] **Step 7: Inspect the final diff and commit terminal integration**

Run:

```bash
git diff --check
git status --short
git diff --stat
git add src/observability/terminal.ts test/plugin-terminal.test.ts
git commit -m "feat: fit markdown tables to terminal width"
git status --short
```

Expected: diff check passes, the commit includes only terminal wiring/integration tests, and the final working tree is clean.
