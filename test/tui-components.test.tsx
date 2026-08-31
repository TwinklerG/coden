import { render } from "ink-testing-library";
import { describe, expect, it, vi } from "vitest";
import { I18n } from "../src/i18n/i18n.js";
import { InputBar } from "../src/tui/components/input-bar.js";
import { PermissionDialog } from "../src/tui/components/permission-dialog.js";
import { formatStatus } from "../src/tui/components/status-bar.js";
import { TranscriptView } from "../src/tui/components/transcript-view.js";
import type { TranscriptBlock } from "../src/tui/types.js";

const metadata = {
  provider: "openai" as const,
  model: "gpt-test",
  workspace: "/workspace",
  workspaceId: "abcdef123456",
  approvalMode: "smart" as const,
  sessionId: "session-123456",
};

describe("TUI components", () => {
  it("renders the transcript in CLI-like form", () => {
    const view = render(
      <TranscriptView
        blocks={[
          { id: "u", kind: "user", text: "hello" },
          { id: "a", kind: "assistant", markdown: "**answer**" },
          { id: "t", kind: "tool", text: "✓ read  2ms", failed: false },
        ]}
        columns={40}
        rows={8}
        followOutput={true}
        active={false}
        i18n={new I18n("en")}
        onFollowChange={() => {}}
      />,
    );
    expect(view.lastFrame()).toContain("> hello");
    expect(view.lastFrame()).toContain("answer");
    expect(view.lastFrame()).toContain("✓ read  2ms");
  });

  it("submits editor input and preserves continuation semantics", async () => {
    const onSubmit = vi.fn();
    const view = render(
      <InputBar
        disabled={false}
        active={true}
        language="en"
        columns={50}
        onSubmit={onSubmit}
        onEof={() => {}}
        onInterrupt={() => {}}
      />,
    );
    view.stdin.write("hello\\\r");
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(view.lastFrame()).toContain("hello");
    view.stdin.write("world\r");
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(onSubmit).toHaveBeenCalledWith("hello\nworld");
  });

  it("routes Ctrl+C to immediate idle exit even with a draft", async () => {
    const onInterrupt = vi.fn();
    const view = render(
      <InputBar
        disabled={false}
        active={true}
        language="en"
        columns={50}
        onSubmit={() => {}}
        onEof={() => {}}
        onInterrupt={onInterrupt}
      />,
    );
    view.stdin.write("draft");
    view.stdin.write("\u0003");
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(onInterrupt).toHaveBeenCalledOnce();
  });

  it("ignores the kitty keyboard probe response instead of inserting it", async () => {
    const onSubmit = vi.fn();
    const view = render(
      <InputBar
        disabled={false}
        active={true}
        language="en"
        columns={40}
        onSubmit={onSubmit}
        onEof={() => {}}
        onInterrupt={() => {}}
      />,
    );
    // Ink strips the leading ESC from an unresolved escape sequence, so the
    // DECRPM probe response reaches the handler as "[?0u". It must not show up.
    view.stdin.write("\u001b[?0u");
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(view.lastFrame()).not.toContain("[?0u");
    view.stdin.write("hello\r");
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(onSubmit).toHaveBeenCalledWith("hello");
  });

  it("consumes mouse reports without inserting ANSI into editor input", async () => {
    const onSubmit = vi.fn();
    const view = render(
      <InputBar
        disabled={false}
        active={true}
        language="en"
        columns={50}
        onSubmit={onSubmit}
        onEof={() => {}}
        onInterrupt={() => {}}
      />,
    );
    view.stdin.write("[<0;10;5M");
    view.stdin.write("[<0;10;5m");
    view.stdin.write("[<35;11;5M");
    view.stdin.write("[<64;11");
    view.stdin.write("[<64;11;5M[<65;11;5M");
    view.stdin.write("hello\r");
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(onSubmit).toHaveBeenCalledWith("hello");
  });

  it("scrolls transcript history and restores follow mode", async () => {
    const onFollowChange = vi.fn();
    const blocks = Array.from({ length: 12 }, (_, index) => ({
      id: `line-${index}`,
      kind: "info" as const,
      text: `line ${index}`,
    }));
    const view = render(
      <TranscriptView
        blocks={blocks}
        columns={30}
        rows={4}
        followOutput={true}
        active={true}
        i18n={new I18n("en")}
        onFollowChange={onFollowChange}
      />,
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(view.lastFrame()).toContain("line 11");
    view.stdin.write("\u001b[<64;10;5M");
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(onFollowChange).toHaveBeenCalledWith(false);
    const callsAfterScroll = onFollowChange.mock.calls.length;
    view.stdin.write("\u001b[<0;10;5M");
    view.stdin.write("\u001b[<0;10;5m");
    view.stdin.write("\u001b[<35;11;5M");
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(onFollowChange).toHaveBeenCalledTimes(callsAfterScroll);
    view.stdin.write("\u001b[F");
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(onFollowChange).toHaveBeenLastCalledWith(true);
  });

  it("keeps the first editor row within the prompt boundary", async () => {
    const onRowsChange = vi.fn();
    const view = render(
      <InputBar
        disabled={false}
        active={true}
        language="en"
        columns={12}
        onSubmit={() => {}}
        onEof={() => {}}
        onInterrupt={() => {}}
        onRowsChange={onRowsChange}
      />,
    );
    view.stdin.write("abcd");
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(onRowsChange).toHaveBeenLastCalledWith(1);
    expect(view.lastFrame()?.split("\n")[1]).toBe("Task > abcd▏");
  });

  it("draws terminal-width rules around the input", () => {
    const view = render(
      <InputBar
        disabled={false}
        active={true}
        language="en"
        columns={12}
        onSubmit={() => {}}
        onEof={() => {}}
        onInterrupt={() => {}}
      />,
    );

    expect(view.lastFrame()?.split("\n")).toEqual(["────────────", "Task > ▏", "────────────"]);
  });

  it("uses Kitty Shift+Enter for a newline and Enter for submission", async () => {
    const onSubmit = vi.fn();
    const view = render(
      <InputBar
        disabled={false}
        active={true}
        language="en"
        columns={50}
        onSubmit={onSubmit}
        onEof={() => {}}
        onInterrupt={() => {}}
      />,
    );

    view.stdin.write("first");
    view.stdin.write("\u001b[13;2u");
    view.stdin.write("second\r");
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(onSubmit).toHaveBeenCalledWith("first\nsecond");
  });

  it("moves within a multiline draft without switching history", async () => {
    const onSubmit = vi.fn();
    const view = render(
      <InputBar
        disabled={false}
        active={true}
        language="en"
        columns={50}
        onSubmit={onSubmit}
        onEof={() => {}}
        onInterrupt={() => {}}
      />,
    );

    view.stdin.write("abcd");
    view.stdin.write("\u001b[13;2u");
    view.stdin.write("xy");
    view.stdin.write("\u001b[A");
    view.stdin.write("\u001b[D");
    view.stdin.write("Z");
    view.stdin.write("\u0005");
    view.stdin.write("\u001b[B");
    view.stdin.write("\r");
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(onSubmit).toHaveBeenCalledWith("aZbcd\nxy");
  });

  it("resizes both input rules with terminal columns", () => {
    const props = {
      disabled: false,
      active: true,
      language: "en" as const,
      onSubmit: () => {},
      onEof: () => {},
      onInterrupt: () => {},
    };
    const view = render(<InputBar {...props} columns={8} />);
    expect(view.lastFrame()?.split("\n")[0]).toBe("────────");

    view.rerender(<InputBar {...props} columns={14} />);
    const lines = view.lastFrame()?.split("\n") ?? [];
    expect(lines[0]).toBe("──────────────");
    expect(lines.at(-1)).toBe("──────────────");
  });

  it("reports wrapped input rows", async () => {
    const onRowsChange = vi.fn();
    const view = render(
      <InputBar
        disabled={false}
        active={true}
        language="en"
        columns={12}
        onSubmit={() => {}}
        onEof={() => {}}
        onInterrupt={() => {}}
        onRowsChange={onRowsChange}
      />,
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(onRowsChange).toHaveBeenLastCalledWith(1);
    view.stdin.write("abcdefghij");
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(onRowsChange).toHaveBeenLastCalledWith(3);
    view.stdin.write("\r");
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(onRowsChange).toHaveBeenLastCalledWith(1);
  });

  it("formats status by priority", () => {
    expect(formatStatus(metadata, "thinking", 42, 80)).toContain(
      "openai/gpt-test · workspace · smart · thinking · context 42%",
    );
    expect(formatStatus(metadata, "thinking", 42, 18)).toBe("openai/gpt-test");
  });

  it("renders thinking as the latest transcript block", () => {
    const view = render(
      <TranscriptView
        blocks={[
          { id: "u", kind: "user", text: "hello" },
          { id: "activity", kind: "activity", phase: "thinking", text: "checking files" },
        ]}
        columns={40}
        rows={6}
        followOutput={true}
        active={false}
        i18n={new I18n("en")}
        onFollowChange={() => {}}
      />,
    );

    expect(view.lastFrame()).toContain("> hello");
    expect(view.lastFrame()).toContain("checking files");
    expect(view.lastFrame()).toMatch(/[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/u);
  });

  it("keeps activity updates at the bottom only while follow mode is enabled", async () => {
    const i18n = new I18n("en");
    const onFollowChange = vi.fn();
    const base = Array.from({ length: 8 }, (_, index) => ({
      id: `line-${index}`,
      kind: "info" as const,
      text: `line ${index}`,
    }));
    const renderView = (blocks: TranscriptBlock[], followOutput: boolean) => (
      <TranscriptView
        blocks={blocks}
        columns={30}
        rows={4}
        followOutput={followOutput}
        active={true}
        i18n={i18n}
        onFollowChange={onFollowChange}
      />
    );
    const activity: TranscriptBlock = {
      id: "activity",
      kind: "activity",
      phase: "thinking",
      text: "first thought",
    };
    const visibleLines = (frame: string | undefined) =>
      (frame ?? "")
        .split("\n")
        .filter((line) => /^line \d+$/.test(line))
        .join("|");
    const view = render(renderView([...base, activity], true));
    expect(view.lastFrame()).toContain("first thought");

    // Scrolling up turns follow mode off and keeps the viewport off the tail.
    view.stdin.write("\u001b[5~");
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(onFollowChange).toHaveBeenLastCalledWith(false);
    const scrolled = visibleLines(view.lastFrame());

    // While follow mode is off, adding activity and a new block must not jump the
    // viewport back to the tail; the visible set of earlier lines stays put.
    view.rerender(
      renderView(
        [
          ...base,
          { ...activity, text: "updated thought" },
          { id: "new", kind: "info", text: "new" },
        ],
        false,
      ),
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(onFollowChange).toHaveBeenLastCalledWith(false);
    expect(visibleLines(view.lastFrame())).toBe(scrolled);

    // Re-enabling follow mode brings the updated trailing activity into view.
    view.rerender(renderView([...base, { ...activity, text: "updated thought" }], true));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(view.lastFrame()).toContain("updated thought");
  });

  it("uses risk-aware permission choices", async () => {
    const onResolve = vi.fn();
    const normal = render(
      <PermissionDialog
        dialog={{
          id: 1,
          kind: "permission",
          title: "edit · modify",
          lines: ["path: src/a.ts"],
          risk: "modify",
          allowSession: true,
        }}
        onResolve={onResolve}
      />,
    );
    expect(normal.lastFrame()).toContain("[s] session");
    normal.stdin.write("s");
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(onResolve).toHaveBeenCalledWith("allow_session");

    const dangerous = render(
      <PermissionDialog
        dialog={{
          id: 2,
          kind: "permission",
          title: "bash · dangerous",
          lines: ["command: rm"],
          risk: "dangerous",
          allowSession: false,
        }}
        onResolve={() => {}}
      />,
    );
    expect(dangerous.lastFrame()).not.toContain("session");
  });
});
