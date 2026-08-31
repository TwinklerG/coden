import { describe, expect, it } from "vitest";
import { I18n } from "../src/i18n/i18n.js";
import { displayWidth } from "../src/observability/terminal-text.js";
import {
  messagesToTranscript,
  renderMarkdown,
  renderTranscriptBlock,
} from "../src/tui/transcript.js";

describe("TUI transcript", () => {
  it("projects only visible session messages", () => {
    expect(
      messagesToTranscript([
        { role: "system", content: "hidden" },
        { role: "user", content: "hello\nworld" },
        { role: "assistant", content: "**answer**", toolCalls: [] },
        { role: "tool", callId: "1", name: "read", content: "hidden", isError: false },
      ]),
    ).toEqual([
      { id: "history-0", kind: "user", text: "hello\nworld" },
      { id: "history-1", kind: "assistant", markdown: "**answer**" },
    ]);
  });

  it("renders user prefixes and sanitizes control sequences", () => {
    expect(
      renderTranscriptBlock(
        { id: "1", kind: "user", text: "one\n\u001b[2Jtwo" },
        80,
        new I18n("en"),
      ),
    ).toBe("> one\n  two");
  });

  it("reuses terminal Markdown including width-aware tables", () => {
    expect(renderMarkdown("**bold**", 80)).toContain("bold");
    const source = "| Name | Value |\n| --- | --- |\n| long-name | long-value |\n";
    expect(renderMarkdown(source, 20)).not.toBe(renderMarkdown(source, 80));
  });

  it("renders transient activity with localized fallback and a bounded spinner line", () => {
    const i18n = new I18n("zh");
    const fallback = renderTranscriptBlock(
      { id: "activity", kind: "activity", phase: "thinking", text: "" },
      20,
      i18n,
      0,
    );
    expect(fallback).toContain("⠋");
    expect(fallback).toContain("思考中");

    const long = renderTranscriptBlock(
      {
        id: "activity",
        kind: "activity",
        phase: "thinking",
        text: "one two three four five six",
      },
      12,
      new I18n("en"),
      1,
    );
    expect(displayWidth(long)).toBeLessThanOrEqual(12);
    expect(long).toContain("⠙");

    expect(
      renderTranscriptBlock(
        { id: "activity", kind: "activity", phase: "thinking", text: "narrow" },
        1,
        new I18n("en"),
        0,
      ),
    ).toBe("⠋");
  });
});
