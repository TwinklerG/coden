import { useStdout } from "ink";
import { useEffect } from "react";

const ESC = "\u001b";
const CSI = `${ESC}[`;

export const ENABLE_MOUSE_REPORTING = `${CSI}?1000h${CSI}?1006h`;
export const DISABLE_MOUSE_REPORTING = `${CSI}?1000l${CSI}?1006l`;

export type TuiMouseInput = "scroll-up" | "scroll-down" | "other";

const SGR_MOUSE = /^\[<(\d+);(\d+);(\d+)([Mm])/;

function classifyMouseReport(button: number, suffix: string): TuiMouseInput {
  if (!Number.isSafeInteger(button) || button < 0) return "other";
  if (suffix === "m" || (button & 32) !== 0 || (button & 64) === 0) return "other";

  const wheel = button & 3;
  if (wheel === 0) return "scroll-up";
  if (wheel === 1) return "scroll-down";
  return "other";
}

export function parseMouseInputs(input: string): readonly TuiMouseInput[] | undefined {
  let remaining = input;
  const events: TuiMouseInput[] = [];

  while (remaining) {
    if (remaining.startsWith(ESC)) remaining = remaining.slice(1);
    if (!remaining.startsWith("[<")) return events.length > 0 ? [...events, "other"] : undefined;

    const match = SGR_MOUSE.exec(remaining);
    if (!match) return [...events, "other"];

    events.push(classifyMouseReport(Number(match[1]), match[4] ?? ""));
    remaining = remaining.slice(match[0].length);
  }

  return events.length > 0 ? events : undefined;
}

export function parseMouseInput(input: string): TuiMouseInput | undefined {
  return parseMouseInputs(input)?.at(-1);
}

export function useMouseReporting(): void {
  const { stdout } = useStdout();

  useEffect(() => {
    stdout.write(ENABLE_MOUSE_REPORTING);
    return () => {
      stdout.write(DISABLE_MOUSE_REPORTING);
    };
  }, [stdout]);
}
