import type { ToolCall, ToolDefinition, ToolRisk } from "../core/types.js";
import type { ApprovalReviewContext, ApprovalReviewer } from "./reviewer.js";

export type PermissionDecision = "allow_once" | "allow_session" | "deny";
export type PermissionMode = "manual" | "smart" | "auto";
export type PermissionReviewContext = Pick<
  ApprovalReviewContext,
  "task" | "workspace" | "pathScope" | "turnId"
>;
export type PermissionPrompt = (
  tool: ToolDefinition,
  call: ToolCall,
  risk: ToolRisk,
  signal?: AbortSignal,
) => Promise<PermissionDecision>;
const DANGEROUS = [
  /\brm\s+(?:-[^\s]*r[^\s]*\s+|--recursive\b)/i,
  /\bsudo\b/i,
  /\bgit\b[^;&|\n]*\breset\s+--hard\b/i,
  /\bgit\b[^;&|\n]*\bclean\s+(?:-[^\s]*f[^\s]*|--force)\b/i,
  /\bgit\b[^;&|\n]*\bpush\b[^;&|\n]*(?:--force(?:-with-lease)?|-f)\b/i,
  /\bgit\b[^;&|\n]*\bcheckout\s+--\s/i,
  /\bgit\b[^;&|\n]*\brestore\b/i,
  /\b(?:mkfs|fdisk|dd)\b/i,
  /\b(?:killall|pkill)\b/i,
  /(?:curl|wget)[^|;&]*(?:\||&&)\s*(?:sh|bash)\b/i,
  /(?:^|\s)(?:\/etc|\/usr|\/bin|\/sbin)\//,
];
export function classifyBashRisk(command: string): ToolRisk {
  return DANGEROUS.some((pattern) => pattern.test(command)) ? "dangerous" : "modify";
}
export class PermissionPolicy {
  readonly #sessionAllowed = new Set<string>();
  constructor(
    private readonly mode: PermissionMode,
    private readonly prompt?: PermissionPrompt,
    private readonly reviewer?: ApprovalReviewer,
  ) {}
  get isAuto(): boolean {
    return this.mode === "auto";
  }
  async authorize(
    tool: ToolDefinition,
    call: ToolCall,
    signal?: AbortSignal,
    riskOverride?: ToolRisk,
    reviewContext?: PermissionReviewContext,
  ): Promise<{ allowed: boolean; risk: ToolRisk }> {
    let risk = riskOverride ?? tool.risk;
    if (
      tool.name === "bash" &&
      typeof (call.input as { command?: unknown })?.command === "string" &&
      classifyBashRisk((call.input as { command: string }).command) === "dangerous"
    )
      risk = "dangerous";
    if (
      this.mode === "auto" ||
      risk === "read" ||
      (risk === "modify" && this.#sessionAllowed.has(tool.name))
    )
      return { allowed: true, risk };
    if (
      this.mode === "smart" &&
      risk === "modify" &&
      reviewContext?.pathScope !== "outside" &&
      this.reviewer &&
      reviewContext
    ) {
      try {
        const review = await this.reviewer.review({ ...reviewContext, tool, call, risk }, signal);
        if (review.decision === "allow") return { allowed: true, risk };
      } catch (error) {
        if (signal?.aborted) throw error;
      }
    }
    if (!this.prompt) return { allowed: false, risk };
    const decision = await this.prompt(tool, call, risk, signal);
    if (decision === "allow_session" && risk === "modify") this.#sessionAllowed.add(tool.name);
    return { allowed: decision !== "deny", risk };
  }
}
