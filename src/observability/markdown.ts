import { marked } from "marked";
import pc from "picocolors";
import { sanitizeTerminalText } from "./terminal-text.js";

type RenderToken = {
  type: string;
  raw?: string;
  text?: string;
  href?: string;
  depth?: number;
  ordered?: boolean;
  start?: number | "";
  lang?: string;
  tokens?: RenderToken[];
  items?: Array<{ tokens?: RenderToken[]; text?: string }>;
};

export class MarkdownStreamRenderer {
  private pending = "";
  private fence: { marker: "`" | "~"; length: number; lines: string[] } | undefined;

  constructor(private readonly write: (text: string) => void) {}

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
    if (this.fence) {
      this.renderUnit(this.fence.lines.join(""));
      this.fence = undefined;
    }
  }

  reset(): void {
    this.pending = "";
    this.fence = undefined;
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
    this.renderUnit(line);
  }

  private renderUnit(source: string): void {
    try {
      let rendered = this.renderTokens(marked.lexer(source) as RenderToken[]);
      if (source.endsWith("\n") && !rendered.endsWith("\n")) rendered += "\n";
      this.write(rendered);
    } catch {
      this.write(sanitizeTerminalText(source));
    }
  }

  private renderTokens(tokens: RenderToken[] | undefined): string {
    return (tokens ?? []).map((token) => this.renderToken(token)).join("");
  }

  private renderToken(token: RenderToken): string {
    const children = () => this.renderTokens(token.tokens);
    const text = () => sanitizeTerminalText(token.text ?? "");
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
        const start = typeof token.start === "number" ? token.start : 1;
        return (token.items ?? [])
          .map((item, index) => {
            const content = this.renderTokens(item.tokens) || sanitizeTerminalText(item.text ?? "");
            const marker = token.ordered ? `${start + index}. ` : "• ";
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
