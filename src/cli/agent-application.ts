import path from "node:path";
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
import type { ThinkingLevel } from "../core/thinking.js";
import type {
  AgentMessage,
  CodeNError,
  ModelProvider,
  ToolCall,
  ToolDefinition,
  ToolRisk,
} from "../core/types.js";
import { HookEngine } from "../hooks/engine.js";
import type { SessionEndReason } from "../hooks/types.js";
import { saveUserLanguage } from "../i18n/config.js";
import type { I18n } from "../i18n/i18n.js";
import type { Language } from "../i18n/language.js";
import { buildSystemPrompt } from "../i18n/prompts.js";
import { sanitizeTerminalText } from "../observability/terminal-text.js";
import { JSONLTraceWriter } from "../observability/trace.js";
import type { PermissionDecision, PermissionMode } from "../permissions/policy.js";
import { PermissionPolicy } from "../permissions/policy.js";
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
import { resolveThinkingStatus, type ThinkingStatus } from "../providers/thinking.js";
import { SessionStore, workspaceHash } from "../sessions/store.js";
import { SkillDiscovery } from "../skills/discovery.js";
import { formatSkillCatalog } from "../skills/prompt.js";
import type { SkillRegistry } from "../skills/registry.js";
import { builtinTools } from "../tools/builtin/index.js";
import { ToolExecutor } from "../tools/executor.js";
import { PluginLoader, type PluginLoadResult } from "../tools/plugin-loader.js";
import { ToolRegistry, type ToolSource } from "../tools/registry.js";
import type { AgentCommandOptions } from "./agent-command.js";

export class ConfigError extends Error {}

export interface AgentInteraction {
  confirm(message: string, signal?: AbortSignal): Promise<boolean>;
  permission(
    tool: ToolDefinition,
    call: ToolCall,
    risk: ToolRisk,
    signal?: AbortSignal,
  ): Promise<PermissionDecision>;
}

export interface AgentApplicationMetadata {
  provider: ProviderName;
  model: string;
  workspace: string;
  workspaceId: string;
  approvalMode: PermissionMode;
  sessionId: string;
  thinkingLevel: ThinkingLevel;
  thinkingDisplay: string;
}

export interface CreateAgentApplicationOptions {
  workspace: string;
  command: AgentCommandOptions;
  i18n: I18n;
  interaction: AgentInteraction;
  onEvents?: (events: EventBus) => void;
  onHookDiagnostic?: (message: string) => void;
}

export interface AgentApplication {
  runtime: AgentRuntime;
  events: EventBus;
  session: SessionStore;
  registry: ToolRegistry;
  skills: SkillRegistry;
  recoveredMessages: AgentMessage[];
  startupWarnings: string[];
  metadata: AgentApplicationMetadata;
  reload(): Promise<PluginLoadResult>;
  switchLanguage(language: Language): Promise<void>;
  getThinkingStatus(): ThinkingStatus;
  switchThinkingLevel(level: ThinkingLevel): Promise<ThinkingStatus>;
  end(reason: SessionEndReason): Promise<void>;
  dispose(): Promise<void>;
}

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

export function resolveInitialThinkingLevel(
  explicit: ThinkingLevel | undefined,
  recovered: ThinkingLevel | undefined,
  configured: ThinkingLevel,
): ThinkingLevel {
  return explicit ?? recovered ?? configured;
}

export async function createAgentApplication(
  options: CreateAgentApplicationOptions,
): Promise<AgentApplication> {
  const { workspace, command, i18n, interaction } = options;
  if (command.auto && command.smartApprove)
    throw new ConfigError(i18n.messages.cli.conflictingApproval);
  if (command.allowOutsideWorkspace && !command.auto)
    throw new ConfigError(i18n.messages.cli.outsideRequiresAuto);
  if (command.resume === true) throw new ConfigError("session listing is not an agent application");

  const config = await loadConfigOrFail(workspace, {
    ...(command.provider ? { provider: command.provider } : {}),
    ...(command.model ? { model: command.model } : {}),
    ...(command.maxSteps ? { maxSteps: command.maxSteps } : {}),
    ...(command.thinking ? { thinkingLevel: command.thinking } : {}),
    language: i18n.currentLanguage,
    plugins: command.plugin,
  });
  const events = new EventBus();
  options.onEvents?.(events);
  const resumedId = typeof command.resume === "string" ? command.resume : undefined;
  const session = new SessionStore(config.dataDir, workspace, resumedId);
  let initialMessages: AgentMessage[] | undefined;
  let recoveredSummary: string | undefined;
  let recoveredCompactionRange: { start: number; end: number } | undefined;
  let recoveredThinkingLevel: ThinkingLevel | undefined;
  const startupWarnings: string[] = [];
  if (typeof command.resume === "string") {
    const recovered = await session.recover();
    initialMessages = recovered.messages;
    recoveredSummary = recovered.summary;
    recoveredCompactionRange = recovered.compactionRange;
    recoveredThinkingLevel = recovered.thinkingLevel;
    startupWarnings.push(...recovered.warnings);
  }

  const resolvedThinkingLevel = resolveInitialThinkingLevel(
    command.thinking,
    recoveredThinkingLevel,
    config.thinkingLevel,
  );
  let initialThinking: ThinkingStatus;
  try {
    initialThinking = resolveThinkingStatus(
      config.provider,
      resolvedThinkingLevel,
      config.reservedOutputTokens,
    );
  } catch (cause) {
    throw new ConfigError(`thinking: ${cause instanceof Error ? cause.message : String(cause)}`, {
      cause,
    });
  }

  const trace = new JSONLTraceWriter(session.tracePath, events, () => session.isCreated);
  let disposed = false;
  let provider: ModelProvider;
  try {
    provider = createProvider(config.provider);
  } catch (cause) {
    throw new ConfigError(`provider: ${cause instanceof Error ? cause.message : String(cause)}`, {
      cause,
    });
  }

  const skillDiscovery = await new SkillDiscovery({ workspace }).discover();
  if (command.verbose) {
    for (const failure of skillDiscovery.failures)
      startupWarnings.push(`ignored ${failure.scope} skill ${failure.path}: ${failure.reason}`);
  }
  const skills = skillDiscovery.registry;
  let builtins = builtinTools(skills, i18n);
  const permissionMode: PermissionMode = command.auto
    ? "auto"
    : command.smartApprove
      ? "smart"
      : "manual";
  const permissionPrompt = permissionMode === "auto" ? undefined : interaction.permission;
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
  const trustStore = new TrustStore(path.join(userConfigDir(), "trusted-workspaces.json"));
  const ensureWorkspaceTrusted = createWorkspaceTrustGate(
    workspace,
    trustStore,
    interaction.confirm,
    i18n,
  );
  let projectTrusted = await trustStore.isWorkspaceTrusted(workspace);
  if (!projectTrusted && config.hooks.some((hook) => hook.scope === "project"))
    projectTrusted = await ensureWorkspaceTrusted();
  const activeHooks = projectTrusted
    ? config.hooks
    : config.hooks.filter((hook) => hook.scope === "user");
  const hooks = new HookEngine(activeHooks, events, undefined, (message) =>
    options.onHookDiagnostic?.(sanitizeTerminalText(message)),
  );
  const hookContext = { cwd: workspace, sessionId: session.sessionId, permissionMode };
  const executor = new ToolExecutor(
    registry,
    permissions,
    events,
    workspace,
    60_000,
    command.allowOutsideWorkspace,
    hooks,
    hookContext,
  );
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

  const projectInstructions = await readProjectInstructions(workspace, startupWarnings);
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
  );
  if (recoveredSummary) contextManager.setSummary(recoveredSummary, recoveredCompactionRange);
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
      thinkingLevel: resolvedThinkingLevel,
    },
    initialMessages,
    hooks,
    hookContext,
  );
  await runtime.start(typeof command.resume === "string" ? "resume" : "startup");
  const switchLanguage = async (language: Language) => {
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
  };

  const metadata: AgentApplicationMetadata = {
    provider: config.provider,
    model: config.model,
    workspace,
    workspaceId: workspaceHash(workspace),
    approvalMode: permissionMode,
    sessionId: session.sessionId,
    thinkingLevel: initialThinking.level,
    thinkingDisplay: initialThinking.displayLevel,
  };

  const getThinkingStatus = (): ThinkingStatus =>
    resolveThinkingStatus(config.provider, runtime.thinkingLevel, config.reservedOutputTokens);

  const switchThinkingLevel = async (level: ThinkingLevel): Promise<ThinkingStatus> => {
    if (runtime.thinkingLevel === level) return getThinkingStatus();
    let next: ThinkingStatus;
    try {
      next = resolveThinkingStatus(config.provider, level, config.reservedOutputTokens);
    } catch (cause) {
      throw new ConfigError(`thinking: ${cause instanceof Error ? cause.message : String(cause)}`, {
        cause,
      });
    }
    if (session.isCreated) await session.appendThinkingLevel(level);
    runtime.updateThinkingLevel(level);
    metadata.thinkingLevel = level;
    metadata.thinkingDisplay = next.displayLevel;
    await events.emit("thinking.changed", {
      level: next.level,
      effectiveLevel: next.effectiveLevel,
      displayLevel: next.displayLevel,
      ...(next.budgetTokens !== undefined ? { budgetTokens: next.budgetTokens } : {}),
    });
    return next;
  };

  if (
    typeof command.resume === "string" &&
    command.thinking !== undefined &&
    command.thinking !== recoveredThinkingLevel
  ) {
    await session.appendThinkingLevel(command.thinking);
  }

  let ended = false;
  const end = async (reason: SessionEndReason) => {
    if (ended) return;
    ended = true;
    try {
      await hooks.run("SessionEnd", { reason }, hookContext);
    } catch {
      /* best effort */
    }
  };

  return {
    runtime,
    events,
    session,
    registry,
    skills,
    recoveredMessages: initialMessages ? [...initialMessages] : [],
    startupWarnings,
    metadata,
    reload,
    switchLanguage,
    getThinkingStatus,
    switchThinkingLevel,
    end,
    async dispose() {
      if (disposed) return;
      disposed = true;
      await end("completed");
      await trace.flush();
    },
  };
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
  confirm: (message: string, signal?: AbortSignal) => Promise<boolean | string>,
  i18n?: I18n,
): () => Promise<boolean> {
  let decision: Promise<boolean> | undefined;
  return async () => {
    if (decision) return decision;
    decision = (async () => {
      if (await store.isWorkspaceTrusted(workspace)) return true;
      let realWorkspace: string;
      try {
        realWorkspace = await import("node:fs/promises").then(({ realpath }) =>
          realpath(workspace),
        );
      } catch {
        return false;
      }
      const message = i18n?.messages.trust.local(realWorkspace) ?? realWorkspace;
      const answer = await confirm(message);
      const allowed = typeof answer === "boolean" ? answer : /^y(?:es)?$/i.test(answer);
      if (allowed) await store.trustWorkspace(workspace);
      return allowed;
    })();
    return decision;
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

async function readProjectInstructions(workspace: string, warnings: string[]): Promise<string> {
  try {
    return await readWorkspaceTextFile(workspace, "AGENTS.md");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "";
    if ((error as CodeNError).category === "permission") {
      warnings.push(`ignoring AGENTS.md: ${(error as Error).message}`);
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
