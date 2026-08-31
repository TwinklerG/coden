import { render } from "ink-testing-library";
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import {
  DISABLE_MOUSE_REPORTING,
  ENABLE_MOUSE_REPORTING,
  parseMouseInput,
  parseMouseInputs,
  useMouseReporting,
} from "../src/tui/mouse.js";

function MouseReportingHarness() {
  useMouseReporting();
  return null;
}

describe("TUI mouse protocol", () => {
  it("classifies raw and Ink-normalized wheel reports", () => {
    expect(parseMouseInput("\u001b[<64;10;5M")).toBe("scroll-up");
    expect(parseMouseInput("[<64;10;5M")).toBe("scroll-up");
    expect(parseMouseInput("\u001b[<65;10;5M")).toBe("scroll-down");
    expect(parseMouseInput("[<65;10;5M")).toBe("scroll-down");
  });

  it("consumes mouse buttons, releases, and defensive motion reports", () => {
    expect(parseMouseInput("[<0;10;5M")).toBe("other");
    expect(parseMouseInput("[<0;10;5m")).toBe("other");
    expect(parseMouseInput("[<64;10;5m")).toBe("other");
    expect(parseMouseInput("[<65;10;5m")).toBe("other");
    expect(parseMouseInput("[<35;10;5M")).toBe("other");
    expect(parseMouseInput("[<96;10;5M")).toBe("other");
    expect(parseMouseInput("[<97;10;5M")).toBe("other");
  });

  it("consumes fragments and classifies concatenated reports", () => {
    expect(parseMouseInputs("[<64;10")).toEqual(["other"]);
    expect(parseMouseInputs("[<64;10;5M[<65;10;5M")).toEqual(["scroll-up", "scroll-down"]);
    expect(parseMouseInputs("[<64;10;5Mtext")).toEqual(["scroll-up", "other"]);
  });

  it("does not classify keyboard input as mouse input", () => {
    expect(parseMouseInput("hello")).toBeUndefined();
    expect(parseMouseInput("[5~")).toBeUndefined();
    expect(parseMouseInput("\u001b[A")).toBeUndefined();
  });

  it("enables button events without all-motion tracking", () => {
    expect(ENABLE_MOUSE_REPORTING).toBe("\u001b[?1000h\u001b[?1006h");
    expect(DISABLE_MOUSE_REPORTING).toBe("\u001b[?1000l\u001b[?1006l");
    expect(ENABLE_MOUSE_REPORTING).not.toContain("1002");
    expect(ENABLE_MOUSE_REPORTING).not.toContain("1003");
  });

  it("restores mouse modes when the Ink tree unmounts", async () => {
    const view = render(createElement(MouseReportingHarness));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(view.stdout.frames).toContain(ENABLE_MOUSE_REPORTING);
    view.unmount();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(view.stdout.frames).toContain(DISABLE_MOUSE_REPORTING);
  });
});
