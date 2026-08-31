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

export type TranscriptBlock =
  | { id: string; kind: "user"; text: string }
  | { id: string; kind: "assistant"; markdown: string }
  | { id: string; kind: "tool"; text: string; failed: boolean }
  | { id: string; kind: "info" | "error"; text: string }
  | { id: string; kind: "activity"; phase: TuiPhase; text: string };

export type TuiDialog =
  | {
      id: number;
      kind: "permission";
      title: string;
      lines: readonly string[];
      risk: ToolRisk;
      allowSession: boolean;
    }
  | { id: number; kind: "confirm"; message: string };

export interface TuiSnapshot {
  blocks: readonly TranscriptBlock[];
  phase: TuiPhase;
  metadata?: AgentApplicationMetadata;
  contextPercent?: number;
  turnUsage?: { inputTokens: number; outputTokens: number; durationMs: number };
  dialog?: TuiDialog;
  running: boolean;
  followOutput: boolean;
  fatalError?: string;
}
