import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { WebStateResponse } from "../../web/protocol.js";
import type { CodeNWebApi, StateStreamOptions } from "../src/api.js";
import { App } from "../src/app.js";

const baseState: WebStateResponse = {
  protocolVersion: 1,
  viewer: { clientId: "owner", isOwner: true },
  snapshot: {
    revision: 1,
    phase: "idle",
    running: false,
    language: "en",
    remote: false,
    metadata: {
      provider: "openai",
      model: "test-model",
      workspace: "/workspace/project",
      workspaceId: "work",
      approvalMode: "manual",
      sessionId: "session-1",
      thinkingLevel: "high",
      thinkingDisplay: "high",
    },
    sessionId: "session-1",
    sessions: [
      {
        id: "session-1",
        title: "Current task",
        messageCount: 3,
        lastActivity: "2026-01-01",
      },
      {
        id: "session-2",
        title: "Previous task",
        messageCount: 4,
        lastActivity: "2025-01-01",
      },
    ],
    blocks: [
      { id: "u", kind: "user", text: "Fix tests" },
      { id: "a", kind: "assistant", markdown: "**Done**" },
      {
        id: "t",
        kind: "tool",
        callId: "call",
        name: "write",
        status: "succeeded",
        input: { path: "a.ts" },
        output: "Wrote file",
      },
      {
        id: "i",
        kind: "interaction",
        interaction: "permission",
        status: "pending",
        toolName: "bash",
        risk: "dangerous",
        input: { command: "rm file" },
        allowSession: false,
      },
    ],
    pendingInteractionId: "i",
    control: { ownerClientId: "owner" },
    contextPercent: 42,
    startupWarnings: [],
  },
};

function setup(state = baseState) {
  const api = {
    takeover: vi.fn(async () => {}),
    submit: vi.fn(async () => {}),
    cancel: vi.fn(async () => {}),
    answerInteraction: vi.fn(async () => {}),
    newSession: vi.fn(async () => {}),
    resumeSession: vi.fn(async () => {}),
  } as unknown as CodeNWebApi;
  const connect = (options: StateStreamOptions) => {
    options.onStatus("connected");
    options.onState(state);
    return { dispose: vi.fn() };
  };
  render(<App api={api} connect={connect} />);
  return api as unknown as {
    takeover: ReturnType<typeof vi.fn>;
    submit: ReturnType<typeof vi.fn>;
    cancel: ReturnType<typeof vi.fn>;
    answerInteraction: ReturnType<typeof vi.fn>;
    newSession: ReturnType<typeof vi.fn>;
    resumeSession: ReturnType<typeof vi.fn>;
  };
}

describe("Web App", () => {
  it("renders runtime metadata, transcript, tool details, and safe approval actions", async () => {
    const api = setup();
    expect(screen.getByText("openai/test-model")).toBeInTheDocument();
    expect(screen.getByText("42%")).toBeInTheDocument();
    expect(screen.getByText("Done")).toBeInTheDocument();
    const details = screen.getByText("write").closest("details");
    expect(details).not.toHaveAttribute("open");
    await userEvent.click(screen.getByText("write"));
    expect(screen.getByText(/a\.ts/)).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Allow for session" }),
    ).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Allow once" }));
    expect(api.answerInteraction).toHaveBeenCalledWith("i", "allow_once");
  });

  it("submits on Enter, preserves Shift+Enter, and switches idle sessions", async () => {
    const { pendingInteractionId: _pending, ...idleSnapshot } =
      baseState.snapshot;
    const api = setup({
      ...baseState,
      snapshot: { ...idleSnapshot, blocks: [] },
    });
    const input = screen.getByLabelText("Describe the task to complete");
    await userEvent.type(input, "line one{shift>}{enter}{/shift}line two");
    expect(input).toHaveValue("line one\nline two");
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() =>
      expect(api.submit).toHaveBeenCalledWith("line one\nline two"),
    );
    await userEvent.click(
      screen.getByRole("button", { name: /Previous task/ }),
    );
    expect(api.resumeSession).toHaveBeenCalledWith("session-2");
  });

  it("makes non-owner clients read-only and allows takeover", async () => {
    const api = setup({
      ...baseState,
      viewer: { clientId: "viewer", isOwner: false },
    });
    expect(
      screen.getByLabelText("Describe the task to complete"),
    ).toBeDisabled();
    const takeover = screen.getByRole("button", { name: "Take control" });
    await userEvent.click(takeover);
    expect(api.takeover).toHaveBeenCalledOnce();
    expect(
      within(screen.getByRole("main")).getByText("Read only"),
    ).toBeInTheDocument();
  });
});
