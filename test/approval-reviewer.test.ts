import { describe, expect, it } from "vitest";
import { EventBus } from "../src/core/events.js";
import type { ToolDefinition } from "../src/core/types.js";
import { LlmApprovalReviewer, normalizeApprovalReason } from "../src/permissions/reviewer.js";
import { ScriptedProvider, scriptedText } from "../src/providers/scripted.js";

const tool: ToolDefinition = {
  name: "write",
  description: "write a file",
  risk: "modify",
  inputSchema: { type: "object" },
  async execute() {
    return { content: "ok" };
  },
};

describe("LlmApprovalReviewer", () => {
  it("sends isolated, tool-free untrusted review data and parses allow", async () => {
    const provider = new ScriptedProvider([
      scriptedText('{"decision":"allow","reason":"bounded local edit"}'),
    ]);
    const reviewer = new LlmApprovalReviewer(provider, "review-model", "medium", new EventBus());
    await expect(
      reviewer.review({
        task: "update a",
        tool,
        call: { callId: "w", name: "write", input: { path: "a", content: "x" } },
        risk: "modify",
        workspace: "/work",
        pathScope: "inside",
      }),
    ).resolves.toMatchObject({ decision: "allow", reason: "bounded local edit" });
    expect(provider.requests[0]).toMatchObject({
      model: "review-model",
      tools: [],
      maxOutputTokens: 256,
    });
    expect(provider.requests[0]?.messages[1]?.content).toContain("UNTRUSTED_DATA_BEGIN");
  });
  it("fails closed on invalid protocol and normalizes reasons", async () => {
    const provider = new ScriptedProvider([scriptedText('{"decision":"deny","reason":"no"}')]);
    const reviewer = new LlmApprovalReviewer(provider, "review-model", "hard", new EventBus());
    await expect(
      reviewer.review({
        task: "x",
        tool,
        call: { callId: "w", name: "write", input: {} },
        risk: "modify",
        workspace: "/work",
        pathScope: "inside",
      }),
    ).rejects.toThrow("protocol");
    expect(normalizeApprovalReason("ok\u001b[31m\n reason")).toBe("ok reason");
  });
});
