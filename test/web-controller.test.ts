import { describe, expect, it, vi } from "vitest";
import type { AgentApplication } from "../src/cli/agent-application.js";
import type { AgentCommandOptions } from "../src/cli/agent-command.js";
import { EventBus } from "../src/core/events.js";
import { I18n } from "../src/i18n/i18n.js";
import { WebController } from "../src/web/controller.js";
import { WebStore } from "../src/web/store.js";

const command: AgentCommandOptions = {
  auto: false,
  smartApprove: false,
  allowOutsideWorkspace: false,
  verbose: false,
  plugin: [],
  print: false,
  tui: false,
  cli: false,
};

function fakeApplication(
  run = vi.fn(async () => ({ answer: "", messages: [], toolsExecuted: 0 })),
) {
  const events = new EventBus();
  const app = {
    runtime: { run },
    events,
    session: {
      sessionId: "session-1",
      list: vi.fn(async () => [
        { id: "session-1", title: "First", messageCount: 1, lastActivity: "2026-01-01" },
      ]),
    },
    recoveredMessages: [],
    startupWarnings: [],
    metadata: {
      provider: "openai",
      model: "model",
      workspace: "/tmp/work",
      workspaceId: "work",
      approvalMode: "manual",
      sessionId: "session-1",
      thinkingLevel: "default",
      thinkingDisplay: "default",
    },
    end: vi.fn(async () => {}),
    dispose: vi.fn(async () => {}),
  };
  return { app: app as unknown as AgentApplication, events, run };
}

describe("WebController", () => {
  it("assigns one owner and rejects stale owners after takeover", async () => {
    const fake = fakeApplication();
    const store = new WebStore("en");
    const controller = new WebController({
      workspace: "/tmp/work",
      command,
      i18n: new I18n("en"),
      store,
      createApplication: async (options) => {
        options.onEvents?.(fake.events);
        return fake.app;
      },
    });
    await controller.bootstrap();

    expect(controller.connectClient("a")).toEqual({ clientId: "a", isOwner: true });
    expect(controller.connectClient("b")).toEqual({ clientId: "b", isOwner: false });
    expect(() => controller.submit("b", "task")).toThrow("read-only");
    controller.takeover("b");
    controller.submit("b", "task");
    expect(() => controller.submit("a", "second")).toThrow("read-only");
    expect(fake.run).toHaveBeenCalledOnce();
    await controller.shutdown();
  });

  it("does not cancel an active turn when a browser disconnects", async () => {
    let resolve!: () => void;
    const run = vi.fn(
      (_text: string, signal: AbortSignal) =>
        new Promise((done) => {
          signal.addEventListener("abort", () => done(undefined), { once: true });
          resolve = () => done(undefined);
        }),
    );
    const fake = fakeApplication(run);
    const store = new WebStore("en");
    const controller = new WebController({
      workspace: "/tmp/work",
      command,
      i18n: new I18n("en"),
      store,
      createApplication: async (options) => {
        options.onEvents?.(fake.events);
        return fake.app;
      },
    });
    await controller.bootstrap();
    controller.connectClient("a");
    controller.submit("a", "task");
    controller.disconnectClient("a");
    expect(run.mock.calls[0]?.[1].aborted).toBe(false);
    resolve();
    await Promise.resolve();
    await controller.shutdown();
  });

  it("disposes the old application before an idle session switch", async () => {
    const first = fakeApplication();
    const second = fakeApplication();
    const order: string[] = [];
    first.app.dispose = vi.fn(async () => {
      order.push("dispose");
    });
    let calls = 0;
    const store = new WebStore("en");
    const controller = new WebController({
      workspace: "/tmp/work",
      command,
      i18n: new I18n("en"),
      store,
      createApplication: async (options) => {
        options.onEvents?.(calls === 0 ? first.events : second.events);
        calls++;
        order.push(`create-${String(options.command.resume)}`);
        return calls === 1 ? first.app : second.app;
      },
    });
    await controller.bootstrap();
    controller.connectClient("a");
    await controller.resumeSession("a", "session-1");
    expect(order).toEqual(["create-false", "dispose", "create-session-1"]);
    await controller.shutdown();
  });
});
