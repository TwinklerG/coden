import { describe, expect, it } from "vitest";
import { runCommandHook } from "../src/hooks/command-runner.js";
import type { ConfiguredCommandHook, HookInput } from "../src/hooks/types.js";

const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
const base: ConfiguredCommandHook = {
  event: "Notification",
  scope: "user",
  order: 0,
  matcherSource: "*",
  command: "",
  timeoutMs: 1000,
};
const input: HookInput<"Notification"> = {
  schemaVersion: 1,
  hookEventName: "Notification",
  sessionId: "s",
  cwd: process.cwd(),
  permissionMode: "manual",
  notificationType: "permission_prompt",
  title: "CodeN",
  message: "wait",
};
describe("command hook runner", () => {
  it("passes bounded JSON stdin and environment", async () => {
    const script =
      "let s='';process.stdin.on('data',c=>s+=c);process.stdin.on('end',()=>process.stdout.write(JSON.stringify({event:process.env.CODEN_HOOK_EVENT,input:JSON.parse(s)})))";
    const result = await runCommandHook(
      { ...base, command: `${quote(process.execPath)} -e ${quote(script)}` },
      input,
      { cwd: process.cwd(), sessionId: "s", permissionMode: "manual" },
    );
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      event: "Notification",
      input: { message: "wait" },
    });
  });
  it("times out and rejects oversized input", async () => {
    const timeout = await runCommandHook(
      {
        ...base,
        timeoutMs: 20,
        command: `${quote(process.execPath)} -e ${quote("setInterval(()=>{},1000)")}`,
      },
      input,
      { cwd: process.cwd(), sessionId: "s", permissionMode: "manual" },
    );
    expect(timeout.timedOut).toBe(true);
    const large = { ...input, message: "x".repeat(1024 * 1024) };
    expect(
      (
        await runCommandHook(base, large, {
          cwd: process.cwd(),
          sessionId: "s",
          permissionMode: "manual",
        })
      ).inputExceeded,
    ).toBe(true);
  });
});
