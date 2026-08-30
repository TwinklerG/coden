import path from "node:path";
import { stdin, stdout } from "node:process";
import { createInterface, type Interface } from "node:readline/promises";
import { InvalidArgumentError } from "commander";
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
import { saveUserLanguage } from "../i18n/config.js";
import { I18n } from "../i18n/i18n.js";
import type { Language } from "../i18n/language.js";
import { buildSystemPrompt } from "../i18n/prompts.js";
import { TerminalRenderer } from "../observability/terminal.js";
import { JSONLTraceWriter } from "../observability/trace.js";
import {
  type PermissionDecision,
  type PermissionMode,
  PermissionPolicy,
} from "../permissions/policy.js";
import { LlmApprovalReviewer } from "../permissions/reviewer.js";
import { readWorkspaceTextFile } from "../permissions/workspace.js";
import {
  InstalledPluginLoader,
  type LoadedPackagePlugin,
  type PackagePluginFailure,
} from "../plugins/installed-loader.js";
import { readPluginManifest } from "../plugins/manifest.js";
import { resolvePluginPaths } from "../plugins/paths.js";
import { PluginTransaction } from "../plugins/transaction.js";
import { AnthropicProvider } from "../providers/anthropic.js";
import { OpenAICompatibleProvider } from "../providers/openai.js";
import { SessionStore, workspaceHash } from "../sessions/store.js";
import { SkillDiscovery } from "../skills/discovery.js";
import { formatSkillCatalog, formatSkillsList } from "../skills/prompt.js";
import type { SkillRegistry } from "../skills/registry.js";
import { builtinTools } from "../tools/builtin/index.js";
import { ToolExecutor } from "../tools/executor.js";
import { PluginLoader } from "../tools/plugin-loader.js";
import { ToolRegistry, type ToolSource } from "../tools/registry.js";
import { CODEN_VERSION } from "../version.js";
import { resolveEnter } from "./editor-state.js";
import { formatPermissionQuestion, formatSessionList, renderResumeTranscript } from "./format.js";
import { type MainInputResult, MultilineEditor } from "./multiline-editor.js";

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
  lang?: Language;
}

export class ConfigError extends Error {}

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

export async function runAgentCommand(
  initialPrompt: string | undefined,
  options: AgentCommandOptions,
  i18n: I18n = new I18n(options.lang),
): Promise<void> {
  const workspace = process.cwd();
  if (options.auto && options.smartApprove)
    throw new ConfigError(i18n.messages.cli.conflictingApproval);
  if (options.allowOutsideWorkspace && !options.auto)
    throw new ConfigError(i18n.messages.cli.outsideRequiresAuto);
  const config = await loadConfigOrFail(workspace, {
    ...(options.provider ? { provider: options.provider } : {}),
    ...(options.model ? { model: options.model } : {}),
    ...(options.maxSteps ? { maxSteps: options.maxSteps } : {}),
    language: i18n.currentLanguage,
    plugins: options.plugin,
  });
  const events = new EventBus();
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
  const resumedId = typeof options.resume === "string" ? options.resume : undefined;
  const session = new SessionStore(config.dataDir, workspace, resumedId);
  if (options.resume === true) {
    rl?.close();
    stdout.write(formatSessionList(await session.list(), undefined, i18n));
    return;
  }
  let initialMessages: AgentMessage[] | undefined;
  let recoveredSummary: string | undefined;
  let recoveredCompactionEnd = 0;
  let resumeTranscript: string | undefined;
  if (typeof options.resume === "string") {
    const recovered = await session.recover();
    initialMessages = recovered.messages;
    recoveredSummary = recovered.summary;
    recoveredCompactionEnd = recovered.compactionRange?.end ?? 0;
    for (const warning of recovered.warnings) process.stderr.write(`coden: ${warning}\n`);
    if (!options.print)
      resumeTranscript = renderResumeTranscript(session.sessionId, recovered.messages, i18n);
  }
  const trace = new JSONLTraceWriter(session.tracePath, events, () => session.isCreated);
  const renderer = new TerminalRenderer(events, {
    i18n,
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
  const skillDiscovery = await new SkillDiscovery({ workspace }).discover();
  if (options.verbose) {
    for (const failure of skillDiscovery.failures)
      process.stderr.write(
        `coden: ignored ${failure.scope} skill ${failure.path}: ${failure.reason}\n`,
      );
  }
  const skills = skillDiscovery.registry;
  let builtins = builtinTools(skills, i18n);
  const permissionMode: PermissionMode = options.auto
    ? "auto"
    : options.smartApprove
      ? "smart"
      : "manual";
  const permissionPrompt =
    permissionMode === "auto" ? undefined : createPermissionPrompt(ask, i18n);
  const reviewer =
    permissionMode === "smart"
      ? new LlmApprovalReviewer(
          provider,
          config.approvalModel ?? config.model,
          config.approvalStrictness,
          events,
          30_000,
          i18n,
        )
      : undefined;
  const permissions = new PermissionPolicy(permissionMode, permissionPrompt, reviewer);
  const registry = new ToolRegistry(builtins);
  const executor = new ToolExecutor(
    registry,
    permissions,
    events,
    workspace,
    60_000,
    options.allowOutsideWorkspace,
  );
  const trustStore = new TrustStore(path.join(userConfigDir(), "trusted-workspaces.json"));
  const ensureWorkspaceTrusted = createWorkspaceTrustGate(workspace, trustStore, ask, i18n);
  const loader = new PluginLoader(builtins, events, async () => ensureWorkspaceTrusted());
  const installedLoader = new InstalledPluginLoader();
  const globalPaths = resolvePluginPaths(workspace, "global", config.dataDir);
  const projectPaths = resolvePluginPaths(workspace, "project", config.dataDir);
  const pluginDirs = [
    { path: path.join(userConfigDir(), "plugins"), project: false },
    { path: path.join(workspace, ".coden", "plugins"), project: true },
    ...config.plugins.map((item) => ({ path: path.resolve(workspace, item), project: true })),
  ];
  const loadedPackageVersions = new Map<string, string>();
  const loadInstalled = async () => {
    await new PluginTransaction(globalPaths).recover();
    await new PluginTransaction(projectPaths).recover();
    const global = await loadInstalledScope(installedLoader, globalPaths, events, "global");
    const project = await loadTrustedProjectScope(
      installedLoader,
      projectPaths,
      events,
      ensureWorkspaceTrusted,
    );
    const composed = await composeRuntimePackageRegistry(
      builtins,
      global.loaded,
      project.loaded,
      events,
    );
    for (const { scope, plugin } of composed.effective) {
      const identity = `${scope}:${plugin.version}`;
      const previous = loadedPackageVersions.get(plugin.packageName);
      if (previous && previous !== identity) {
        await events.emit("plugin.restart_required", {
          source: "npm",
          packageName: plugin.packageName,
          loadedIdentity: previous,
          diskIdentity: identity,
          loadedVersion: previous.split(":").slice(1).join(":"),
          diskVersion: plugin.version,
          reason: "npm plugin metadata changed; restart CodeN to load it",
        });
      }
      loadedPackageVersions.set(plugin.packageName, identity);
    }
    return { composed, global, project };
  };
  const reload = async () => {
    loader.setBuiltins(builtins);
    const installed = await loadInstalled();
    const loaded = await loader.load(pluginDirs, installed.composed.registry);
    registry.replaceWith(loaded.registry);
    return loaded;
  };
  await reload();
  const projectInstructions = await readProjectInstructions(workspace);
  const systemPrompt = buildSystemPrompt(
    i18n,
    projectInstructions,
    formatSkillCatalog(skills, i18n),
  );
  if (initialMessages?.length) {
    if (initialMessages[0]?.role === "system")
      initialMessages[0] = { role: "system", content: systemPrompt };
    else initialMessages.unshift({ role: "system", content: systemPrompt });
  }
  const contextManager = new ContextManager(
    {
      contextWindow: config.contextWindow,
      reservedOutputTokens: config.reservedOutputTokens,
      safetyMargin: config.safetyMargin,
    },
    0.8,
    i18n,
  );
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
      systemPrompt,
      i18n,
    },
    initialMessages,
  );
  try {
    if (initialPrompt) {
      await runTurn(runtime, initialPrompt, rl);
      return;
    }
    if (options.print) throw new Error(i18n.messages.cli.printRequiresPrompt);
    await repl(
      runtime,
      session,
      reload,
      registry,
      skills,
      rl,
      editor,
      workspaceHash(workspace),
      resumeTranscript,
      i18n,
      async (language) => {
        await saveUserLanguage(language);
        const previous = i18n.currentLanguage;
        try {
          i18n.setLanguage(language);
          builtins = builtinTools(skills, i18n);
          await reload();
          runtime.updateSystemPrompt(
            buildSystemPrompt(i18n, projectInstructions, formatSkillCatalog(skills, i18n)),
          );
        } catch (error) {
          i18n.setLanguage(previous);
          builtins = builtinTools(skills, i18n);
          await reload();
          throw error;
        }
      },
    );
  } finally {
    editor?.dispose();
    rl?.close();
    renderer.dispose();
    await trace.flush();
  }
}

export interface InstalledScopeResult {
  loaded: LoadedPackagePlugin[];
  failed: PackagePluginFailure[];
  unavailable?: boolean;
}

export interface RuntimeEffectivePackage {
  scope: "global" | "project";
  plugin: LoadedPackagePlugin;
}

export async function composeRuntimePackageRegistry(
  builtins: ToolDefinition[],
  globalPlugins: LoadedPackagePlugin[],
  projectPlugins: LoadedPackagePlugin[],
  events: EventBus,
): Promise<{ registry: ToolRegistry; effective: RuntimeEffectivePackage[] }> {
  const registry = new ToolRegistry(builtins);
  const projectNames = new Set(projectPlugins.map((plugin) => plugin.packageName));
  const packages: RuntimeEffectivePackage[] = [
    ...globalPlugins.map((plugin) => ({ scope: "global" as const, plugin })),
    ...projectPlugins.map((plugin) => ({ scope: "project" as const, plugin })),
  ];
  const effective: RuntimeEffectivePackage[] = [];
  for (const item of packages) {
    if (item.scope === "global" && projectNames.has(item.plugin.packageName)) continue;
    const candidate = registry.clone();
    const source: ToolSource = {
      kind: "npm",
      pluginName: item.plugin.packageName,
      pluginVersion: item.plugin.version,
      path: item.plugin.entryPath,
    };
    try {
      for (const tool of item.plugin.tools) candidate.register(tool, source);
      registry.replaceWith(candidate);
      effective.push(item);
    } catch (error) {
      await events.emit("plugin.failed", {
        source: "npm",
        scope: item.scope,
        packageName: item.plugin.packageName,
        version: item.plugin.version,
        path: item.plugin.entryPath,
        message: `${error instanceof Error ? error.message : String(error)}; package skipped to preserve earlier tools`,
      });
    }
  }
  return { registry, effective };
}

export function createWorkspaceTrustGate(
  workspace: string,
  store: TrustStore,
  ask: Question,
  i18n: I18n = new I18n("en"),
): () => Promise<boolean> {
  return async () => {
    if (await store.isWorkspaceTrusted(workspace)) return true;
    let realWorkspace: string;
    try {
      realWorkspace = await import("node:fs/promises").then(({ realpath }) => realpath(workspace));
    } catch {
      return false;
    }
    const allowed = await yesNo(ask, i18n.messages.trust.local(realWorkspace));
    if (allowed) await store.trustWorkspace(workspace);
    return allowed;
  };
}

export async function loadTrustedProjectScope(
  loader: InstalledPluginLoader,
  paths: ReturnType<typeof resolvePluginPaths>,
  events: EventBus,
  ensureTrusted: () => Promise<boolean>,
): Promise<InstalledScopeResult> {
  const manifest = await readPluginManifest(paths.manifestPath);
  if (Object.keys(manifest.plugins).length === 0) return { loaded: [], failed: [] };
  if (!(await ensureTrusted())) {
    await events.emit("plugin.unavailable", {
      source: "npm",
      scope: "project",
      path: paths.root,
      reason: "workspace is not trusted",
    });
    return { loaded: [], failed: [], unavailable: true };
  }
  return loadInstalledScope(loader, paths, events, "project");
}

export async function loadInstalledScope(
  loader: InstalledPluginLoader,
  paths: ReturnType<typeof resolvePluginPaths>,
  events: EventBus,
  scope: "global" | "project",
): Promise<InstalledScopeResult> {
  try {
    const result = await loader.loadScope(paths);
    for (const plugin of result.loaded) {
      await events.emit("plugin.loaded", {
        source: "npm",
        scope,
        packageName: plugin.packageName,
        version: plugin.version,
        path: plugin.entryPath,
        tools: plugin.tools.map((tool) => tool.name),
      });
    }
    for (const failure of result.failed) {
      await events.emit("plugin.failed", {
        source: "npm",
        scope,
        packageName: failure.packageName,
        path: failure.path,
        message: `${failure.message}; run coden plugin sync to repair the runtime`,
      });
    }
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await events.emit("plugin.failed", {
      source: "npm",
      scope,
      path: paths.runtimeDir,
      message: `${message}; run coden plugin sync to repair the runtime`,
    });
    return { loaded: [], failed: [], unavailable: true };
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
  session: SessionStore,
  reload: () => Promise<{ loaded: string[]; failed: string[] }>,
  registry: ToolRegistry,
  skills: SkillRegistry,
  rl: Interface | undefined,
  editor: MultilineEditor | undefined,
  workspaceId: string,
  resumeTranscript: string | undefined,
  i18n: I18n,
  switchLanguage: (language: Language) => Promise<void>,
): Promise<void> {
  stdout.write(CODEN_BANNER);
  stdout.write(`${i18n.messages.repl.version(CODEN_VERSION)}\n`);
  stdout.write(`${i18n.messages.repl.workspace(workspaceId)}\n`);
  stdout.write(
    resumeTranscript
      ? `${resumeTranscript}\n\n${i18n.messages.repl.resumedHelp}\n`
      : `${i18n.messages.repl.session(session.sessionId)}\n`,
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
    if (result.type === "eof") break;

    const classified = classifyReplInput(result.text);
    if (classified.type === "empty") continue;
    if (classified.type === "command" && classified.command === "/quit") break;
    if (classified.type === "command" && classified.command === "/help") {
      stdout.write(i18n.messages.repl.help);
      continue;
    }
    if (classified.type === "command" && classified.command === "/skills") {
      stdout.write(formatSkillsList(skills, undefined, i18n));
      continue;
    }
    if (classified.type === "command" && classified.command === "/sessions") {
      stdout.write(formatSessionList(await session.list(), session.sessionId, i18n));
      continue;
    }
    if (classified.type === "command" && classified.command === "/session") {
      stdout.write(`${session.sessionId}\n`);
      continue;
    }
    if (classified.type === "command" && classified.command === "/compact") {
      await runtime.compact();
      stdout.write(i18n.messages.repl.compacted);
      continue;
    }
    if (classified.type === "command" && classified.command === "/new") {
      await runtime.reset();
      stdout.write(i18n.messages.repl.newConversation);
      continue;
    }
    if (classified.type === "command" && classified.command === "/reload") {
      const result = await reload();
      stdout.write(
        i18n.messages.repl.loaded(
          result.loaded.join(", "),
          result.failed.length,
          registry
            .list()
            .map((tool) => tool.name)
            .join(", "),
        ),
      );
      continue;
    }
    if (classified.type === "language") {
      if (!classified.language) {
        stdout.write(formatLanguageList(i18n));
        continue;
      }
      if (classified.language !== "zh" && classified.language !== "en") {
        stdout.write(`${i18n.messages.language.invalid(classified.language)}\n`);
        stdout.write(formatLanguageList(i18n));
        continue;
      }
      try {
        await switchLanguage(classified.language);
        stdout.write(`${i18n.messages.language.changed(i18n.displayName(classified.language))}\n`);
      } catch (error) {
        stdout.write(
          `${i18n.messages.language.saveFailed(error instanceof Error ? error.message : String(error))}\n`,
        );
      }
      continue;
    }
    if (classified.type === "message") await runTurn(runtime, classified.text, rl);
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

async function yesNo(ask: Question, message: string): Promise<boolean> {
  return /^y(?:es)?$/i.test(await ask(message));
}

const REPL_COMMANDS = new Set([
  "/help",
  "/skills",
  "/session",
  "/sessions",
  "/compact",
  "/reload",
  "/new",
  "/quit",
]);

export function classifyReplInput(
  text: string,
):
  | { type: "empty" }
  | { type: "command"; command: string }
  | { type: "language"; language?: string }
  | { type: "message"; text: string } {
  if (!text.trim()) return { type: "empty" };
  const trimmed = text.trim();
  if (!text.includes("\n") && (trimmed === "/lang" || trimmed.startsWith("/lang "))) {
    const language = trimmed.slice("/lang".length).trim();
    return language ? { type: "language", language } : { type: "language" };
  }
  if (!text.includes("\n") && REPL_COMMANDS.has(trimmed)) {
    return { type: "command", command: trimmed };
  }
  return { type: "message", text };
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

function formatLanguageList(i18n: I18n): string {
  const lines = i18n.supportedLanguages.map((language) => {
    const marker = language === i18n.currentLanguage ? "*" : " ";
    const current =
      language === i18n.currentLanguage ? `（${i18n.messages.language.current}）` : "";
    return `${marker} ${language} - ${i18n.displayName(language)}${current}`;
  });
  return `${i18n.messages.language.supported}\n${lines.join("\n")}\n${i18n.messages.language.usage}\n`;
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
