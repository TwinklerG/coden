import { displayWidth, graphemeWidth, truncateDisplay } from "../observability/terminal-text.js";
import type { TuiPhase } from "./types.js";

const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"] as const;

export const ACTIVITY_FRAME_INTERVAL_MS = 80;

export function formatActivityLine(
  phase: TuiPhase,
  activity: string,
  fallback: string,
  columns: number,
  frame: number,
): string {
  const width = Math.max(1, columns);
  const spinner = FRAMES[Math.abs(frame) % FRAMES.length] ?? FRAMES[0];
  if (width === 1) return spinner;
  const label = activity || fallback || (phase === "submitting" ? "submitting" : phase);
  const prefixWidth = graphemeWidth(spinner) + 1;
  if (width <= prefixWidth) return spinner;

  let available = width - prefixWidth;
  let text = truncateDisplay(label, available, "tail");
  let result = `${spinner} ${text}`;
  // truncateDisplay reserves a single-column ellipsis while the project metric
  // counts it as two; back off one column so the one-line preview still fits.
  while (displayWidth(result) > width && available > 0) {
    available -= 1;
    text = available > 0 ? truncateDisplay(label, available, "tail") : "";
    result = `${spinner} ${text}`;
  }
  return result;
}
