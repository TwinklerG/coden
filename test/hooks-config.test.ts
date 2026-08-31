import { describe, expect, it } from "vitest";
import { mergeConfiguredHooks, parseHookConfig } from "../src/hooks/config.js";

describe("hook configuration", () => {
  it("flattens and appends scoped hooks deterministically", () => {
    const user = parseHookConfig(
      {
        PreToolUse: [{ matcher: "bash", hooks: [{ type: "command", command: "one", timeout: 2 }] }],
      },
      "user",
    );
    const project = parseHookConfig(
      { Stop: [{ hooks: [{ type: "command", command: "two" }] }] },
      "project",
    );
    expect(
      mergeConfiguredHooks(user, project).map((hook) => [
        hook.event,
        hook.scope,
        hook.order,
        hook.timeoutMs,
      ]),
    ).toEqual([
      ["PreToolUse", "user", 0, 2000],
      ["Stop", "project", 1, 10000],
    ]);
  });
  it.each([
    [{ Unknown: [] }, "unsupported"],
    [{ Stop: [{ matcher: "bash", hooks: [] }] }, "does not accept"],
    [{ PreToolUse: [{ matcher: "(", hooks: [] }] }, "invalid matcher"],
    [{ PreToolUse: [{ hooks: [{ type: "http", command: "x" }] }] }, "type"],
    [{ PreToolUse: [{ hooks: [{ type: "command", command: "", timeout: 1 }] }] }, "command"],
    [{ PreToolUse: [{ extra: true, hooks: [] }] }, "unknown field"],
  ])("strictly rejects invalid config %#", (raw, message) =>
    expect(() => parseHookConfig(raw, "user")).toThrow(message),
  );
});
