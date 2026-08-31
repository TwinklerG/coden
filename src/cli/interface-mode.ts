export interface InterfaceOptions {
  tui: boolean;
  cli: boolean;
  print: boolean;
}

export interface TuiCapabilities {
  inputTty: boolean;
  outputTty: boolean;
  rawMode: boolean;
  term: string | undefined;
}

export type AgentInterfaceMode = "tui" | "cli" | "print";
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
  if (options.tui && options.cli)
    throw new InterfaceModeError("--tui and --cli are mutually exclusive");
  if (options.tui && options.print)
    throw new InterfaceModeError("--tui and --print are mutually exclusive");
  if (options.print) return { mode: "print" };
  if (options.cli) return { mode: "cli" };
  if (!options.tui) return { mode: "cli" };
  return tuiSupported(capabilities) ? { mode: "tui" } : { mode: "cli", warning: "tui_unavailable" };
}
