import { describe, expect, it, vi } from "vitest";
import type { AgentApplication } from "../src/cli/agent-application.js";
import type { AgentCommandOptions } from "../src/cli/agent-command.js";
import { EventBus } from "../src/core/events.js";
import { I18n } from "../src/i18n/i18n.js";
import { SkillRegistry } from "../src/skills/registry.js";
import { ToolRegistry } from "../src/tools/registry.js";
import { TuiController } from "../src/tui/controller.js";
import { TuiStore } from "../src/tui/store.js";

const command: AgentCommandOptions = {
  auto: true,
  smartApprove: false,
  allowOutsideWorkspace: false,
  verbose: false,
  plugin: [],
  print: false,
  tui: true,
  cli: false,
};

function fakeApplication(run: (text: string, signal: AbortSignal) => Promise<unknown>) {
  const events = new EventBus();
  const dispose = vi.fn(async () => {});
  const runtime = {
    run,
    compact: vi.fn(async () => {}),
    reset: vi.fn(async () => {}),
  };
  return {
    application: {
      runtime,
      events,
      session: { sessionId: "session-123", list: async () => [] },
      registry: new ToolRegistry(),
      skills: new SkillRegistry(),
      recoveredMessages: [],
      startupWarnings: [],
      metadata: {
        provider: "openai",
        model: "test",
        workspace: "/workspace",
        workspaceId: "workspace-id",
        approvalMode: "auto",
        sessionId: "session-123",
        thinkingLevel: "default",
        thinkingDisplay: "default",
      },
      reload: async () => ({ registry: new ToolRegistry(), loaded: [], failed: [] }),
      switchLanguage: async () => {},
      getThinkingStatus: () => ({
        level: "default",
        effectiveLevel: "default",
        displayLevel: "default",
      }),
      switchThinkingLevel: async () => ({
        level: "default",
        effectiveLevel: "default",
        displayLevel: "default",
      }),
      dispose,
    } as unknown as AgentApplication,
    events,
    runtime,
    dispose,
  };
}

describe("TuiController", () => {
  it("bootstraps metadata and executes an initial prompt once", async () => {
    const store = new TuiStore();
    const fake = fakeApplication(async (text) => {
      await fake.events.emit("turn.started", { input: text }, "turn");
      await fake.events.emit("provider.delta", { text: "answer" }, "turn");
      await fake.events.emit("turn.completed", {}, "turn");
    });
    const create = vi.fn(async (options) => {
      options.onEvents?.(fake.events);
      return fake.application;
    });
    const controller = new TuiController({
      initialPrompt: "hello",
      command,
      i18n: new I18n("en"),
      store,
      createApplication: create,
      onExit: () => {},
    });
    await controller.bootstrap();
    expect(create).toHaveBeenCalledOnce();
    expect(store.getSnapshot()).toMatchObject({
      phase: "idle",
      metadata: fake.application.metadata,
    });
    expect(store.getSnapshot().blocks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "user", text: "hello" }),
        expect.objectContaining({ kind: "assistant", markdown: "answer" }),
      ]),
    );
  });

  it("routes /thinking to the shared command without starting a turn", async () => {
    const store = new TuiStore();
    const run = vi.fn(async () => {});
    const fake = fakeApplication(run);
    const controller = new TuiController({
      command,
      i18n: new I18n("en"),
      store,
      createApplication: async (options) => {
        options.onEvents?.(fake.events);
        return fake.application;
      },
      onExit: () => {},
    });
    await controller.bootstrap();
    await controller.submit("/thinking high");
    expect(store.getSnapshot().blocks.at(-1)).toMatchObject({ kind: "info" });
    expect(run).not.toHaveBeenCalled();
  });

  it("exits and restores the TUI after bootstrap failure", async () => {
    const store = new TuiStore();
    const exited = vi.fn();
    const controller = new TuiController({
      command,
      i18n: new I18n("en"),
      store,
      createApplication: async () => {
        throw new Error("bootstrap failed");
      },
      onExit: exited,
    });
    await controller.bootstrap();
    expect(store.getSnapshot()).toMatchObject({
      phase: "failed",
      fatalError: "bootstrap failed",
    });
    expect(exited).toHaveBeenCalledOnce();
  });

  it("exits and restores the TUI after an unexpected runtime failure", async () => {
    const store = new TuiStore();
    const exited = vi.fn();
    const fake = fakeApplication(async () => {
      throw new Error("runtime failed");
    });
    const controller = new TuiController({
      command,
      i18n: new I18n("en"),
      store,
      createApplication: async (options) => {
        options.onEvents?.(fake.events);
        return fake.application;
      },
      onExit: exited,
    });
    await controller.bootstrap();
    await controller.submit("one");
    expect(store.getSnapshot()).toMatchObject({
      phase: "failed",
      fatalError: "runtime failed",
    });
    expect(fake.dispose).toHaveBeenCalledOnce();
    expect(exited).toHaveBeenCalledOnce();
  });

  it("serializes turns and cancels the active turn", async () => {
    const store = new TuiStore();
    let started = 0;
    const fake = fakeApplication(
      (_text, signal) =>
        new Promise((resolve, reject) => {
          started++;
          const timer = setTimeout(resolve, 2_000);
          signal.addEventListener(
            "abort",
            () => {
              clearTimeout(timer);
              reject(signal.reason);
            },
            { once: true },
          );
        }),
    );
    const controller = new TuiController({
      command,
      i18n: new I18n("en"),
      store,
      createApplication: async (options) => {
        options.onEvents?.(fake.events);
        return fake.application;
      },
      onExit: () => {},
    });
    await controller.bootstrap();
    const first = controller.submit("one");
    await controller.submit("two");
    expect(started).toBe(1);
    controller.cancel();
    await first;
  });

  it("exits immediately without confirmation when idle", async () => {
    const store = new TuiStore();
    const fake = fakeApplication(async () => {});
    const exited = vi.fn();
    const controller = new TuiController({
      command,
      i18n: new I18n("en"),
      store,
      createApplication: async (options) => {
        options.onEvents?.(fake.events);
        return fake.application;
      },
      onExit: exited,
    });
    await controller.bootstrap();
    await controller.requestExit();
    expect(store.getSnapshot().pendingInteraction).toBeUndefined();
    expect(fake.dispose).toHaveBeenCalledOnce();
    expect(exited).toHaveBeenCalledOnce();
  });

  it("cancels an active turn before a later request exits", async () => {
    const store = new TuiStore();
    const exited = vi.fn();
    const fake = fakeApplication(
      (_text, signal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason), { once: true });
        }),
    );
    const controller = new TuiController({
      command,
      i18n: new I18n("en"),
      store,
      createApplication: async (options) => {
        options.onEvents?.(fake.events);
        return fake.application;
      },
      onExit: exited,
    });
    await controller.bootstrap();
    const turn = controller.submit("one");
    await new Promise((resolve) => setTimeout(resolve, 0));
    await controller.requestExit();
    await turn;
    expect(exited).not.toHaveBeenCalled();
    await controller.requestExit();
    expect(exited).toHaveBeenCalledOnce();
  });

  it("settles inline interactions and disposes once during shutdown", async () => {
    const store = new TuiStore();
    const fake = fakeApplication(async () => {});
    const exited = vi.fn();
    const controller = new TuiController({
      command,
      i18n: new I18n("en"),
      store,
      createApplication: async (options) => {
        options.onEvents?.(fake.events);
        return fake.application;
      },
      onExit: exited,
    });
    await controller.bootstrap();
    const confirmation = store.requestConfirm("Trust?");
    await controller.shutdown();
    await expect(confirmation).resolves.toBe(false);
    expect(store.getSnapshot().blocks.at(-1)).toMatchObject({
      kind: "interaction",
      status: "cancelled",
    });
    await controller.shutdown();
    expect(fake.dispose).toHaveBeenCalledOnce();
    expect(exited).toHaveBeenCalledOnce();
  });
});
