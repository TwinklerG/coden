#!/usr/bin/env bun
import path from "node:path";
import { stdin, stdout } from "node:process";
import { createInterface, type Interface } from "node:readline/promises";
import { Command, InvalidArgumentError } from "commander";
import {
  type CodeNConfig,
  loadConfig,
  type ProviderName,
  userConfigDir,
} from "../config/config.js";
import { TrustStore } from "../config/trust.js";
import { ContextManager } from "../context/manager.js";
import { EventBus } from "../core/events.js";
import { AgentRuntime } from "../core/runtime.js";
import type {
  AgentMessage,
  CodeNError,
  ModelProvider,
  ToolCall,
  ToolDefinition,
  ToolRisk,
} from "../core/types.js";
import { TerminalRenderer } from "../observability/terminal.js";
import { JSONLTraceWriter } from "../observability/trace.js";
import { type PermissionDecision, PermissionPolicy } from "../permissions/policy.js";
import { readWorkspaceTextFile } from "../permissions/workspace.js";
import { AnthropicProvider } from "../providers/anthropic.js";
import { OpenAICompatibleProvider } from "../providers/openai.js";
import { SessionStore } from "../sessions/store.js";
import { builtinTools } from "../tools/builtin/index.js";
import { ToolExecutor } from "../tools/executor.js";
import { PluginLoader } from "../tools/plugin-loader.js";
import { ToolRegistry } from "../tools/registry.js";

interface CliOptions {
  provider?: ProviderName;
  model?: string;
  resume?: string;
  auto: boolean;
  verbose: boolean;
  maxSteps?: number;
  plugin: string[];
  print: boolean;
}
const program = new Command()
  .name("coden")
  .description("CodeN — a minimal coding agent")
  .version("0.1.0")
  .argument("[prompt]", "task to execute")
  .option("-p, --print", "non-interactive print mode", false)
  .option("--provider <provider>", "openai or anthropic", parseProvider)
  .option("--model <model-id>", "model identifier")
  .option("--resume <session-id>", "resume a previous session")
  .option("--auto", "skip permission and project-plugin confirmations", false)
  .option("--verbose", "show detailed runtime status", false)
  .option("--max-steps <number>", "maximum model steps", positiveInteger)
  .option("--plugin <path>", "additional local TypeScript plugin or directory", collect, []);
program.parse();
const prompt = program.args[0];
const options = program.opts<CliOptions>();
main(prompt, options).catch((error) => {
  process.stderr.write(`coden: ${error instanceof Error ? error.message : String(error)}\n`);
  // 2 = configuration/setup failure, 1 = execution failure (see design §11.4).
  process.exitCode = error instanceof ConfigError ? 2 : 1;
});

class ConfigError extends Error {}

async function loadConfigOrFail(
  workspace: string,
  cli: Parameters<typeof loadConfig>[1],
): Promise<CodeNConfig> {
  try {
    return await loadConfig(workspace, cli);
  } catch (cause) {
    throw new ConfigError(
      `configuration: ${cause instanceof Error ? cause.message : String(cause)}`,
      { cause },
    );
  }
}

async function main(initialPrompt: string | undefined, options: CliOptions): Promise<void> {
  const workspace = process.cwd();
  const config = await loadConfigOrFail(workspace, {
    ...(options.provider ? { provider: options.provider } : {}),
    ...(options.model ? { model: options.model } : {}),
    ...(options.maxSteps ? { maxSteps: options.maxSteps } : {}),
    plugins: options.plugin,
  });
  const events = new EventBus();
  const needsInput = !options.auto || (!initialPrompt && !options.print);
  const rl = needsInput ? createInterface({ input: stdin, output: process.stderr }) : undefined;
  const session = new SessionStore(config.dataDir, workspace, options.resume);
  let initialMessages: AgentMessage[] | undefined;
  let recoveredSummary: string | undefined;
  let recoveredCompactionEnd = 0;
  if (options.resume) {
    const recovered = await session.recover();
    initialMessages = recovered.messages;
    recoveredSummary = recovered.summary;
    recoveredCompactionEnd = recovered.compactionRange?.end ?? 0;
    for (const warning of recovered.warnings) process.stderr.write(`coden: ${warning}\n`);
  } else await session.create(workspace);
  const trace = new JSONLTraceWriter(session.tracePath, events);
  const renderer = new TerminalRenderer(events, {
    verbose: options.verbose,
    printMode: options.print,
  });
  let provider: ModelProvider;
  try {
    provider = createProvider(config.provider);
  } catch (cause) {
    throw new ConfigError(`provider: ${cause instanceof Error ? cause.message : String(cause)}`, {
      cause,
    });
  }
  const builtins = builtinTools();
  const permissionPrompt = options.auto ? undefined : createPermissionPrompt(requireInterface(rl));
  const permissions = new PermissionPolicy(options.auto, permissionPrompt);
  const registry = new ToolRegistry(builtins);
  const executor = new ToolExecutor(registry, permissions, events, workspace);
  const trustStore = new TrustStore(path.join(userConfigDir(), "trusted-workspaces.json"));
  const loader = new PluginLoader(builtins, events, options.auto, async (directory) => {
    if (await trustStore.isTrusted(directory)) return true;
    const allowed = await yesNo(
      requireInterface(rl),
      `Project plugins at ${directory} run with full process permissions. Trust? [y/N] `,
    );
    if (allowed) await trustStore.trust(directory);
    return allowed;
  });
  const pluginDirs = [
    { path: path.join(userConfigDir(), "plugins"), project: false },
    { path: path.join(workspace, ".coden", "plugins"), project: true },
    ...config.plugins.map((item) => ({ path: path.resolve(workspace, item), project: true })),
  ];
  const reload = async () => {
    const loaded = await loader.load(pluginDirs);
    registry.replaceWith(loaded.registry);
    return loaded;
  };
  await reload();
  const projectInstructions = await readProjectInstructions(workspace);
  const contextManager = new ContextManager({
    contextWindow: config.contextWindow,
    reservedOutputTokens: config.reservedOutputTokens,
    safetyMargin: config.safetyMargin,
  });
  if (recoveredSummary) contextManager.setSummary(recoveredSummary, recoveredCompactionEnd);
  const runtime = new AgentRuntime(
    provider,
    registry,
    executor,
    contextManager,
    session,
    events,
    {
      model: config.model,
      maxSteps: config.maxSteps,
      systemPrompt:
        "You are CodeN, a concise coding agent. Inspect before editing, use tools carefully, and verify changes." +
        (projectInstructions ? `\n\nProject instructions:\n${projectInstructions}` : ""),
    },
    initialMessages,
  );
  try {
    if (initialPrompt) {
      await runTurn(runtime, initialPrompt, rl);
      return;
    }
    if (options.print) throw new Error("print mode requires a prompt");
    await repl(runtime, session.sessionId, reload, registry, requireInterface(rl));
  } finally {
    rl?.close();
    renderer.dispose();
    await trace.flush();
  }
}

async function readProjectInstructions(workspace: string): Promise<string> {
  try {
    return await readWorkspaceTextFile(workspace, "AGENTS.md");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "";
    if ((error as CodeNError).category === "permission") {
      process.stderr.write(`coden: ignoring AGENTS.md: ${(error as Error).message}\n`);
      return "";
    }
    throw new ConfigError(
      `project instructions: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
}

function createProvider(name: ProviderName): ModelProvider {
  if (name === "anthropic") {
    const apiKey = process.env.CODEN_ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error("CODEN_ANTHROPIC_API_KEY is required");
    return new AnthropicProvider({ apiKey });
  }
  const apiKey = process.env.CODEN_OPENAI_API_KEY;
  if (!apiKey) throw new Error("CODEN_OPENAI_API_KEY is required");
  return new OpenAICompatibleProvider({
    apiKey,
    ...(process.env.CODEN_OPENAI_BASE_URL ? { baseURL: process.env.CODEN_OPENAI_BASE_URL } : {}),
  });
}
async function repl(
  runtime: AgentRuntime,
  sessionId: string,
  reload: () => Promise<{ loaded: string[]; failed: string[] }>,
  registry: ToolRegistry,
  rl: Interface,
): Promise<void> {
  stdout.write(`CodeN session ${sessionId}. Type /help for commands.\n`);
  while (true) {
    const line = (await question(rl, "> ")).trim();
    if (!line) continue;
    if (line === "/quit") break;
    if (line === "/help") {
      stdout.write("/help /session /compact /reload /new /quit\n");
      continue;
    }
    if (line === "/session") {
      stdout.write(`${sessionId}\n`);
      continue;
    }
    if (line === "/compact") {
      await runtime.compact();
      stdout.write("Context compacted.\n");
      continue;
    }
    if (line === "/new") {
      await runtime.reset();
      stdout.write("Started a new conversation in this session.\n");
      continue;
    }
    if (line === "/reload") {
      const result = await reload();
      stdout.write(
        `Loaded: ${result.loaded.join(", ") || "none"}; failed: ${result.failed.length}; tools: ${registry
          .list()
          .map((tool) => tool.name)
          .join(", ")}\n`,
      );
      continue;
    }
    await runTurn(runtime, line, rl);
  }
}
function createPermissionPrompt(rl: Interface) {
  return async (
    tool: ToolDefinition,
    call: ToolCall,
    risk: ToolRisk,
    signal?: AbortSignal,
  ): Promise<PermissionDecision> => {
    const answer = await question(
      rl,
      `${risk.toUpperCase()} tool ${tool.name} ${JSON.stringify(call.input)}: [y]es/[s]ession/[N]o? `,
      signal,
    );
    return answer.toLowerCase() === "y"
      ? "allow_once"
      : answer.toLowerCase() === "s" && risk !== "dangerous"
        ? "allow_session"
        : "deny";
  };
}
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
    throw error;
  } finally {
    if (local) {
      process.removeListener("SIGINT", cancel);
      rl.removeListener("SIGINT", cancel);
    }
  }
}
async function yesNo(rl: Interface, message: string): Promise<boolean> {
  return /^y(?:es)?$/i.test(await question(rl, message));
}
function requireInterface(rl: Interface | undefined): Interface {
  if (!rl) throw new Error("Interactive input is unavailable");
  return rl;
}
async function runTurn(runtime: AgentRuntime, text: string, rl?: Interface): Promise<void> {
  const controller = new AbortController();
  const cancel = () => controller.abort(new Error("Cancelled by user"));
  process.once("SIGINT", cancel);
  rl?.once("SIGINT", cancel);
  try {
    await runtime.run(text, controller.signal);
  } catch (error) {
    if (!controller.signal.aborted) throw error;
  } finally {
    process.removeListener("SIGINT", cancel);
    rl?.removeListener("SIGINT", cancel);
  }
}
function parseProvider(value: string): ProviderName {
  if (value !== "openai" && value !== "anthropic")
    throw new InvalidArgumentError("must be openai or anthropic");
  return value;
}
function positiveInteger(value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1)
    throw new InvalidArgumentError("must be a positive integer");
  return parsed;
}
function collect(value: string, previous: string[]): string[] {
  return [...previous, value];
}
