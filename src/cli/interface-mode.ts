export interface InterfaceOptions {
  tui: boolean;
  cli: boolean;
  print: boolean;
  web?: boolean;
}

export interface TuiCapabilities {
  inputTty: boolean;
  outputTty: boolean;
  rawMode: boolean;
  term: string | undefined;
}

export type AgentInterfaceMode = "tui" | "cli" | "print" | "web";
export type InterfaceModeResult = {
  mode: AgentInterfaceMode;
  warning?: "tui_unavailable";
};

export class InterfaceModeError extends Error {}

export function detectTuiCapabilities(
  input: Pick<NodeJS.ReadStream, "isTTY" | "setRawMode">,
  output: Pick<NodeJS.WriteStream, "isTTY">,
  term: string | undefined = process.env.TERM,
): TuiCapabilities {
  return {
    inputTty: input.isTTY === true,
    outputTty: output.isTTY === true,
    rawMode: typeof input.setRawMode === "function",
    term,
  };
}

export function tuiSupported(capabilities: TuiCapabilities): boolean {
  return (
    capabilities.inputTty &&
    capabilities.outputTty &&
    capabilities.rawMode &&
    capabilities.term !== "dumb"
  );
}

export function resolveInterfaceMode(
  options: InterfaceOptions,
  capabilities: TuiCapabilities,
): InterfaceModeResult {
  const selected = [options.tui, options.cli, options.print, options.web].filter(Boolean).length;
  if (selected > 1)
    throw new InterfaceModeError("--web, --tui, --cli, and --print are mutually exclusive");
  if (options.web) return { mode: "web" };
  if (options.print) return { mode: "print" };
  if (options.cli) return { mode: "cli" };
  if (!options.tui) return { mode: "cli" };
  return tuiSupported(capabilities) ? { mode: "tui" } : { mode: "cli", warning: "tui_unavailable" };
}
