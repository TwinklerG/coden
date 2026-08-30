import { describe, expect, it } from "vitest";
import type { ToolCall, ToolDefinition } from "../src/core/types.js";
import {
  type PermissionMode,
  PermissionPolicy,
  type PermissionReviewContext,
} from "../src/permissions/policy.js";
import {
  type ApprovalReview,
  type ApprovalReviewContext,
  ApprovalReviewError,
  type ApprovalReviewer,
} from "../src/permissions/reviewer.js";
import { builtinTools } from "../src/tools/builtin/index.js";

function requiredTool(name: string): ToolDefinition {
  const tool = builtinTools().find((candidate) => candidate.name === name);
  if (!tool) throw new Error(`missing ${name} tool`);
  return tool;
}

const readTool = requiredTool("read");
const writeTool = requiredTool("write");
const bashTool = requiredTool("bash");
const readCall: ToolCall = { callId: "r", name: "read", input: { path: "a.txt" } };
const writeCall: ToolCall = {
  callId: "w",
  name: "write",
  input: { path: "a.txt", content: "hello" },
};
const reviewContext: PermissionReviewContext = {
  task: "write a.txt",
  workspace: "/work",
  pathScope: "inside",
  turnId: "turn-1",
};
const allowedReview: ApprovalReview = {
  decision: "allow",
  reason: "safe local change",
  usage: { inputTokens: 10, outputTokens: 4 },
};

class RecordingReviewer implements ApprovalReviewer {
  readonly contexts: ApprovalReviewContext[] = [];
  constructor(private readonly result: ApprovalReview | Error) {}
  async review(context: ApprovalReviewContext): Promise<ApprovalReview> {
    this.contexts.push(context);
    if (this.result instanceof Error) throw this.result;
    return this.result;
  }
}

describe("PermissionPolicy smart approval", () => {
  it.each(["manual", "smart", "auto"] as const)("always allows read in %s", async (mode) => {
    const reviewer = new RecordingReviewer(new Error("must not run"));
    const policy = new PermissionPolicy(mode, async () => "deny", reviewer);
    await expect(policy.authorize(readTool, readCall)).resolves.toMatchObject({ allowed: true });
    expect(reviewer.contexts).toHaveLength(0);
  });

  it("prompts for manual ordinary modifications without using the reviewer", async () => {
    const reviewer = new RecordingReviewer(new Error("must not run"));
    let prompts = 0;
    const policy = new PermissionPolicy(
      "manual",
      async () => {
        prompts++;
        return "allow_once";
      },
      reviewer,
    );
    await expect(
      policy.authorize(writeTool, writeCall, undefined, undefined, reviewContext),
    ).resolves.toMatchObject({ allowed: true, risk: "modify" });
    expect(prompts).toBe(1);
    expect(reviewer.contexts).toHaveLength(0);
  });

  it("allows one smart modification with complete reviewer context", async () => {
    const reviewer = new RecordingReviewer(allowedReview);
    let prompts = 0;
    const policy = new PermissionPolicy(
      "smart",
      async () => {
        prompts++;
        return "deny";
      },
      reviewer,
    );
    await expect(
      policy.authorize(writeTool, writeCall, undefined, undefined, reviewContext),
    ).resolves.toMatchObject({ allowed: true });
    expect(prompts).toBe(0);
    expect(reviewer.contexts[0]).toMatchObject({
      task: "write a.txt",
      workspace: "/work",
      pathScope: "inside",
      tool: { name: "write" },
      call: { callId: "w" },
    });
  });

  it("escalates missing context, human_review, and reviewer failures to people", async () => {
    for (const setup of [
      { reviewer: new RecordingReviewer(allowedReview), context: undefined },
      {
        reviewer: new RecordingReviewer({
          decision: "human_review",
          reason: "uncertain",
          usage: { inputTokens: 1, outputTokens: 1 },
        }),
        context: reviewContext,
      },
      {
        reviewer: new RecordingReviewer(new ApprovalReviewError("unavailable")),
        context: reviewContext,
      },
    ]) {
      let prompts = 0;
      const policy = new PermissionPolicy(
        "smart",
        async () => {
          prompts++;
          return "allow_once";
        },
        setup.reviewer,
      );
      await expect(
        policy.authorize(writeTool, writeCall, undefined, undefined, setup.context),
      ).resolves.toMatchObject({ allowed: true });
      expect(prompts).toBe(1);
      expect(setup.reviewer.contexts).toHaveLength(setup.context ? 1 : 0);
    }
  });

  it("denies reviewer escalation when no human prompt exists", async () => {
    const reviewer = new RecordingReviewer({
      decision: "human_review",
      reason: "uncertain",
      usage: { inputTokens: 1, outputTokens: 1 },
    });
    const policy = new PermissionPolicy("smart", undefined, reviewer);
    await expect(
      policy.authorize(writeTool, writeCall, undefined, undefined, reviewContext),
    ).resolves.toMatchObject({ allowed: false });
  });

  it("auto mode bypasses reviewer and prompts for modify and dangerous calls", async () => {
    const reviewer = new RecordingReviewer(new Error("must not run"));
    let prompts = 0;
    const policy = new PermissionPolicy(
      "auto",
      async () => {
        prompts++;
        return "deny";
      },
      reviewer,
    );
    await expect(
      policy.authorize(writeTool, writeCall, undefined, undefined, reviewContext),
    ).resolves.toMatchObject({ allowed: true });
    await expect(
      policy.authorize(bashTool, {
        callId: "danger",
        name: "bash",
        input: { command: "rm -rf build" },
      }),
    ).resolves.toMatchObject({ allowed: true, risk: "dangerous" });
    expect(prompts).toBe(0);
    expect(reviewer.contexts).toHaveLength(0);
  });

  it("smart dangerous and outside-workspace calls go directly to people", async () => {
    const reviewer = new RecordingReviewer(allowedReview);
    const prompted: string[] = [];
    const policy = new PermissionPolicy(
      "smart",
      async (tool, _call, risk) => {
        prompted.push(`${tool.name}:${risk}`);
        return "allow_once";
      },
      reviewer,
    );
    await policy.authorize(
      bashTool,
      { callId: "danger", name: "bash", input: { command: "rm -rf build" } },
      undefined,
      undefined,
      reviewContext,
    );
    await policy.authorize(writeTool, writeCall, undefined, undefined, {
      ...reviewContext,
      pathScope: "outside",
    });
    expect(prompted).toEqual(["bash:dangerous", "write:modify"]);
    expect(reviewer.contexts).toHaveLength(0);
  });

  it("reviews every LLM-approved call independently", async () => {
    const reviewer = new RecordingReviewer(allowedReview);
    const policy = new PermissionPolicy("smart", async () => "deny", reviewer);
    await policy.authorize(writeTool, writeCall, undefined, undefined, reviewContext);
    await policy.authorize(
      writeTool,
      { ...writeCall, callId: "w-2" },
      undefined,
      undefined,
      reviewContext,
    );
    expect(reviewer.contexts).toHaveLength(2);
  });

  it("human session approval bypasses later ordinary review but not dynamic danger", async () => {
    const reviewer = new RecordingReviewer({
      decision: "human_review",
      reason: "ask",
      usage: { inputTokens: 1, outputTokens: 1 },
    });
    let prompts = 0;
    const policy = new PermissionPolicy(
      "smart",
      async () => {
        prompts++;
        return "allow_session";
      },
      reviewer,
    );
    await policy.authorize(writeTool, writeCall, undefined, undefined, reviewContext);
    await policy.authorize(
      writeTool,
      { ...writeCall, callId: "w-2" },
      undefined,
      undefined,
      reviewContext,
    );
    expect(reviewer.contexts).toHaveLength(1);
    expect(prompts).toBe(1);

    await policy.authorize(
      bashTool,
      { callId: "safe", name: "bash", input: { command: "git status" } },
      undefined,
      undefined,
      reviewContext,
    );
    await policy.authorize(
      bashTool,
      { callId: "danger", name: "bash", input: { command: "git restore src" } },
      undefined,
      undefined,
      reviewContext,
    );
    expect(prompts).toBe(3);
  });

  it("propagates caller aborts instead of opening a prompt", async () => {
    const controller = new AbortController();
    const reason = new Error("cancelled");
    let prompts = 0;
    const reviewer: ApprovalReviewer = {
      async review() {
        controller.abort(reason);
        throw reason;
      },
    };
    const policy = new PermissionPolicy(
      "smart",
      async () => {
        prompts++;
        return "allow_once";
      },
      reviewer,
    );
    await expect(
      policy.authorize(writeTool, writeCall, controller.signal, undefined, reviewContext),
    ).rejects.toBe(reason);
    expect(prompts).toBe(0);
  });

  it.each(["manual", "smart", "auto"] as PermissionMode[])(
    "reports isAuto accurately for %s",
    (mode) => {
      expect(new PermissionPolicy(mode).isAuto).toBe(mode === "auto");
    },
  );
});
