import type { EventBus } from "../core/events.js";
import { sanitizeTerminalText } from "../observability/terminal-text.js";
import {
  type CommandHookRunner,
  type CommandHookRunResult,
  runCommandHook,
} from "./command-runner.js";
import type {
  ConfiguredCommandHook,
  HookAggregateResult,
  HookEventName,
  HookInput,
  HookInvocationContext,
  HookPayloadMap,
  HookPermissionDecision,
} from "./types.js";

export type HookDiagnosticSink = (message: string) => void;
const CONTROLLABLE = new Set<HookEventName>([
  "UserPromptSubmit",
  "PreToolUse",
  "PermissionRequest",
  "Stop",
]);
const RANK: Record<HookPermissionDecision, number> = { allow: 1, ask: 2, deny: 3 };
type Outcome = {
  hook: ConfiguredCommandHook;
  decision?: HookPermissionDecision;
  reason?: string;
  blocked?: boolean;
  updated?: unknown;
  hasUpdated?: boolean;
  context?: string;
  system?: string;
};
function clean(value: string, max = 500): string {
  return [...sanitizeTerminalText(value).replace(/\s+/g, " ").trim()].slice(0, max).join("");
}
function target<K extends HookEventName>(event: K, payload: HookPayloadMap[K]): string | undefined {
  if (["PreToolUse", "PermissionRequest", "PostToolUse", "PostToolUseFailure"].includes(event))
    return (payload as { toolName: string }).toolName;
  if (event === "Notification") return (payload as HookPayloadMap["Notification"]).notificationType;
  if (event === "SessionStart") return (payload as HookPayloadMap["SessionStart"]).source;
  return undefined;
}
export class HookEngine {
  constructor(
    private readonly hooks: ConfiguredCommandHook[],
    private readonly events: EventBus,
    private readonly runner: CommandHookRunner = runCommandHook,
    private readonly diagnostics: HookDiagnosticSink = () => {},
  ) {}
  async run<K extends HookEventName>(
    event: K,
    payload: HookPayloadMap[K],
    context: HookInvocationContext,
  ): Promise<HookAggregateResult> {
    const matchTarget = target(event, payload);
    const matching = this.hooks.filter(
      (hook) =>
        hook.event === event &&
        (!hook.matcher || (matchTarget !== undefined && hook.matcher.test(matchTarget))),
    );
    const input = {
      schemaVersion: 1,
      hookEventName: event,
      sessionId: context.sessionId,
      ...(context.turnId ? { turnId: context.turnId } : {}),
      cwd: context.cwd,
      permissionMode: context.permissionMode,
      ...payload,
    } as HookInput<K>;
    const outcomes = await Promise.all(
      matching.map(async (hook): Promise<Outcome> => {
        await this.events.emit(
          "hook.started",
          { event, scope: hook.scope, order: hook.order },
          context.turnId,
        );
        let result: CommandHookRunResult;
        try {
          result = await this.runner(hook, input, context);
        } catch (error) {
          if (context.signal?.aborted) throw context.signal.reason ?? error;
          await this.events.emit(
            "hook.failed",
            { event, scope: hook.scope, order: hook.order, internal: true },
            context.turnId,
          );
          return { hook };
        }
        if (context.signal?.aborted) throw context.signal.reason;
        const meta = {
          event,
          scope: hook.scope,
          order: hook.order,
          durationMs: result.durationMs,
          exitCode: result.exitCode,
          timedOut: result.timedOut,
        };
        if (result.exitCode === 2 && CONTROLLABLE.has(event)) {
          const reason = clean(result.stderr || "blocked by hook");
          await this.events.emit("hook.blocked", { ...meta, hasDecision: true }, context.turnId);
          return {
            hook,
            blocked: true,
            reason,
            ...(event === "PermissionRequest" || event === "PreToolUse"
              ? { decision: "deny" }
              : {}),
          };
        }
        if (
          result.exitCode !== 0 ||
          result.timedOut ||
          result.outputExceeded ||
          result.inputExceeded
        ) {
          await this.events.emit("hook.failed", meta, context.turnId);
          if (result.stderr.trim()) this.diagnostics(clean(result.stderr, 2000));
          return { hook };
        }
        if (!result.stdout.trim()) {
          await this.events.emit("hook.completed", meta, context.turnId);
          return { hook };
        }
        try {
          const raw: unknown = JSON.parse(result.stdout);
          if (!raw || typeof raw !== "object" || Array.isArray(raw))
            throw new Error("output must be object");
          const value = raw as Record<string, unknown>;
          const allowedTop =
            event === "Stop"
              ? ["systemMessage", "decision", "reason"]
              : ["systemMessage", "hookSpecificOutput"];
          if (Object.keys(value).some((key) => !allowedTop.includes(key)))
            throw new Error("unsupported output field");
          const outcome: Outcome = { hook };
          if (Object.hasOwn(value, "systemMessage")) {
            if (typeof value.systemMessage !== "string")
              throw new Error("systemMessage must be a string");
            outcome.system = [...sanitizeTerminalText(value.systemMessage)].slice(0, 2000).join("");
          }
          if (event === "Stop") {
            if (value.decision !== undefined && value.decision !== "block")
              throw new Error("invalid Stop decision");
            if (value.reason !== undefined && typeof value.reason !== "string")
              throw new Error("Stop reason must be a string");
            if (value.decision === "block") {
              outcome.blocked = true;
              outcome.reason = clean(
                typeof value.reason === "string" ? value.reason : "blocked by hook",
              );
            }
          } else if (value.hookSpecificOutput !== undefined) {
            if (["PostToolUse", "PostToolUseFailure", "Notification", "SessionEnd"].includes(event))
              throw new Error("event does not support hookSpecificOutput");
            if (
              !value.hookSpecificOutput ||
              typeof value.hookSpecificOutput !== "object" ||
              Array.isArray(value.hookSpecificOutput)
            )
              throw new Error("hookSpecificOutput must be an object");
            const specific = value.hookSpecificOutput as Record<string, unknown>;
            if (specific.hookEventName !== event) throw new Error("wrong hookEventName");
            const specificAllowed =
              event === "PreToolUse"
                ? [
                    "hookEventName",
                    "permissionDecision",
                    "permissionDecisionReason",
                    "updatedInput",
                    "additionalContext",
                  ]
                : event === "PermissionRequest"
                  ? ["hookEventName", "decision"]
                  : event === "SessionStart" || event === "UserPromptSubmit"
                    ? ["hookEventName", "additionalContext"]
                    : ["hookEventName"];
            if (Object.keys(specific).some((key) => !specificAllowed.includes(key)))
              throw new Error("unsupported hook-specific field");
            if (["SessionStart", "UserPromptSubmit", "PreToolUse"].includes(event)) {
              if (
                Object.hasOwn(specific, "additionalContext") &&
                typeof specific.additionalContext !== "string"
              )
                throw new Error("additionalContext must be a string");
              if (typeof specific.additionalContext === "string")
                outcome.context = specific.additionalContext;
            }
            if (event === "PreToolUse") {
              if (
                specific.permissionDecision !== undefined &&
                !["allow", "ask", "deny"].includes(String(specific.permissionDecision))
              )
                throw new Error("invalid permissionDecision");
              if (specific.permissionDecision !== undefined)
                outcome.decision = specific.permissionDecision as HookPermissionDecision;
              if (
                Object.hasOwn(specific, "permissionDecisionReason") &&
                typeof specific.permissionDecisionReason !== "string"
              )
                throw new Error("permissionDecisionReason must be a string");
              if (typeof specific.permissionDecisionReason === "string")
                outcome.reason = clean(specific.permissionDecisionReason);
              if (Object.hasOwn(specific, "updatedInput")) {
                outcome.updated = specific.updatedInput;
                outcome.hasUpdated = true;
              }
            } else if (event === "PermissionRequest" && specific.decision !== undefined) {
              if (
                !specific.decision ||
                typeof specific.decision !== "object" ||
                Array.isArray(specific.decision)
              )
                throw new Error("decision must be an object");
              const permission = specific.decision as Record<string, unknown>;
              if (Object.keys(permission).some((key) => !["behavior", "message"].includes(key)))
                throw new Error("unsupported decision field");
              if (!["allow", "ask", "deny"].includes(String(permission.behavior)))
                throw new Error("invalid decision");
              if (permission.message !== undefined && typeof permission.message !== "string")
                throw new Error("decision message must be a string");
              outcome.decision = permission.behavior as HookPermissionDecision;
              if (typeof permission.message === "string")
                outcome.reason = clean(permission.message);
            }
          }
          await this.events.emit(
            outcome.blocked ? "hook.blocked" : "hook.completed",
            {
              ...meta,
              hasDecision: Boolean(outcome.decision || outcome.blocked),
              hasContext: Boolean(outcome.context),
              hasUpdatedInput: Boolean(outcome.hasUpdated),
            },
            context.turnId,
          );
          return outcome;
        } catch {
          await this.events.emit("hook.failed", meta, context.turnId);
          if (result.stderr.trim()) this.diagnostics(clean(result.stderr, 2000));
          return { hook };
        }
      }),
    );
    outcomes.sort((a, b) => a.hook.order - b.hook.order);
    let decision: HookPermissionDecision | undefined;
    let reason: string | undefined;
    for (const outcome of outcomes)
      if (outcome.decision && (!decision || RANK[outcome.decision] > RANK[decision])) {
        decision = outcome.decision;
        reason = outcome.reason;
      }
    const updates = outcomes.filter((item) => item.hasUpdated);
    const conflict = updates.length > 1;
    if (conflict)
      await this.events.emit(
        "hook.input_conflict",
        { event, updates: updates.length },
        context.turnId,
      );
    const contexts: string[] = [];
    let bytes = 0;
    for (const item of outcomes)
      if (item.context) {
        const remaining = 10 * 1024 - bytes;
        if (remaining > 0) {
          const text = Buffer.from(item.context).subarray(0, remaining).toString("utf8");
          contexts.push(text);
          bytes += Buffer.byteLength(text);
        }
      }
    const systems = outcomes.flatMap((item) => (item.system ? [item.system] : []));
    for (const message of systems) this.diagnostics(message);
    const blocked = outcomes.some((item) => item.blocked) || decision === "deny";
    const blockReason = outcomes.find((item) => item.blocked)?.reason;
    return {
      blocked,
      ...(blockReason ? { blockReason } : {}),
      ...(decision ? { permissionDecision: decision } : {}),
      ...(reason ? { permissionReason: reason } : {}),
      hasUpdatedInput: updates.length === 1,
      ...(updates.length === 1 ? { updatedInput: updates[0]?.updated } : {}),
      inputConflict: conflict,
      additionalContext: contexts,
      systemMessages: systems,
    };
  }
}
