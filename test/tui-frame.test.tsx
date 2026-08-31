import { render } from "ink-testing-library";
import { describe, expect, it, vi } from "vitest";
import { I18n } from "../src/i18n/i18n.js";
import { TuiApp } from "../src/tui/app.js";
import type { TuiController } from "../src/tui/controller.js";
import { TuiStore } from "../src/tui/store.js";

function fakeController() {
  return {
    bootstrap: vi.fn(async () => {}),
    submit: vi.fn(async () => {}),
    shutdown: vi.fn(async () => {}),
    dispose: vi.fn(async () => {}),
    requestExit: vi.fn(async () => {}),
  } as unknown as TuiController;
}

const metadata = {
  provider: "openai" as const,
  model: "gpt-test",
  workspace: "/workspace",
  workspaceId: "abcdef123456",
  approvalMode: "manual" as const,
  sessionId: "session-123456",
};

const settle = () => new Promise((resolve) => setTimeout(resolve, 30));

describe("TUI frame integration", () => {
  it("keeps only the native cursor when input grows and shrinks", async () => {
    const store = new TuiStore(new I18n("en"));
    store.setMetadata(metadata);
    store.setIdle();
    const view = render(
      <TuiApp controller={fakeController()} store={store} i18n={new I18n("en")} />,
    );

    view.stdin.write("first\\\r");
    await settle();
    expect(view.lastFrame()).toContain("Task > first");
    expect(view.frames.join("\n")).not.toContain("▏");

    view.stdin.write("second");
    view.stdin.write("\u001b[H");
    const beforeDelete = view.frames.length;
    view.stdin.write("\u007f");
    await settle();

    for (const frame of view.frames.slice(beforeDelete)) {
      const lines = frame.split("\n");
      const statusRow = lines.findIndex((line) => line.includes("openai/gpt-test"));
      expect(statusRow).toBe(lines.length - 1);
    }
  });

  it("routes inline choices without editing the disabled task input", async () => {
    const i18n = new I18n("en");
    const store = new TuiStore(i18n);
    store.setMetadata(metadata);
    store.setIdle();
    const controller = fakeController();
    const confirmation = store.requestConfirm("Trust workspace?");
    const view = render(<TuiApp controller={controller} store={store} i18n={i18n} />);

    await settle();
    expect(view.frames.join("\n")).toContain("Trust workspace? [y/N]");
    expect(view.frames.join("\n")).toContain("Task >");
    view.stdin.write("abc");
    view.stdin.write("y");
    await expect(confirmation).resolves.toBe(true);
    await settle();
    expect(store.getSnapshot().blocks.at(-1)).toMatchObject({
      kind: "interaction",
      status: "resolved",
      answer: "y",
    });
    expect(view.frames.join("\n")).not.toContain("Task > abc");
  });

  it("safely denies an inline confirmation on Escape", async () => {
    const i18n = new I18n("en");
    const store = new TuiStore(i18n);
    store.setIdle();
    const confirmation = store.requestConfirm("Continue?");
    const view = render(<TuiApp controller={fakeController()} store={store} i18n={i18n} />);
    await settle();
    view.stdin.write("\u001b");
    await expect(confirmation).resolves.toBe(false);
    expect(store.getSnapshot().blocks.at(-1)).toMatchObject({
      kind: "interaction",
      status: "resolved",
      answer: "n",
    });
  });
});
