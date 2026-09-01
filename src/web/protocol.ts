import type { AgentApplicationMetadata } from "../cli/agent-application.js";

export const WEB_PROTOCOL_VERSION = 1;
export const MAX_PROMPT_CHARS = 100_000;

export type WebPhase =
  | "starting"
  | "idle"
  | "thinking"
  | "rendering"
  | "tool"
  | "reviewing"
  | "failed";

export type WebToolRisk = "read" | "modify" | "dangerous";
export type WebInteractionDecision = "allow_once" | "allow_session" | "deny" | "confirm" | "reject";

export type WebBlock =
  | { id: string; kind: "user"; text: string }
  | { id: string; kind: "assistant"; markdown: string }
  | {
      id: string;
      kind: "tool";
      callId: string;
      name: string;
      status: "preparing" | "running" | "succeeded" | "failed" | "cancelled";
      input?: unknown;
      risk?: WebToolRisk;
      output?: string;
      durationMs?: number;
      summary?: string;
    }
  | {
      id: string;
      kind: "interaction";
      interaction: "permission" | "confirm";
      status: "pending" | "resolved" | "cancelled";
      message?: string;
      toolName?: string;
      risk?: WebToolRisk;
      input?: unknown;
      allowSession: boolean;
      decision?: WebInteractionDecision;
    }
  | { id: string; kind: "info" | "error"; text: string };

export interface WebSessionSummary {
  id: string;
  title?: string;
  messageCount: number;
  lastActivity: string;
}

export interface WebSnapshot {
  revision: number;
  phase: WebPhase;
  running: boolean;
  language: "zh" | "en";
  remote: boolean;
  metadata?: AgentApplicationMetadata;
  sessionId?: string;
  sessions: WebSessionSummary[];
  blocks: WebBlock[];
  pendingInteractionId?: string;
  control: { ownerClientId?: string };
  contextPercent?: number;
  turnUsage?: { inputTokens: number; outputTokens: number; durationMs: number };
  startupWarnings: string[];
  fatalError?: { code: string; message: string };
}

export type WebMergeValue = Partial<
  Pick<
    WebSnapshot,
    | "phase"
    | "running"
    | "remote"
    | "metadata"
    | "sessionId"
    | "sessions"
    | "pendingInteractionId"
    | "control"
    | "contextPercent"
    | "turnUsage"
    | "startupWarnings"
    | "fatalError"
  >
>;

export type WebPatch =
  | { op: "append_blocks"; blocks: WebBlock[] }
  | { op: "update_block"; id: string; block: WebBlock }
  | { op: "replace_blocks"; blocks: WebBlock[] }
  | {
      op: "merge";
      value: WebMergeValue;
      clear?: Array<
        | "metadata"
        | "sessionId"
        | "pendingInteractionId"
        | "contextPercent"
        | "turnUsage"
        | "fatalError"
      >;
    };

export interface WebViewer {
  clientId: string;
  isOwner: boolean;
}

export interface WebStateResponse {
  protocolVersion: number;
  snapshot: WebSnapshot;
  viewer: WebViewer;
}

export type WebStreamEnvelope =
  | { type: "snapshot"; revision: number; data: WebStateResponse }
  | { type: "patch"; revision: number; data: WebPatch };

export interface WebApiError {
  error: { code: string; message: string; retryable: boolean };
}

export type WebActionKind = "turn" | "interaction" | "resume" | "empty";
export type WebActionBody =
  | { text: string }
  | { decision: WebInteractionDecision }
  | { sessionId: string }
  | Record<string, never>;

const DECISIONS = new Set<WebInteractionDecision>([
  "allow_once",
  "allow_session",
  "deny",
  "confirm",
  "reject",
]);
const SESSION_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export function parseWebActionBody(kind: WebActionKind, value: unknown): WebActionBody {
  const body = exactObject(value);
  if (kind === "empty") {
    exactKeys(body, []);
    return {};
  }
  if (kind === "turn") {
    exactKeys(body, ["text"]);
    if (typeof body.text !== "string" || !body.text.trim())
      throw new Error("text must be a non-empty string");
    if (body.text.length > MAX_PROMPT_CHARS)
      throw new Error(`text must contain at most ${MAX_PROMPT_CHARS} characters`);
    return { text: body.text };
  }
  if (kind === "interaction") {
    exactKeys(body, ["decision"]);
    if (
      typeof body.decision !== "string" ||
      !DECISIONS.has(body.decision as WebInteractionDecision)
    )
      throw new Error("decision is invalid");
    return { decision: body.decision as WebInteractionDecision };
  }
  exactKeys(body, ["sessionId"]);
  if (typeof body.sessionId !== "string" || !SESSION_ID_RE.test(body.sessionId))
    throw new Error("sessionId is invalid");
  return { sessionId: body.sessionId };
}

function exactObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("body must be a JSON object");
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, keys: string[]): void {
  const expected = new Set(keys);
  const unknown = Object.keys(value).filter((key) => !expected.has(key));
  const missing = keys.filter((key) => !(key in value));
  if (unknown.length) throw new Error(`unknown field: ${unknown.join(", ")}`);
  if (missing.length) throw new Error(`missing field: ${missing.join(", ")}`);
}
