#!/usr/bin/env bun
import { realpath } from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Command } from "commander";
import { userConfigDir, userDataDir } from "../config/config.js";
import { TrustStore } from "../config/trust.js";
import { BunPackageManager } from "../plugins/bun-package-manager.js";
import { InstalledPluginLoader } from "../plugins/installed-loader.js";
import {
  type InstalledPluginSummary,
  type ListedPlugin,
  PluginInstaller,
  type PluginOperationOptions,
} from "../plugins/installer.js";
import { builtinTools } from "../tools/builtin/index.js";
import {
  type AgentCommandOptions,
  ConfigError,
  collect,
  parseProvider,
  positiveInteger,
  runAgentCommand,
} from "./agent-command.js";
import { type PluginCommandService, registerPluginCommand } from "./plugin-command.js";

export interface CliDependencies {
  pluginService?: PluginCommandService;
  confirm?: (message: string) => Promise<boolean>;
}

export function createCliProgram(dependencies: CliDependencies = {}): Command {
  const confirm = dependencies.confirm ?? createDefaultConfirm;
  const pluginService = dependencies.pluginService ?? createDefaultPluginService(confirm);
  const program = new Command()
    .name("coden")
    .description("CodeN — a minimal coding agent")
    .version("0.1.0")
    .argument("[prompt]", "task to execute")
    .option("-p, --print", "non-interactive print mode", false)
    .option("--provider <provider>", "openai or anthropic", parseProvider)
    .option("--model <model-id>", "model identifier")
    .option(
      "--resume [session-id]",
      "resume a previous session, or list sessions when no id is given",
    )
    .option("--auto", "skip permission and project-plugin confirmations", false)
    .option("--verbose", "show detailed runtime status", false)
    .option("--max-steps <number>", "maximum model steps", positiveInteger)
    .option("--plugin <path>", "additional local TypeScript plugin or directory", collect, [])
    .action((prompt: string | undefined, options: AgentCommandOptions) =>
      runAgentCommand(prompt, options),
    );

  registerPluginCommand(program, {
    service: pluginService,
    confirm,
    stdout: process.stdout,
    stderr: process.stderr,
  });

  return program;
}

function createDefaultPluginService(
  confirm: (message: string) => Promise<boolean>,
): PluginCommandService {
  const workspace = process.cwd();
  const installer = new PluginInstaller(
    workspace,
    userDataDir(),
    new BunPackageManager(),
    new InstalledPluginLoader(),
    builtinTools(),
  );
  const trustStore = new TrustStore(path.join(userConfigDir(), "trusted-workspaces.json"));
  return new TrustingPluginService(installer, workspace, trustStore, confirm);
}

class TrustingPluginService implements PluginCommandService {
  constructor(
    private readonly service: PluginCommandService,
    private readonly workspace: string,
    private readonly trustStore: TrustStore,
    private readonly confirm: (message: string) => Promise<boolean>,
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
    const allowed = await this.confirm(
      `Project npm plugins in ${realWorkspace} run in-process with full user permissions. Trust this workspace?`,
    );
    if (!allowed) throw new Error("workspace is not trusted for project npm plugins");
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
  return pathToFileURL(fileURLToPath(import.meta.url)).href === pathToFileURL(entry).href;
}

if (isExecutableEntry()) {
  createCliProgram()
    .parseAsync()
    .catch((error) => {
      process.stderr.write(`coden: ${error instanceof Error ? error.message : String(error)}\n`);
      // 2 = configuration/setup failure, 1 = execution failure (see design §11.4).
      process.exitCode = error instanceof ConfigError ? 2 : 1;
    });
}
