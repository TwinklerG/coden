import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { EventBus } from "../src/core/events.js";
import type { CommandHookRunner } from "../src/hooks/command-runner.js";
import { HookEngine } from "../src/hooks/engine.js";
import type { ConfiguredCommandHook, HookEventName } from "../src/hooks/types.js";
import { PermissionPolicy } from "../src/permissions/policy.js";
import { ToolExecutor } from "../src/tools/executor.js";
import { ToolRegistry } from "../src/tools/registry.js";

const runResult = (stdout = "") => ({
  stdout,
  stderr: "",
  exitCode: 0,
  signal: null,
  timedOut: false,
  cancelled: false,
  outputExceeded: false,
  inputExceeded: false,
  durationMs: 1,
});
function hook(event: HookEventName, order: number): ConfiguredCommandHook {
  return { event, scope: "user", order, matcherSource: "*", command: event, timeoutMs: 1000 };
}

describe("tool lifecycle hooks", () => {
  it("uses updated input, then asks only at the human boundary", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "coden-hooks-"));
    const order: string[] = [];
    const runner: CommandHookRunner = async (configured) => {
      order.push(configured.event);
      if (configured.event === "PreToolUse")
        return runResult(
          JSON.stringify({
            hookSpecificOutput: {
              hookEventName: "PreToolUse",
              permissionDecision: "ask",
              updatedInput: { value: "updated" },
            },
          }),
        );
      return runResult();
    };
    const tool = {
      name: "change",
      description: "change",
      risk: "modify" as const,
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["value"],
        properties: { value: { type: "string" } },
      },
      execute: vi.fn(async (input: unknown) => {
        order.push("execute");
        return { content: (input as { value: string }).value };
      }),
    };
    const prompt = vi.fn(async () => {
      order.push("human");
      return "allow_once" as const;
    });
    const events = new EventBus();
    const hooks = new HookEngine(
      [
        hook("PreToolUse", 0),
        hook("PermissionRequest", 1),
        hook("Notification", 2),
        hook("PostToolUse", 3),
      ],
      events,
      runner,
    );
    const executor = new ToolExecutor(
      new ToolRegistry([tool]),
      new PermissionPolicy("manual", prompt),
      events,
      workspace,
      1000,
      false,
      hooks,
      { cwd: workspace, sessionId: "s", permissionMode: "manual" },
    );
    const outcome = await executor.execute(
      { callId: "c", name: "change", input: { value: "original" } },
      new AbortController().signal,
      "t",
    );
    expect(outcome.content).toBe("updated");
    expect(outcome.inputChanged).toBe(true);
    expect(order).toEqual([
      "PreToolUse",
      "PermissionRequest",
      "Notification",
      "human",
      "execute",
      "PostToolUse",
    ]);
  });

  it("keeps PreToolUse denial effective in auto mode", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "coden-hooks-"));
    const runner: CommandHookRunner = async () =>
      runResult(
        JSON.stringify({
          hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny" },
        }),
      );
    const tool = {
      name: "change",
      description: "change",
      risk: "modify" as const,
      inputSchema: { type: "object" },
      execute: vi.fn(async () => ({ content: "bad" })),
    };
    const hooks = new HookEngine([hook("PreToolUse", 0)], new EventBus(), runner);
    const executor = new ToolExecutor(
      new ToolRegistry([tool]),
      new PermissionPolicy("auto"),
      new EventBus(),
      workspace,
      1000,
      false,
      hooks,
      { cwd: workspace, sessionId: "s", permissionMode: "auto" },
    );
    const outcome = await executor.execute(
      { callId: "c", name: "change", input: {} },
      new AbortController().signal,
    );
    expect(outcome.isError).toBe(true);
    expect(tool.execute).not.toHaveBeenCalled();
  });
});
