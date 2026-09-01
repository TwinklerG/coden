import { truncateOutput } from "../context/truncate.js";
import type { EventBus } from "../core/events.js";
import type { ToolCall, ToolResult } from "../core/types.js";
import type { HookEngine } from "../hooks/engine.js";
import type { HookInvocationContext } from "../hooks/types.js";
import { formatToolInput } from "../observability/tool-input.js";
import type { PermissionPolicy, PermissionReviewContext } from "../permissions/policy.js";
import { type ResolvedFilePath, resolveStructuredFilePath } from "../permissions/workspace.js";
import type { ToolRegistry } from "./registry.js";

const STRUCTURED_FILE_TOOLS = new Set(["read", "write", "edit"]);
export interface ToolExecutionOutcome extends ToolResult {
  result: ToolResult;
  effectiveCall: ToolCall;
  inputChanged: boolean;
  additionalContext: string[];
}
export class ToolExecutor {
  constructor(
    private registry: ToolRegistry,
    private readonly permissions: PermissionPolicy,
    private readonly events: EventBus,
    private readonly workspace: string,
    private readonly timeoutMs = 60_000,
    private readonly allowOutsideWorkspace = false,
    private readonly hooks?: HookEngine,
    private readonly hookContext?: Omit<HookInvocationContext, "turnId" | "signal">,
  ) {}
  setRegistry(registry: ToolRegistry): void {
    this.registry = registry;
  }
  async execute(
    call: ToolCall,
    signal: AbortSignal,
    turnId?: string,
    userTask = "",
  ): Promise<ToolExecutionOutcome> {
    const started = Date.now();
    let effectiveCall = call;
    let inputChanged = false;
    let additionalContext: string[] = [];
    const context = this.hookContext
      ? { ...this.hookContext, ...(turnId ? { turnId } : {}), signal }
      : undefined;
    const outcome = (result: ToolResult): ToolExecutionOutcome => ({
      ...result,
      result,
      effectiveCall,
      inputChanged,
      additionalContext,
    });
    const postFailure = async (
      result: ToolResult,
      errorType: string,
    ): Promise<ToolExecutionOutcome> => {
      await this.events.emit(
        "tool.completed",
        {
          name: effectiveCall.name,
          callId: effectiveCall.callId,
          isError: true,
          durationMs: Date.now() - started,
        },
        turnId,
      );
      if (this.hooks && context && !signal.aborted)
        await this.hooks.run(
          "PostToolUseFailure",
          {
            toolName: effectiveCall.name,
            callId: effectiveCall.callId,
            input: effectiveCall.input,
            errorType,
            error: result.content,
            durationMs: Date.now() - started,
          },
          context,
        );
      return outcome(result);
    };
    await this.events.emit("tool.requested", { name: call.name, callId: call.callId }, turnId);
    const tool = this.registry.get(call.name);
    if (!tool)
      return postFailure(
        { content: `tool.not_found: ${call.name}`, isError: true },
        "tool.not_found",
      );
    const validation = this.registry.validate(call.name, call.input);
    if (!validation.valid)
      return postFailure(
        { content: `tool.invalid_input: ${validation.errors}`, isError: true },
        "tool.invalid_input",
      );
    const initialRisk = this.permissions.classifyRisk(tool, call);
    let preDecision: "allow" | "ask" | "deny" | undefined;
    if (this.hooks && context) {
      const pre = await this.hooks.run(
        "PreToolUse",
        { toolName: call.name, callId: call.callId, input: call.input, risk: initialRisk },
        context,
      );
      additionalContext = pre.additionalContext;
      preDecision = pre.permissionDecision;
      if (pre.blocked || preDecision === "deny")
        return postFailure(
          {
            content: `permission.hook_denied: ${pre.blockReason ?? pre.permissionReason ?? call.name}`,
            isError: true,
          },
          "permission.hook_denied",
        );
      if (pre.hasUpdatedInput) {
        effectiveCall = { ...call, input: pre.updatedInput };
        inputChanged = true;
      }
    }
    const finalValidation = this.registry.validate(effectiveCall.name, effectiveCall.input);
    if (!finalValidation.valid)
      return postFailure(
        { content: `hook.invalid_updated_input: ${finalValidation.errors}`, isError: true },
        "hook.invalid_updated_input",
      );
    let filePath: ResolvedFilePath | undefined;
    if (STRUCTURED_FILE_TOOLS.has(effectiveCall.name)) {
      try {
        filePath = await resolveStructuredFilePath(
          this.workspace,
          (effectiveCall.input as { path: string }).path,
        );
      } catch (error) {
        return postFailure(
          {
            content: `permission.workspace_denied: ${error instanceof Error ? error.message : String(error)}`,
            isError: true,
          },
          "permission.workspace_denied",
        );
      }
    }
    const riskOverride = filePath?.scope === "outside" ? "modify" : undefined;
    let finalRisk = this.permissions.classifyRisk(tool, effectiveCall, riskOverride);
    if (filePath?.scope === "outside" && !this.allowOutsideWorkspace && this.permissions.isAuto) {
      await this.events.emit(
        "permission.requested",
        { name: effectiveCall.name, callId: effectiveCall.callId, risk: finalRisk, allowed: false },
        turnId,
      );
      return postFailure(
        {
          content:
            "permission.outside_workspace_denied: rerun with --auto --allow-outside-workspace",
          isError: true,
        },
        "permission.outside_workspace_denied",
      );
    }
    const reviewContext: PermissionReviewContext = {
      task: userTask,
      workspace: this.workspace,
      pathScope: filePath?.scope ?? "not_applicable",
      ...(turnId ? { turnId } : {}),
    };
    let allowed = preDecision === "allow";
    let needsHuman = preDecision === "ask";
    if (!allowed && !needsHuman) {
      const assessment = await this.permissions.assess(
        tool,
        effectiveCall,
        riskOverride,
        reviewContext,
        signal,
      );
      finalRisk = assessment.risk;
      allowed = assessment.outcome === "allow";
      needsHuman = assessment.outcome === "prompt";
    }
    if (needsHuman) {
      if (this.permissions.isAuto) {
        await this.events.emit(
          "permission.requested",
          {
            name: effectiveCall.name,
            callId: effectiveCall.callId,
            risk: finalRisk,
            allowed: false,
          },
          turnId,
        );
        return postFailure(
          { content: "permission.hook_requires_interaction", isError: true },
          "permission.hook_requires_interaction",
        );
      }
      let hookDecision: "allow" | "ask" | "deny" | undefined;
      if (this.hooks && context) {
        const permission = await this.hooks.run(
          "PermissionRequest",
          {
            toolName: effectiveCall.name,
            callId: effectiveCall.callId,
            input: effectiveCall.input,
            risk: finalRisk,
            reason: preDecision === "ask" ? "hook" : "policy",
          },
          context,
        );
        hookDecision = permission.permissionDecision;
      }
      if (hookDecision === "deny") allowed = false;
      else if (hookDecision === "allow") allowed = true;
      else {
        if (this.hooks && context)
          await this.hooks.run(
            "Notification",
            {
              notificationType: "permission_prompt",
              title: "CodeN",
              message: `${effectiveCall.name} requires permission`,
            },
            context,
          );
        allowed = await this.permissions.requestHuman(tool, effectiveCall, finalRisk, signal);
      }
    }
    await this.events.emit(
      "permission.requested",
      { name: effectiveCall.name, callId: effectiveCall.callId, risk: finalRisk, allowed },
      turnId,
    );
    if (!allowed)
      return postFailure(
        { content: `permission.denied: ${effectiveCall.name} was not authorized`, isError: true },
        "permission.denied",
      );
    const display = formatToolInput({
      name: tool.name,
      risk: finalRisk,
      inputSchema: tool.inputSchema,
      input: effectiveCall.input,
    });
    await this.events.emit(
      "tool.started",
      {
        name: effectiveCall.name,
        callId: effectiveCall.callId,
        summary: display.summary,
        input: effectiveCall.input,
        risk: finalRisk,
      },
      turnId,
    );
    const controller = new AbortController();
    const relay = () => controller.abort(signal.reason);
    if (signal.aborted) relay();
    else signal.addEventListener("abort", relay, { once: true });
    const timer = setTimeout(
      () => controller.abort(new Error(`Tool timed out after ${this.timeoutMs}ms`)),
      this.timeoutMs,
    );
    let result: ToolResult;
    try {
      const aborted = controller.signal.aborted
        ? Promise.reject(controller.signal.reason)
        : new Promise<never>((_, reject) =>
            controller.signal.addEventListener("abort", () => reject(controller.signal.reason), {
              once: true,
            }),
          );
      result = await Promise.race([
        tool.execute(effectiveCall.input, {
          workspace: this.workspace,
          signal: controller.signal,
          ...(filePath ? { structuredFilePath: filePath } : {}),
        }),
        aborted,
      ]);
      result = { ...result, content: truncateOutput(result.content, 50_000) };
    } catch (error) {
      if (signal.aborted) {
        await this.events.emit(
          "tool.completed",
          {
            name: effectiveCall.name,
            callId: effectiveCall.callId,
            isError: true,
            cancelled: true,
            durationMs: Date.now() - started,
          },
          turnId,
        );
        throw error;
      }
      const timedOut = controller.signal.aborted;
      result = {
        content: `${timedOut ? "tool.timeout (abort requested; tools must cooperate)" : "tool.internal_error"}: ${error instanceof Error ? error.message : String(error)}`,
        isError: true,
      };
    } finally {
      clearTimeout(timer);
      signal.removeEventListener("abort", relay);
    }
    if (result.isError)
      return postFailure(result, result.content.split(":", 1)[0] ?? "tool.failure");
    await this.events.emit(
      "tool.completed",
      {
        name: effectiveCall.name,
        callId: effectiveCall.callId,
        isError: false,
        durationMs: Date.now() - started,
      },
      turnId,
    );
    if (this.hooks && context)
      await this.hooks.run(
        "PostToolUse",
        {
          toolName: effectiveCall.name,
          callId: effectiveCall.callId,
          input: effectiveCall.input,
          result,
          durationMs: Date.now() - started,
        },
        context,
      );
    return outcome(result);
  }
}
