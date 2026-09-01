import { describe, expect, it } from "vitest";
import {
  detectTuiCapabilities,
  resolveInterfaceMode,
  tuiSupported,
} from "../src/cli/interface-mode.js";

const tty = { inputTty: true, outputTty: true, rawMode: true, term: "xterm-256color" };

describe("interface mode", () => {
  it("defaults to CLI in a capable terminal", () => {
    expect(resolveInterfaceMode({ tui: false, cli: false, print: false }, tty)).toEqual({
      mode: "cli",
    });
  });

  it("preserves explicit TUI, CLI, print, and Web modes", () => {
    expect(resolveInterfaceMode({ tui: true, cli: false, print: false }, tty)).toEqual({
      mode: "tui",
    });
    expect(resolveInterfaceMode({ tui: false, cli: true, print: false }, tty)).toEqual({
      mode: "cli",
    });
    expect(resolveInterfaceMode({ tui: false, cli: false, print: true }, tty)).toEqual({
      mode: "print",
    });
    expect(resolveInterfaceMode({ tui: false, cli: false, print: false, web: true }, tty)).toEqual({
      mode: "web",
    });
  });

  it("falls back and warns for an explicit unavailable TUI", () => {
    expect(
      resolveInterfaceMode({ tui: true, cli: false, print: false }, { ...tty, inputTty: false }),
    ).toEqual({ mode: "cli", warning: "tui_unavailable" });
    expect(
      resolveInterfaceMode({ tui: false, cli: false, print: false }, { ...tty, outputTty: false }),
    ).toEqual({ mode: "cli" });
  });

  it("rejects conflicting explicit modes", () => {
    expect(() => resolveInterfaceMode({ tui: true, cli: true, print: false }, tty)).toThrow(
      /mutually exclusive/,
    );
    expect(() => resolveInterfaceMode({ tui: true, cli: false, print: true }, tty)).toThrow(
      /mutually exclusive/,
    );
    expect(() =>
      resolveInterfaceMode({ tui: false, cli: true, print: false, web: true }, tty),
    ).toThrow(/mutually exclusive/);
  });

  it("requires raw mode and a useful terminal", () => {
    expect(tuiSupported({ ...tty, rawMode: false })).toBe(false);
    expect(tuiSupported({ ...tty, term: "dumb" })).toBe(false);
    expect(
      detectTuiCapabilities(
        { isTTY: true, setRawMode() {} } as unknown as NodeJS.ReadStream,
        { isTTY: true } as unknown as NodeJS.WriteStream,
        "xterm",
      ),
    ).toEqual({ inputTty: true, outputTty: true, rawMode: true, term: "xterm" });
  });
});
