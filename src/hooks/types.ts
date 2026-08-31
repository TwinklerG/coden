import type { ToolResult, ToolRisk } from "../core/types.js";

export const HOOK_EVENT_NAMES = [
  "SessionStart",
  "UserPromptSubmit",
  "PreToolUse",
  "PermissionRequest",
  "PostToolUse",
  "PostToolUseFailure",
  "Notification",
  "Stop",
  "SessionEnd",
] as const;
export type HookEventName = (typeof HOOK_EVENT_NAMES)[number];
export type HookScope = "user" | "project";
export type HookPermissionMode = "manual" | "smart" | "auto";
export type HookPermissionDecision = "allow" | "ask" | "deny";
export type SessionEndReason = "completed" | "failed" | "cancelled" | "eof" | "quit";

export interface ConfiguredCommandHook {
  event: HookEventName;
  scope: HookScope;
  order: number;
  matcherSource: string;
  matcher?: RegExp;
  command: string;
  timeoutMs: number;
}
export interface HookInvocationContext {
  cwd: string;
  sessionId: string;
  permissionMode: HookPermissionMode;
  turnId?: string;
  signal?: AbortSignal;
}
export interface HookPayloadMap {
  SessionStart: { source: "startup" | "resume" };
  UserPromptSubmit: { prompt: string };
  PreToolUse: { toolName: string; callId: string; input: unknown; risk: ToolRisk };
  PermissionRequest: {
    toolName: string;
    callId: string;
    input: unknown;
    risk: ToolRisk;
    reason: "policy" | "hook";
  };
  PostToolUse: {
    toolName: string;
    callId: string;
    input: unknown;
    result: ToolResult;
    durationMs: number;
  };
  PostToolUseFailure: {
    toolName: string;
    callId: string;
    input: unknown;
    errorType: string;
    error: string;
    durationMs: number;
  };
  Notification: {
    notificationType: "permission_prompt" | "attention_required";
    title: string;
    message: string;
  };
  Stop: { answer: string; toolsExecuted: number; stopHookActive: boolean };
  SessionEnd: { reason: SessionEndReason };
}
export type HookInput<K extends HookEventName = HookEventName> = {
  schemaVersion: 1;
  hookEventName: K;
  sessionId: string;
  turnId?: string;
  cwd: string;
  permissionMode: HookPermissionMode;
} & HookPayloadMap[K];
export interface HookAggregateResult {
  blocked: boolean;
  blockReason?: string;
  permissionDecision?: HookPermissionDecision;
  permissionReason?: string;
  hasUpdatedInput: boolean;
  updatedInput?: unknown;
  inputConflict: boolean;
  additionalContext: string[];
  systemMessages: string[];
}
