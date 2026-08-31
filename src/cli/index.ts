#!/usr/bin/env bun
import { realpathSync } from "node:fs";
import { realpath } from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import { userConfigDir, userDataDir } from "../config/config.js";
import { TrustStore } from "../config/trust.js";
import { resolveStartupLanguage } from "../i18n/config.js";
import { I18n } from "../i18n/i18n.js";
import { isLanguage, type Language } from "../i18n/language.js";
import { BunPackageManager } from "../plugins/bun-package-manager.js";
import { InstalledPluginLoader } from "../plugins/installed-loader.js";
import {
  type InstalledPluginSummary,
  type ListedPlugin,
  PluginInstaller,
  type PluginOperationOptions,
} from "../plugins/installer.js";
import { builtinTools } from "../tools/builtin/index.js";
import { runTuiCommand, TuiInitializationError } from "../tui/app.js";
import { CODEN_VERSION } from "../version.js";
import {
  type AgentCommandOptions,
  ConfigError,
  collect,
  parseProvider,
  positiveInteger,
  runAgentCommand,
} from "./agent-command.js";
import { detectTuiCapabilities, resolveInterfaceMode } from "./interface-mode.js";
import { type PluginCommandService, registerPluginCommand } from "./plugin-command.js";

export interface CliDependencies {
  pluginService?: PluginCommandService;
  confirm?: (message: string) => Promise<boolean>;
  i18n?: I18n;
}

export function createCliProgram(dependencies: CliDependencies = {}): Command {
  const i18n = dependencies.i18n ?? new I18n();
  const m = i18n.messages.cli;
  const confirm = dependencies.confirm ?? createDefaultConfirm;
  const pluginService = dependencies.pluginService ?? createDefaultPluginService(confirm, i18n);
  const program = new Command()
    .configureHelp({
      styleTitle: (title) =>
        i18n.currentLanguage === "zh"
          ? ({
              "Usage:": "用法：",
              "Arguments:": "参数：",
              "Options:": "选项：",
              "Commands:": "命令：",
              "Global Options:": "全局选项：",
            }[title] ?? title)
          : title,
    })
    .name("coden")
    .description(m.description)
    .version(CODEN_VERSION)
    .argument("[prompt]", m.promptArgument)
    .option("-p, --print", m.print, false)
    .option("--tui", m.tui, false)
    .option("--cli", m.legacyCli, false)
    .option("--provider <provider>", m.provider, parseProvider)
    .option("--model <model-id>", m.model)
    .option("--resume [session-id]", m.resume)
    .option("--auto", m.auto, false)
    .option("--smart-approve", m.smartApprove, false)
    .option("--allow-outside-workspace", m.outside, false)
    .option("--verbose", m.verbose, false)
    .option("--max-steps <number>", m.maxSteps, positiveInteger)
    .option("--plugin <path>", m.plugin, collect, [])
    .option("--lang <zh|en>", m.lang, (value: string): Language => {
      if (!isLanguage(value)) throw new Error(i18n.messages.language.invalid(value));
      return value;
    })
    .action(async (prompt: string | undefined, options: AgentCommandOptions) => {
      let resolved: ReturnType<typeof resolveInterfaceMode>;
      try {
        resolved = resolveInterfaceMode(
          { tui: options.tui, cli: options.cli, print: options.print },
          detectTuiCapabilities(process.stdin, process.stdout, process.env.TERM),
        );
      } catch {
        throw new ConfigError(m.conflictingInterface);
      }
      if (options.resume === true) return runAgentCommand(prompt, options, i18n);
      if (resolved.warning) process.stderr.write(`${m.tuiUnavailable}\n`);
      if (resolved.mode !== "tui") return runAgentCommand(prompt, options, i18n);
      try {
        await runTuiCommand(prompt, options, i18n);
      } catch (error) {
        if (!(error instanceof TuiInitializationError)) throw error;
        process.stderr.write(`${m.tuiUnavailable}\n`);
        await runAgentCommand(prompt, { ...options, tui: false, cli: true }, i18n);
      }
    });

  registerPluginCommand(program, {
    service: pluginService,
    confirm,
    stdout: process.stdout,
    stderr: process.stderr,
    i18n,
  });

  return program;
}

function createDefaultPluginService(
  confirm: (message: string) => Promise<boolean>,
  i18n: I18n,
): PluginCommandService {
  const workspace = process.cwd();
  const installer = new PluginInstaller(
    workspace,
    userDataDir(),
    new BunPackageManager(),
    new InstalledPluginLoader(),
    builtinTools(undefined, i18n),
  );
  const trustStore = new TrustStore(path.join(userConfigDir(), "trusted-workspaces.json"));
  return new TrustingPluginService(installer, workspace, trustStore, confirm, i18n);
}

class TrustingPluginService implements PluginCommandService {
  constructor(
    private readonly service: PluginCommandService,
    private readonly workspace: string,
    private readonly trustStore: TrustStore,
    private readonly confirm: (message: string) => Promise<boolean>,
    private readonly i18n: I18n,
  ) {}

  async install(raw: string, options: PluginOperationOptions): Promise<InstalledPluginSummary> {
    if (options.scope === "project") await this.ensureProjectTrust();
    return this.service.install(raw, options);
  }

  async remove(packageName: string, options: PluginOperationOptions): Promise<void> {
    return this.service.remove(packageName, options);
  }

  async sync(options: PluginOperationOptions): Promise<InstalledPluginSummary[]> {
    if (options.scope === "project") await this.ensureProjectTrust();
    return this.service.sync(options);
  }

  async list(): Promise<{ project: ListedPlugin[]; global: ListedPlugin[] }> {
    return this.service.list();
  }

  private async ensureProjectTrust(): Promise<void> {
    const realWorkspace = await realpath(this.workspace);
    if (await this.trustStore.isWorkspaceTrusted(realWorkspace)) return;
    const allowed = await this.confirm(this.i18n.messages.trust.npm(realWorkspace));
    if (!allowed) throw new Error(this.i18n.messages.trust.denied);
    await this.trustStore.trustWorkspace(realWorkspace);
  }
}

async function createDefaultConfirm(message: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  try {
    const answer = await rl.question(`${message} [y/N] `);
    return /^y(?:es)?$/i.test(answer);
  } finally {
    rl.close();
  }
}

function isExecutableEntry(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  // Compare canonical realpaths so symlinked prefixes (e.g. macOS /tmp -> /private/tmp)
  // don't cause the CLI to silently no-op when it is directly executed.
  try {
    return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(entry);
  } catch {
    return false;
  }
}

export async function bootstrapCli(argv: readonly string[] = process.argv): Promise<void> {
  const startup = await resolveStartupLanguage(argv);
  const i18n = new I18n(startup.language);
  if (startup.error) {
    process.stderr.write(`${i18n.messages.cli.error(startup.error)}\n`);
    process.exitCode = 2;
    return;
  }
  await createCliProgram({ i18n }).parseAsync([...argv]);
}

if (isExecutableEntry()) {
  bootstrapCli().catch((error) => {
    const i18n = new I18n();
    process.stderr.write(
      `${i18n.messages.cli.error(error instanceof Error ? error.message : String(error))}\n`,
    );
    // 2 = configuration/setup failure, 1 = execution failure (see design §11.4).
    process.exitCode = error instanceof ConfigError ? 2 : 1;
  });
}
