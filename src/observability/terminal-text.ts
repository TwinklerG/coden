import { stripVTControlCharacters } from "node:util";

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
  return point <= 0xff ? 1 : 2;
}

export function displayWidth(text: string): number {
  return Array.from(text).reduce((sum, character) => sum + characterWidth(character), 0);
}

export function truncateDisplay(
  text: string,
  maxColumns: number,
  mode: "head" | "tail" = "head",
): string {
  if (maxColumns <= 0) return "";
  if (displayWidth(text) <= maxColumns) return text;
  if (maxColumns === 1) return "…";
  const source = Array.from(text);
  const kept: string[] = [];
  let used = 1;
  const indexes =
    mode === "head"
      ? source.map((_, index) => index)
      : source.map((_, index) => source.length - index - 1);
  for (const index of indexes) {
    const character = source[index];
    if (character === undefined || used + characterWidth(character) > maxColumns) break;
    if (mode === "head") kept.push(character);
    else kept.unshift(character);
    used += characterWidth(character);
  }
  return mode === "head" ? `${kept.join("")}…` : `…${kept.join("")}`;
}
