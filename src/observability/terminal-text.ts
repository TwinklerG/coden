import { stripVTControlCharacters } from "node:util";

const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
const MARK = /\p{Mark}/u;
const EMOJI = /\p{Extended_Pictographic}|\p{Regional_Indicator}|\u20e3/u;

export function sanitizeTerminalText(text: string): string {
  return Array.from(stripVTControlCharacters(text))
    .filter((character) => {
      const point = character.codePointAt(0) ?? 0;
      return point === 0x09 || point === 0x0a || point > 0x9f || (point > 0x1f && point < 0x7f);
    })
    .join("");
}

export function characterWidth(character: string): number {
  const point = character.codePointAt(0) ?? 0;
  if (point >= 0x2500 && point <= 0x257f) return 1;
  return point <= 0xff ? 1 : 2;
}

export function graphemes(text: string): string[] {
  return Array.from(segmenter.segment(text), ({ segment }) => segment);
}

export function graphemeWidth(grapheme: string): number {
  if (!grapheme) return 0;
  if (EMOJI.test(grapheme) || grapheme.includes("\ufe0f")) return 2;
  const visible = Array.from(grapheme).filter(
    (character) => !MARK.test(character) && character !== "\u200d" && character !== "\ufe0e",
  );
  return visible.reduce((width, character) => Math.max(width, characterWidth(character)), 0);
}

export function displayWidth(text: string): number {
  return graphemes(text).reduce((sum, grapheme) => sum + graphemeWidth(grapheme), 0);
}

export function truncateDisplay(
  text: string,
  maxColumns: number,
  mode: "head" | "tail" = "head",
): string {
  if (maxColumns <= 0) return "";
  if (displayWidth(text) <= maxColumns) return text;
  if (maxColumns === 1) return "…";
  const source = graphemes(text);
  const kept: string[] = [];
  let used = 1;
  const indexes =
    mode === "head"
      ? source.map((_, index) => index)
      : source.map((_, index) => source.length - index - 1);
  for (const index of indexes) {
    const grapheme = source[index];
    if (grapheme === undefined || used + graphemeWidth(grapheme) > maxColumns) break;
    if (mode === "head") kept.push(grapheme);
    else kept.unshift(grapheme);
    used += graphemeWidth(grapheme);
  }
  return mode === "head" ? `${kept.join("")}…` : `…${kept.join("")}`;
}
