// @vitest-environment jsdom
import type { ReactElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { InstallCommand } from "../src/components/home/InstallCommand";
import { TerminalDemo } from "../src/components/home/TerminalDemo";

function render(node: ReactElement) {
  const container = document.createElement("div");
  document.body.innerHTML = "";
  document.body.append(container);
  const root = createRoot(container);
  root.render(node);
  return { container, root };
}

function nextTick() {
  return new Promise((resolve) => setTimeout(resolve, 20));
}

describe("home interactions", () => {
  it("copies the Bun install command", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });

    render(<InstallCommand language="en" />);
    await nextTick();

    const button = document.querySelector(".install-command-copy") as HTMLButtonElement | null;
    expect(button).not.toBeNull();
    button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await nextTick();

    expect(writeText).toHaveBeenCalledWith("bun add -g @twinklerg/coden");
  });

  it("switches from CLI to TUI with keyboard-accessible tabs", async () => {
    render(<TerminalDemo language="en" />);
    await nextTick();

    const tuiTab = document.querySelector("#terminal-tab-tui") as HTMLButtonElement | null;
    expect(tuiTab).not.toBeNull();
    tuiTab?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await nextTick();

    const panel = document.querySelector('[role="tabpanel"]');
    expect(panel?.textContent).toContain("gpt-5-mini");
    expect(document.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe("TUI");

    document
      .querySelector(".terminal-tabs")
      ?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));
    await nextTick();

    expect(document.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe("CLI");
    expect(document.activeElement?.textContent).toBe("CLI");
  });
});
