import { marked, type Token, type Tokens } from "marked";
import pc from "picocolors";
import { renderTerminalTable, type TableAlignment } from "./markdown-table.js";
import { sanitizeTerminalText } from "./terminal-text.js";

export class MarkdownStreamRenderer {
  private pending = "";
  private fence: { marker: "`" | "~"; length: number; lines: string[] } | undefined;
  private table: { lines: string[]; confirmed: boolean } | undefined;

  constructor(
    private readonly write: (text: string) => void,
    private readonly columns: () => number = () => 80,
  ) {}

  push(text: string): void {
    this.pending += sanitizeTerminalText(text);
    let newline = this.pending.indexOf("\n");
    while (newline >= 0) {
      const line = this.pending.slice(0, newline + 1);
      this.pending = this.pending.slice(newline + 1);
      this.consumeLine(line);
      newline = this.pending.indexOf("\n");
    }
  }

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

  private tableToken(source: string): Tokens.Table | undefined {
    const token = marked.lexer(source)[0];
    return token?.type === "table" && token.raw === source ? (token as Tokens.Table) : undefined;
  }

  private flushTable(): void {
    const table = this.table;
    this.table = undefined;
    if (!table) return;
    this.renderUnit(table.lines.join(""));
  }

  private consumeLine(line: string): void {
    if (this.fence) {
      this.fence.lines.push(line);
      const withoutNewline = line.endsWith("\n") ? line.slice(0, -1) : line;
      const closing = withoutNewline.match(/^ {0,3}(`{3,}|~{3,})[ \t]*$/);
      if (closing?.[1]?.[0] === this.fence.marker && closing[1].length >= this.fence.length) {
        const source = this.fence.lines.join("");
        this.fence = undefined;
        this.renderUnit(source);
      }
      return;
    }

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

    const withoutNewline = line.endsWith("\n") ? line.slice(0, -1) : line;
    const opening = withoutNewline.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    const delimiter = opening?.[1];
    if (delimiter) {
      this.fence = {
        marker: delimiter[0] as "`" | "~",
        length: delimiter.length,
        lines: [line],
      };
      return;
    }
    if (withoutNewline.includes("|")) {
      this.table = { lines: [line], confirmed: false };
      return;
    }
    this.renderUnit(line);
  }

  private renderUnit(source: string): void {
    try {
      let rendered = this.renderTokens(marked.lexer(source));
      if (source.endsWith("\n") && !rendered.endsWith("\n")) rendered += "\n";
      this.write(rendered);
    } catch {
      this.write(sanitizeTerminalText(source));
    }
  }

  private renderTokens(tokens: Token[] | undefined): string {
    return (tokens ?? []).map((token) => this.renderToken(token)).join("");
  }

  private renderToken(token: Token): string {
    const children = () => this.renderTokens("tokens" in token ? token.tokens : undefined);
    const text = () => sanitizeTerminalText("text" in token ? token.text : "");
    switch (token.type) {
      case "heading":
        return pc.bold(children() || text());
      case "strong":
        return pc.bold(children() || text());
      case "em":
        return pc.italic(children() || text());
      case "codespan":
        return pc.cyan(text());
      case "link": {
        const label = children() || text();
        const href = sanitizeTerminalText(token.href ?? "");
        return `${pc.underline(label)}${href ? pc.dim(` (${href})`) : ""}`;
      }
      case "list": {
        const list = token as Tokens.List;
        const start = typeof list.start === "number" ? list.start : 1;
        return list.items
          .map((item, index) => {
            const content = this.renderTokens(item.tokens) || sanitizeTerminalText(item.text ?? "");
            const marker = list.ordered ? `${start + index}. ` : "• ";
            const lines = content.trimEnd().split("\n");
            return lines
              .map((line, lineIndex) => `${lineIndex === 0 ? marker : "  "}${line}`)
              .join("\n");
          })
          .join("\n");
      }
      case "list_item":
        return children() || text();
      case "blockquote": {
        const content = (children() || text()).trimEnd();
        return content
          .split("\n")
          .map((line) => `${pc.dim("│ ")}${line}`)
          .join("\n");
      }
      case "code": {
        const language = sanitizeTerminalText((token.lang ?? "").trim());
        const code = pc.cyan(text());
        return language ? `${pc.dim(language)}\n${code}` : code;
      }
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
      case "paragraph":
      case "text":
      case "escape":
        return children() || text();
      case "space":
      case "br":
        return "\n";
      default: {
        const renderedChildren = children();
        if (renderedChildren) return renderedChildren;
        const readable = text();
        if (readable) return readable;
        return sanitizeTerminalText(token.raw ?? "");
      }
    }
  }
}
