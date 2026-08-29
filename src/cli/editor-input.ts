import { StringDecoder } from "node:string_decoder";
import { stripVTControlCharacters } from "node:util";

export type EditorKey =
  | "enter"
  | "shift-enter"
  | "left"
  | "right"
  | "up"
  | "down"
  | "home"
  | "end"
  | "backspace"
  | "delete"
  | "tab"
  | "ctrl-a"
  | "ctrl-c"
  | "ctrl-d"
  | "ctrl-e"
  | "ctrl-k"
  | "ctrl-n"
  | "ctrl-p"
  | "ctrl-u"
  | "ctrl-w"
  | "alt-b"
  | "alt-f";

export type EditorInputEvent =
  | { type: "key"; key: EditorKey }
  | { type: "text"; text: string }
  | { type: "paste"; text: string };

const ESC = "\u001b";
const PASTE_START = "\u001b[200~";
const PASTE_END = "\u001b[201~";
const SHIFT_ENTER_SEQUENCES = new Set(["\u001b[13;2u", "\u001b[27;2;13~", "\u001b\r", "\u001b\n"]);

const CSI_KEYS = new Map<string, EditorKey>([
  ["\u001b[A", "up"],
  ["\u001b[B", "down"],
  ["\u001b[C", "right"],
  ["\u001b[D", "left"],
  ["\u001b[H", "home"],
  ["\u001b[F", "end"],
  ["\u001b[3~", "delete"],
  ["\u001b[1~", "home"],
  ["\u001b[4~", "end"],
]);

const CONTROL_KEYS = new Map<number, EditorKey>([
  [0x01, "ctrl-a"],
  [0x03, "ctrl-c"],
  [0x04, "ctrl-d"],
  [0x05, "ctrl-e"],
  [0x09, "tab"],
  [0x0a, "enter"],
  [0x0b, "ctrl-k"],
  [0x0d, "enter"],
  [0x0e, "ctrl-n"],
  [0x10, "ctrl-p"],
  [0x15, "ctrl-u"],
  [0x17, "ctrl-w"],
  [0x7f, "backspace"],
]);

function isDisallowedControl(character: string): boolean {
  const code = character.codePointAt(0) ?? -1;
  return (
    (code >= 0x00 && code <= 0x08) ||
    (code >= 0x0b && code <= 0x0c) ||
    (code >= 0x0e && code <= 0x1f) ||
    code === 0x7f
  );
}

function sanitizePaste(text: string): string {
  const normalized = text.replace(/\r\n?/g, "\n");
  const stripped = stripVTControlCharacters(normalized);
  return Array.from(stripped)
    .filter((character) => !isDisallowedControl(character))
    .join("");
}

function isFinalCsiByte(character: string): boolean {
  const code = character.codePointAt(0) ?? 0;
  return code >= 0x40 && code <= 0x7e;
}

function mapControl(code: number): EditorKey | undefined {
  return CONTROL_KEYS.get(code);
}

export class EditorInputDecoder {
  private readonly decoder = new StringDecoder("utf8");
  private pending = "";
  private inPaste = false;
  private pasteBuffer = "";

  push(chunk: Buffer | string): EditorInputEvent[] {
    const decoded = typeof chunk === "string" ? chunk : this.decoder.write(chunk);
    if (this.inPaste) {
      if (decoded) this.pasteBuffer += decoded;
      return this.consumePasteBuffer();
    }
    if (decoded) this.pending += decoded;
    return this.consumeNormalBuffer();
  }

  end(): EditorInputEvent[] {
    const events = this.push(this.decoder.end());
    if (this.inPaste) {
      const payload = sanitizePaste(this.pasteBuffer);
      this.pasteBuffer = "";
      this.inPaste = false;
      if (payload) events.push({ type: "paste", text: payload });
    }
    this.pending = "";
    return events;
  }

  private consumePasteBuffer(): EditorInputEvent[] {
    const events: EditorInputEvent[] = [];
    while (this.inPaste) {
      const endIndex = this.pasteBuffer.indexOf(PASTE_END);
      if (endIndex === -1) return events;

      const payload = this.pasteBuffer.slice(0, endIndex);
      const remainder = this.pasteBuffer.slice(endIndex + PASTE_END.length);
      this.pasteBuffer = "";
      this.inPaste = false;

      const sanitized = sanitizePaste(payload);
      if (sanitized) events.push({ type: "paste", text: sanitized });
      if (remainder) this.pending += remainder;
      if (!this.pending) return events;
      return events.concat(this.consumeNormalBuffer());
    }
    return events;
  }

  private consumeNormalBuffer(): EditorInputEvent[] {
    const input = this.pending;
    const events: EditorInputEvent[] = [];
    let index = 0;
    let textStart = 0;

    const flushText = (end: number): void => {
      if (end > textStart) events.push({ type: "text", text: input.slice(textStart, end) });
    };

    while (index < input.length) {
      const character = input.charAt(index);
      if (character !== ESC) {
        const control = mapControl(character.codePointAt(0) ?? 0);
        if (control !== undefined) {
          flushText(index);
          events.push({ type: "key", key: control });
          index += 1;
          textStart = index;
          continue;
        }
        index += 1;
        continue;
      }

      flushText(index);
      const escapeSequence = this.consumeEscape(input, index);
      if (escapeSequence.kind === "incomplete") {
        this.pending = input.slice(index);
        return events;
      }

      index = escapeSequence.nextIndex;
      textStart = index;

      if (escapeSequence.kind === "paste-start") {
        this.pending = "";
        this.inPaste = true;
        this.pasteBuffer = input.slice(index);
        return events.concat(this.consumePasteBuffer());
      }

      if (escapeSequence.kind === "key") {
        events.push({ type: "key", key: escapeSequence.key });
      }
    }

    flushText(input.length);
    this.pending = "";
    return events;
  }

  private consumeEscape(
    input: string,
    index: number,
  ):
    | { kind: "incomplete" }
    | { kind: "ignore"; nextIndex: number }
    | { kind: "key"; nextIndex: number; key: EditorKey }
    | { kind: "paste-start"; nextIndex: number } {
    const next = input[index + 1];
    if (next === undefined) return { kind: "incomplete" };

    if (next === "[") {
      let finalIndex = index + 2;
      while (finalIndex < input.length && !isFinalCsiByte(input[finalIndex] ?? "")) {
        finalIndex += 1;
      }
      if (finalIndex >= input.length) return { kind: "incomplete" };

      const sequence = input.slice(index, finalIndex + 1);
      if (sequence === PASTE_START) return { kind: "paste-start", nextIndex: finalIndex + 1 };
      if (sequence === "\u001b[13;2u" || sequence === "\u001b[27;2;13~") {
        return { kind: "key", key: "shift-enter", nextIndex: finalIndex + 1 };
      }
      const key = CSI_KEYS.get(sequence);
      if (key !== undefined) return { kind: "key", key, nextIndex: finalIndex + 1 };
      return { kind: "ignore", nextIndex: finalIndex + 1 };
    }

    if (next === "b" || next === "B") return { kind: "key", key: "alt-b", nextIndex: index + 2 };
    if (next === "f" || next === "F") return { kind: "key", key: "alt-f", nextIndex: index + 2 };
    if (next === "\r" || next === "\n") {
      const sequence = input.slice(index, index + 2);
      if (SHIFT_ENTER_SEQUENCES.has(sequence)) {
        return { kind: "key", key: "shift-enter", nextIndex: index + 2 };
      }
      return { kind: "ignore", nextIndex: index + 2 };
    }

    return { kind: "ignore", nextIndex: index + 2 };
  }
}
