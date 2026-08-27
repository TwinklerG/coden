export function truncateOutput(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  const markerBudget = 80;
  const kept = Math.max(0, maxChars - markerBudget);
  const head = Math.ceil(kept / 2);
  const tail = Math.floor(kept / 2);
  const omitted = value.length - head - tail;
  return `${value.slice(0, head)}\n... [${omitted} characters omitted] ...\n${value.slice(value.length - tail)}`;
}
