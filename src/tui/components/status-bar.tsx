import path from "node:path";
import { Text } from "ink";
import type { AgentApplicationMetadata } from "../../cli/agent-application.js";
import { displayWidth, truncateDisplay } from "../../observability/terminal-text.js";
import type { TuiPhase } from "../types.js";

export function formatStatus(
  metadata: AgentApplicationMetadata | undefined,
  phase: TuiPhase,
  contextPercent: number | undefined,
  columns: number,
  usage?: { inputTokens: number; outputTokens: number; durationMs: number },
  phaseLabel: string = phase,
): string {
  if (!metadata) return truncateDisplay(phase, columns);
  const required = [
    `${metadata.provider}/${metadata.model}`,
    path.basename(metadata.workspace) || metadata.workspaceId,
    metadata.approvalMode,
    metadata.thinkingDisplay ? `think ${metadata.thinkingDisplay}` : undefined,
    phaseLabel,
    contextPercent === undefined ? undefined : `context ${Math.round(contextPercent)}%`,
  ].filter((value): value is string => Boolean(value));
  const optional = [
    metadata.sessionId ? `session ${metadata.sessionId.slice(0, 8)}` : undefined,
    usage ? `${usage.inputTokens}/${usage.outputTokens} tok · ${usage.durationMs}ms` : undefined,
  ].filter((value): value is string => Boolean(value));
  const segments = [...required];
  for (const value of optional) {
    if (displayWidth([...segments, value].join(" · ")) <= columns) segments.push(value);
  }
  while (segments.length > 1 && displayWidth(segments.join(" · ")) > columns) segments.pop();
  return truncateDisplay(segments.join(" · "), columns);
}

export function StatusBar({
  metadata,
  phase,
  contextPercent,
  columns,
  usage,
  phaseLabel,
}: {
  metadata: AgentApplicationMetadata | undefined;
  phase: TuiPhase;
  contextPercent: number | undefined;
  columns: number;
  usage?: { inputTokens: number; outputTokens: number; durationMs: number };
  phaseLabel?: string;
}) {
  return (
    <Text dimColor wrap="truncate-end">
      {formatStatus(metadata, phase, contextPercent, columns, usage, phaseLabel)}
    </Text>
  );
}
