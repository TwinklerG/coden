import { describe, expect, it, vi } from "vitest";
import { EventBus } from "../src/core/events.js";
import type { CommandHookRunner } from "../src/hooks/command-runner.js";
import { HookEngine } from "../src/hooks/engine.js";
import type { ConfiguredCommandHook } from "../src/hooks/types.js";

const result = (stdout: string) => ({
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
describe("HookEngine", () => {
  it("merges decisions and context by configuration order without tracing secrets", async () => {
    const hooks: ConfiguredCommandHook[] = ["allow", "deny"].map((command, order) => ({
      event: "PreToolUse",
      scope: "user",
      order,
      matcherSource: "bash",
      matcher: /bash/,
      command,
      timeoutMs: 1000,
    }));
    const events = new EventBus();
    const seen: unknown[] = [];
    events.on((event) => {
      seen.push(event);
    });
    const runner: CommandHookRunner = vi.fn(async (hook) =>
      result(
        JSON.stringify({
          hookSpecificOutput: {
            hookEventName: "PreToolUse",
            permissionDecision: hook.command,
            additionalContext: `${hook.command}-context`,
          },
        }),
      ),
    );
    const aggregate = await new HookEngine(hooks, events, runner).run(
      "PreToolUse",
      { toolName: "bash", callId: "c", input: { command: "secret" }, risk: "modify" },
      { cwd: process.cwd(), sessionId: "s", permissionMode: "smart" },
    );
    expect(aggregate.permissionDecision).toBe("deny");
    expect(aggregate.additionalContext).toEqual(["allow-context", "deny-context"]);
    expect(JSON.stringify(seen)).not.toContain("secret");
  });
  it("rejects conflicting updated inputs", async () => {
    const hooks: ConfiguredCommandHook[] = [0, 1].map((order) => ({
      event: "PreToolUse",
      scope: "user",
      order,
      matcherSource: "*",
      command: String(order),
      timeoutMs: 1000,
    }));
    const runner: CommandHookRunner = async (hook) =>
      result(
        JSON.stringify({
          hookSpecificOutput: {
            hookEventName: "PreToolUse",
            updatedInput: { value: hook.command },
          },
        }),
      );
    const aggregate = await new HookEngine(hooks, new EventBus(), runner).run(
      "PreToolUse",
      { toolName: "x", callId: "c", input: {}, risk: "read" },
      { cwd: process.cwd(), sessionId: "s", permissionMode: "manual" },
    );
    expect(aggregate).toMatchObject({ inputConflict: true, hasUpdatedInput: false });
  });
});
