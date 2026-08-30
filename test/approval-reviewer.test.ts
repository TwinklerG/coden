import { describe, expect, it } from "vitest";
import { EventBus, type RuntimeEvent } from "../src/core/events.js";
import type { ModelEvent, ModelProvider, ModelRequest, ToolDefinition } from "../src/core/types.js";
import {
  type ApprovalReviewContext,
  ApprovalReviewError,
  LlmApprovalReviewer,
  normalizeApprovalReason,
} from "../src/permissions/reviewer.js";
import { ScriptedProvider, scriptedText, scriptedTool } from "../src/providers/scripted.js";

const signal = new AbortController().signal;
const tool: ToolDefinition = {
  name: "edit",
  description: "Edit one unique text occurrence",
  risk: "modify",
  inputSchema: { type: "object" },
  async execute() {
    return { content: "ok" };
  },
};
const context: ApprovalReviewContext = {
  task: "replace the old label",
  tool,
  call: {
    callId: "edit-1",
    name: "edit",
    input: { path: "src/a.ts", oldText: "old", newText: "new" },
  },
  risk: "modify",
  workspace: "/work",
  pathScope: "inside",
  turnId: "turn-1",
};

class AbortAwareProvider implements ModelProvider {
  readonly requests: ModelRequest[] = [];
  async *stream(request: ModelRequest): AsyncIterable<ModelEvent> {
    this.requests.push(request);
    await new Promise<never>((_, reject) => {
      if (request.signal?.aborted) {
        reject(request.signal.reason);
        return;
      }
      request.signal?.addEventListener("abort", () => reject(request.signal?.reason), {
        once: true,
      });
    });
  }
}

function observed(events: EventBus): RuntimeEvent[] {
  const seen: RuntimeEvent[] = [];
  events.on((event) => {
    seen.push(event);
  });
  return seen;
}

describe("LlmApprovalReviewer", () => {
  it.each(["soft", "medium", "hard"] as const)(
    "constructs a tool-free %s review request with complete untrusted input",
    async (strictness) => {
      const provider = new ScriptedProvider([
        scriptedText('{"decision":"allow","reason":"bounded local edit"}'),
      ]);
      const events = new EventBus();
      const seen = observed(events);
      const reviewer = new LlmApprovalReviewer(provider, "review-model", strictness, events);

      await expect(reviewer.review(context, signal)).resolves.toMatchObject({
        decision: "allow",
        reason: "bounded local edit",
      });

      const request = provider.requests[0];
      expect(request?.model).toBe("review-model");
      expect(request?.tools).toEqual([]);
      expect(request?.maxOutputTokens).toBe(256);
      expect(request?.messages[0]?.content).toContain(`Strictness (${strictness})`);
      expect(request?.messages[0]?.content).toContain(
        '{"decision":"allow","reason":"The operation is a bounded workspace-local edit."}',
      );
      expect(request?.messages[0]?.content).toContain(
        `{"decision":"human_review","reason":"The operation's impact is uncertain."}`,
      );
      expect(request?.messages[0]?.content).toContain(
        "Output only the JSON object, with no markdown fences or surrounding text.",
      );
      expect(request?.messages[1]?.content).toContain("UNTRUSTED_DATA_BEGIN");
      expect(request?.messages[1]?.content).toContain("replace the old label");
      expect(request?.messages[1]?.content).toContain("src/a.ts");
      expect(request?.messages[1]?.content).toContain('"pathScope":"inside"');
      expect(seen.map((event) => event.type)).toEqual([
        "permission.review_started",
        "permission.review_completed",
      ]);
      expect(JSON.stringify(seen)).not.toContain("oldText");
    },
  );

  it("uses distinct strictness policy wording", async () => {
    const provider = new ScriptedProvider([
      scriptedText('{"decision":"allow","reason":"ok"}'),
      scriptedText('{"decision":"allow","reason":"ok"}'),
      scriptedText('{"decision":"allow","reason":"ok"}'),
    ]);
    for (const strictness of ["soft", "medium", "hard"] as const) {
      await new LlmApprovalReviewer(provider, "review-model", strictness, new EventBus()).review(
        context,
      );
    }
    expect(provider.requests[0]?.messages[0]?.content).toContain("exhaustive proof");
    expect(provider.requests[1]?.messages[0]?.content).toContain("limited impact");
    expect(provider.requests[2]?.messages[0]?.content).toContain("very clear");
  });

  it.each([
    "not json",
    "{}",
    '{"decision":"deny","reason":"no"}',
    '{"decision":"allow","reason":""}',
    '{"decision":"allow","reason":"ok","extra":true}',
  ])("fails closed on invalid review output: %s", async (text) => {
    const provider = new ScriptedProvider([scriptedText(text)]);
    const events = new EventBus();
    const seen = observed(events);
    const reviewer = new LlmApprovalReviewer(provider, "review-model", "medium", events);

    await expect(reviewer.review(context, signal)).rejects.toBeInstanceOf(ApprovalReviewError);
    expect(seen.map((event) => event.type)).toEqual([
      "permission.review_started",
      "permission.review_failed",
    ]);
    expect(JSON.stringify(seen)).not.toContain("oldText");
  });

  it("rejects tool calls and ignores reasoning text", async () => {
    const invalid = new LlmApprovalReviewer(
      new ScriptedProvider([scriptedTool("call", "read", { path: "a" })]),
      "review-model",
      "medium",
      new EventBus(),
    );
    await expect(invalid.review(context)).rejects.toBeInstanceOf(ApprovalReviewError);

    const valid = new LlmApprovalReviewer(
      new ScriptedProvider([
        [
          { type: "reasoning_delta", text: "do not parse this" },
          { type: "text_delta", text: '{"decision":"human_review","reason":"ask"}' },
          { type: "done" },
        ],
      ]),
      "review-model",
      "medium",
      new EventBus(),
    );
    await expect(valid.review(context)).resolves.toMatchObject({
      decision: "human_review",
      reason: "ask",
    });
  });

  it("does not retry provider failures", async () => {
    const provider = new ScriptedProvider([new Error("provider unavailable")]);
    const events = new EventBus();
    const seen = observed(events);
    const reviewer = new LlmApprovalReviewer(provider, "review-model", "medium", events);
    await expect(reviewer.review(context)).rejects.toBeInstanceOf(ApprovalReviewError);
    expect(provider.requests).toHaveLength(1);
    expect(seen.map((event) => event.type)).toEqual([
      "permission.review_started",
      "permission.review_failed",
    ]);
  });

  it("normalizes and bounds review reasons", () => {
    expect(normalizeApprovalReason("ok\u001b[31m\n  reason")).toBe("ok reason");
    expect([...normalizeApprovalReason("x".repeat(600))]).toHaveLength(500);
  });

  it("times out once and reports a failed review", async () => {
    const provider = new AbortAwareProvider();
    const events = new EventBus();
    const seen = observed(events);
    const reviewer = new LlmApprovalReviewer(provider, "review-model", "medium", events, 1);
    await expect(reviewer.review(context)).rejects.toBeInstanceOf(ApprovalReviewError);
    expect(provider.requests).toHaveLength(1);
    expect(seen.map((event) => event.type)).toEqual([
      "permission.review_started",
      "permission.review_failed",
    ]);
  });

  it("propagates caller cancellation without reporting reviewer failure", async () => {
    const provider = new AbortAwareProvider();
    const events = new EventBus();
    const seen = observed(events);
    const reviewer = new LlmApprovalReviewer(provider, "review-model", "medium", events);
    const controller = new AbortController();
    const reason = new Error("cancelled by caller");
    const pending = reviewer.review(context, controller.signal);
    controller.abort(reason);
    await expect(pending).rejects.toBe(reason);
    expect(seen.map((event) => event.type)).toEqual(["permission.review_started"]);
  });

  it.each(["length", "max_tokens"])("rejects a truncated %s response", async (finishReason) => {
    const provider = new ScriptedProvider([
      [
        { type: "text_delta", text: '{"decision":"allow","reason":"looks valid"}' },
        { type: "done", finishReason },
      ],
    ]);
    const reviewer = new LlmApprovalReviewer(provider, "review-model", "medium", new EventBus());
    await expect(reviewer.review(context)).rejects.toBeInstanceOf(ApprovalReviewError);
  });

  it("rejects a stream that ends without a done event", async () => {
    const provider = new ScriptedProvider([
      [{ type: "text_delta", text: '{"decision":"allow","reason":"ok"}' }],
    ]);
    const reviewer = new LlmApprovalReviewer(provider, "review-model", "medium", new EventBus());
    await expect(reviewer.review(context)).rejects.toBeInstanceOf(ApprovalReviewError);
  });
});
