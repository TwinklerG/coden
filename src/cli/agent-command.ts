import { stdin, stdout } from "node:process";
import { createInterface, type Interface } from "node:readline/promises";
import { InvalidArgumentError } from "commander";
import { loadConfig, type ProviderName } from "../config/config.js";
import type { AgentRuntime } from "../core/runtime.js";
import { isThinkingLevel, type ThinkingLevel } from "../core/thinking.js";
import type { ToolCall, ToolDefinition, ToolRisk } from "../core/types.js";
import { I18n } from "../i18n/i18n.js";
import type { Language } from "../i18n/language.js";
import { TerminalRenderer } from "../observability/terminal.js";
import type { PermissionDecision } from "../permissions/policy.js";
import { SessionStore } from "../sessions/store.js";
import { CODEN_VERSION } from "../version.js";
import {
  type AgentApplication,
  type AgentInteraction,
  ConfigError,
  createAgentApplication,
} from "./agent-application.js";
import { resolveEnter } from "./editor-state.js";
import { formatPermissionQuestion, formatSessionList, renderResumeTranscript } from "./format.js";
import { type MainInputResult, MultilineEditor } from "./multiline-editor.js";
import { executeReplCommand } from "./repl-command.js";

export {
  ConfigError,
  composeRuntimePackageRegistry,
  createWorkspaceTrustGate,
  loadInstalledScope,
  loadTrustedProjectScope,
} from "./agent-application.js";
export { classifyReplInput } from "./repl-command.js";

export interface AgentCommandOptions {
  provider?: ProviderName;
  model?: string;
  resume?: string | boolean;
  auto: boolean;
  smartApprove: boolean;
  allowOutsideWorkspace: boolean;
  verbose: boolean;
  maxSteps?: number;
  plugin: string[];
  print: boolean;
  tui: boolean;
  cli: boolean;
  lang?: Language;
  thinking?: ThinkingLevel;
}

export async function runAgentCommand(
  initialPrompt: string | undefined,
  options: AgentCommandOptions,
  i18n: I18n = new I18n(options.lang),
): Promise<void> {
  const workspace = process.cwd();
  if (options.resume === true) {
    const config = await loadConfigForSessionList(workspace, options, i18n);
    const session = new SessionStore(config.dataDir, workspace);
    stdout.write(formatSessionList(await session.list(), undefined, i18n));
    return;
  }

  const richRepl =
    !initialPrompt &&
    !options.print &&
    MultilineEditor.supported(stdin, process.stderr, process.env.TERM);
  const needsInput = !options.auto || (!initialPrompt && !options.print);
  const rl =
    needsInput && !richRepl ? createInterface({ input: stdin, output: process.stderr }) : undefined;
  const transientQuestion: Question = async (message, signal) => {
    const transient = createInterface({ input: stdin, output: process.stderr });
    try {
      return await question(transient, message, signal);
    } finally {
      transient.close();
    }
  };
  const ask: Question = rl ? (message, signal) => question(rl, message, signal) : transientQuestion;
  const editor = richRepl ? new MultilineEditor() : undefined;
  let renderer: TerminalRenderer | undefined;
  let application: AgentApplication | undefined;
  let endReason: "completed" | "failed" | "cancelled" | "eof" | "quit" = "completed";
  const interaction: AgentInteraction = {
    confirm: (message, signal) => yesNo(ask, message, signal),
    permission: createPermissionPrompt(ask, i18n),
  };

  try {
    application = await createAgentApplication({
      workspace,
      command: options,
      i18n,
      interaction,
      onEvents(events) {
        renderer = new TerminalRenderer(events, {
          i18n,
          verbose: options.verbose,
          printMode: options.print,
        });
      },
      onHookDiagnostic(message) {
        process.stderr.write(`[coden] ${message}\n`);
      },
    });
    for (const warning of application.startupWarnings) process.stderr.write(`coden: ${warning}\n`);

    if (initialPrompt) {
      if (await runTurn(application.runtime, initialPrompt, rl)) endReason = "cancelled";
      return;
    }
    if (options.print) throw new Error(i18n.messages.cli.printRequiresPrompt);
    const resumeTranscript =
      typeof options.resume === "string"
        ? renderResumeTranscript(application.session.sessionId, application.recoveredMessages, i18n)
        : undefined;
    endReason = await repl(application, rl, editor, resumeTranscript, i18n);
  } catch (error) {
    endReason = "failed";
    throw error;
  } finally {
    await application?.end(endReason);
    editor?.dispose();
    rl?.close();
    renderer?.dispose();
    await application?.dispose();
  }
}

async function loadConfigForSessionList(
  workspace: string,
  options: AgentCommandOptions,
  i18n: I18n,
) {
  try {
    return await loadConfig(workspace, {
      ...(options.provider ? { provider: options.provider } : {}),
      ...(options.model ? { model: options.model } : {}),
      ...(options.maxSteps ? { maxSteps: options.maxSteps } : {}),
      ...(options.thinking ? { thinkingLevel: options.thinking } : {}),
      language: i18n.currentLanguage,
      plugins: options.plugin,
    });
  } catch (cause) {
    throw new ConfigError(
      `configuration: ${cause instanceof Error ? cause.message : String(cause)}`,
      { cause },
    );
  }
}

async function repl(
  application: AgentApplication,
  rl: Interface | undefined,
  editor: MultilineEditor | undefined,
  resumeTranscript: string | undefined,
  i18n: I18n,
): Promise<"eof" | "quit"> {
  stdout.write(CODEN_BANNER);
  stdout.write(`${i18n.messages.repl.version(CODEN_VERSION)}\n`);
  stdout.write(`${i18n.messages.repl.workspace(application.metadata.workspaceId)}\n`);
  stdout.write(
    resumeTranscript
      ? `${resumeTranscript}\n\n${i18n.messages.repl.resumedHelp}\n`
      : `${i18n.messages.repl.session(application.session.sessionId)}\n`,
  );
  while (true) {
    const result = editor
      ? await editor.read()
      : await collectFallbackInput(async (prompt) => {
          const localizedPrompt =
            prompt === "> " ? (i18n.currentLanguage === "zh" ? "任务 > " : "Task > ") : prompt;
          const line = await question(requireInterface(rl), localizedPrompt);
          return line === EOF ? undefined : line;
        });
    if (result.type === "eof") return "eof";

    const command = await executeReplCommand(result.text, {
      runtime: application.runtime,
      session: application.session,
      reload: application.reload,
      registry: application.registry,
      skills: application.skills,
      i18n,
      switchLanguage: application.switchLanguage,
      getThinkingStatus: application.getThinkingStatus,
      switchThinkingLevel: application.switchThinkingLevel,
    });
    if (command.type === "empty") continue;
    if (command.type === "exit") return "quit";
    if (command.type === "output") {
      stdout.write(command.text);
      continue;
    }
    await runTurn(application.runtime, command.text, rl);
  }
}

type Question = (message: string, signal?: AbortSignal) => Promise<string>;

function createPermissionPrompt(ask: Question, i18n: I18n = new I18n("en")) {
  return async (
    tool: ToolDefinition,
    call: ToolCall,
    risk: ToolRisk,
    signal?: AbortSignal,
  ): Promise<PermissionDecision> => {
    const columns = (stdout as NodeJS.WritableStream & { columns?: number }).columns ?? 80;
    const answer = await ask(formatPermissionQuestion(tool, call, risk, columns, i18n), signal);
    return answer.toLowerCase() === "y"
      ? "allow_once"
      : answer.toLowerCase() === "s" && risk !== "dangerous"
        ? "allow_session"
        : "deny";
  };
}

const EOF = "\u0004";

async function question(rl: Interface, message: string, signal?: AbortSignal): Promise<string> {
  const local = signal ? undefined : new AbortController();
  const activeSignal = signal ?? local?.signal;
  const cancel = () => local?.abort(new Error("Cancelled by user"));
  if (local) {
    process.once("SIGINT", cancel);
    rl.once("SIGINT", cancel);
  }
  try {
    return activeSignal
      ? await rl.question(message, { signal: activeSignal })
      : await rl.question(message);
  } catch (error) {
    if (activeSignal?.aborted) return "";
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ERR_USE_AFTER_CLOSE" || /readline was closed/.test((error as Error).message)) {
      return EOF;
    }
    throw error;
  } finally {
    if (local) {
      process.removeListener("SIGINT", cancel);
      rl.removeListener("SIGINT", cancel);
    }
  }
}

async function yesNo(ask: Question, message: string, signal?: AbortSignal): Promise<boolean> {
  return /^y(?:es)?$/i.test(await ask(message, signal));
}

export async function collectFallbackInput(
  readLine: (prompt: string) => Promise<string | undefined>,
): Promise<MainInputResult> {
  let draft = "";
  let firstLine = true;
  while (true) {
    const line = await readLine(firstLine ? "> " : "  ");
    if (line === undefined) return { type: "eof" };
    const candidate = `${draft}${line}`;
    const resolved = resolveEnter(candidate, candidate.length, false);
    if (resolved.type === "submit") return resolved;
    draft = resolved.text;
    firstLine = false;
  }
}

function requireInterface(rl: Interface | undefined): Interface {
  if (!rl) throw new Error("Interactive input is unavailable");
  return rl;
}

async function runTurn(runtime: AgentRuntime, text: string, rl?: Interface): Promise<boolean> {
  const controller = new AbortController();
  const cancel = () => controller.abort(new Error("Cancelled by user"));
  process.once("SIGINT", cancel);
  rl?.once("SIGINT", cancel);
  try {
    await runtime.run(text, controller.signal);
    return false;
  } catch (error) {
    if (!controller.signal.aborted) throw error;
    return true;
  } finally {
    process.removeListener("SIGINT", cancel);
    rl?.removeListener("SIGINT", cancel);
  }
}

export function parseProvider(value: string): ProviderName {
  if (value !== "openai" && value !== "anthropic")
    throw new InvalidArgumentError("must be openai or anthropic");
  return value;
}

export function positiveInteger(value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1)
    throw new InvalidArgumentError("must be a positive integer");
  return parsed;
}

export function parseThinkingLevel(value: string): ThinkingLevel {
  if (!isThinkingLevel(value))
    throw new InvalidArgumentError("must be default, off, minimal, low, medium, or high");
  return value;
}

export function collect(value: string, previous: string[]): string[] {
  return [...previous, value];
}

const CODEN_BANNER = `
 ██████╗ ██████╗ ██████╗ ███████╗███╗   ██╗
██╔════╝██╔═══██╗██╔══██╗██╔════╝████╗  ██║
██║     ██║   ██║██║  ██║█████╗  ██╔██╗ ██║
██║     ██║   ██║██║  ██║██╔══╝  ██║╚██╗██║
╚██████╗╚██████╔╝██████╔╝███████╗██║ ╚████║
 ╚═════╝ ╚═════╝ ╚═════╝ ╚══════╝╚═╝  ╚═══╝
`;
