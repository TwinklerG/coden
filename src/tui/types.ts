import type { AgentApplicationMetadata } from "../cli/agent-application.js";
import type { ToolRisk } from "../core/types.js";

export type TuiPhase =
  | "starting"
  | "idle"
  | "submitting"
  | "thinking"
  | "rendering"
  | "tool"
  | "reviewing"
  | "failed";

export type TuiInteractionAnswer = "y" | "s" | "n";
export type TuiInteractionStatus = "pending" | "resolved" | "cancelled";

export type TranscriptInteractionBlock =
  | {
      id: string;
      kind: "interaction";
      interaction: "permission";
      toolName: string;
      risk: ToolRisk;
      lines: readonly string[];
      allowSession: boolean;
      status: TuiInteractionStatus;
      answer?: TuiInteractionAnswer;
    }
  | {
      id: string;
      kind: "interaction";
      interaction: "confirm";
      message: string;
      status: TuiInteractionStatus;
      answer?: "y" | "n";
    };

export type TranscriptBlock =
  | { id: string; kind: "user"; text: string }
  | { id: string; kind: "assistant"; markdown: string }
  | { id: string; kind: "tool"; text: string; failed: boolean }
  | { id: string; kind: "info" | "error"; text: string }
  | { id: string; kind: "activity"; phase: TuiPhase; text: string }
  | TranscriptInteractionBlock;

export type TuiPendingInteraction =
  | { id: string; kind: "permission"; allowSession: boolean }
  | { id: string; kind: "confirm"; allowSession: false };

export interface TuiSnapshot {
  blocks: readonly TranscriptBlock[];
  phase: TuiPhase;
  metadata?: AgentApplicationMetadata;
  contextPercent?: number;
  turnUsage?: { inputTokens: number; outputTokens: number; durationMs: number };
  pendingInteraction?: TuiPendingInteraction;
  running: boolean;
  followOutput: boolean;
  fatalError?: string;
}
