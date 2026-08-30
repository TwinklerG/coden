import type { Command } from "commander";
import { I18n } from "../i18n/i18n.js";
import type {
  InstalledPluginSummary,
  ListedPlugin,
  PluginOperationOptions,
} from "../plugins/installer.js";

export interface PluginCommandService {
  install(raw: string, options: PluginOperationOptions): Promise<InstalledPluginSummary>;
  remove(packageName: string, options: PluginOperationOptions): Promise<void>;
  sync(options: PluginOperationOptions): Promise<InstalledPluginSummary[]>;
  list(): Promise<{ project: ListedPlugin[]; global: ListedPlugin[] }>;
}

export interface PluginCommandDependencies {
  service: PluginCommandService;
  confirm(message: string): Promise<boolean>;
  stdout: Pick<NodeJS.WriteStream, "write">;
  stderr: Pick<NodeJS.WriteStream, "write">;
  i18n?: I18n;
}

interface ScopeOptions {
  global?: boolean;
}

interface MutatingOptions extends ScopeOptions {
  allowScripts?: boolean;
  yes?: boolean;
}

interface ListOptions {
  project?: boolean;
  global?: boolean;
}

export function registerPluginCommand(
  program: Command,
  dependencies: PluginCommandDependencies,
): void {
  const i18n = dependencies.i18n ?? new I18n("en");
  const m = i18n.messages.plugin;
  const plugin = program.command("plugin").description(m.manage);

  plugin
    .command("install")
    .argument("<specifier>", m.specifier)
    .option("--global", m.installGlobal)
    .option("--allow-scripts", m.allowScripts)
    .option("--yes", m.yes)
    .action((specifier: string, options: MutatingOptions) =>
      runPluginAction(dependencies, async () => {
        const operation = operationOptions(options);
        if (!(await confirmMutation(dependencies, m.verb.install, specifier, options))) return;
        const result = await dependencies.service.install(specifier, operation);
        dependencies.stdout.write(renderInstallSummary(result, operation.allowScripts, i18n));
      }),
    );

  plugin
    .command("remove")
    .argument("<package>", m.packageName)
    .option("--global", m.removeGlobal)
    .option("--allow-scripts", m.allowScriptsRebuild)
    .option("--yes", m.yes)
    .action((packageName: string, options: MutatingOptions) =>
      runPluginAction(dependencies, async () => {
        const operation = operationOptions(options);
        if (!(await confirmMutation(dependencies, m.verb.remove, packageName, options))) return;
        await dependencies.service.remove(packageName, operation);
        dependencies.stdout.write(`${m.removed(packageName, operation.scope)}\n${m.restart}\n`);
      }),
    );

  plugin
    .command("list")
    .option("--project", m.projectOnly)
    .option("--global", m.globalOnly)
    .action((options: ListOptions) =>
      runPluginAction(dependencies, async () => {
        if (options.project && options.global) {
          throw new Error(m.listConflict);
        }
        const result = await dependencies.service.list();
        dependencies.stdout.write(renderList(result, options, i18n));
      }),
    );

  plugin
    .command("sync")
    .option("--global", m.syncGlobal)
    .option("--allow-scripts", m.allowScripts)
    .option("--yes", m.yes)
    .action((options: MutatingOptions) =>
      runPluginAction(dependencies, async () => {
        const operation = operationOptions(options);
        if (
          !(await confirmMutation(dependencies, m.verb.sync, `${operation.scope} plugins`, options))
        )
          return;
        const synced = await dependencies.service.sync(operation);
        dependencies.stdout.write(
          renderSyncSummary(operation.scope, synced, operation.allowScripts, i18n),
        );
      }),
    );
}

function operationOptions(options: MutatingOptions): PluginOperationOptions {
  return {
    scope: options.global ? "global" : "project",
    allowScripts: options.allowScripts === true,
  };
}

async function confirmMutation(
  dependencies: PluginCommandDependencies,
  verb: string,
  target: string,
  options: MutatingOptions,
): Promise<boolean> {
  if (!options.yes) {
    const i18n = dependencies.i18n ?? new I18n("en");
    const allowed = await dependencies.confirm(i18n.messages.plugin.confirm(verb, target));
    if (!allowed) return false;
  }
  if (options.allowScripts) {
    const i18n = dependencies.i18n ?? new I18n("en");
    dependencies.stderr.write(i18n.messages.plugin.warning);
    if (!options.yes) {
      const allowed = await dependencies.confirm(i18n.messages.plugin.allowQuestion);
      if (!allowed) return false;
    }
  }
  return true;
}

async function runPluginAction(
  dependencies: PluginCommandDependencies,
  action: () => Promise<void>,
): Promise<void> {
  try {
    await action();
  } catch (error) {
    dependencies.stderr.write(`coden: ${sanitizeError(error)}\n`);
    process.exitCode = 2;
  }
}

function renderInstallSummary(
  result: InstalledPluginSummary,
  allowScripts: boolean,
  i18n: I18n,
): string {
  const m = i18n.messages.plugin;
  return [
    m.installed(result.packageName, result.version, result.scope),
    m.requested(result.requested),
    m.tools(result.tools.length > 0 ? result.tools.slice().sort().join(", ") : m.none),
    m.scripts(allowScripts),
    m.restart,
    "",
  ].join("\n");
}

function renderSyncSummary(
  scope: "project" | "global",
  synced: InstalledPluginSummary[],
  allowScripts: boolean,
  i18n: I18n,
): string {
  const packages = synced
    .slice()
    .sort((left, right) => left.packageName.localeCompare(right.packageName))
    .map((item) => `${item.packageName}@${item.version}`);
  const m = i18n.messages.plugin;
  return [
    m.synced(scope, packages.join(", ") || m.none),
    m.scripts(allowScripts),
    m.restart,
    "",
  ].join("\n");
}

function renderList(
  result: { project: ListedPlugin[]; global: ListedPlugin[] },
  options: ListOptions,
  i18n: I18n,
): string {
  const sections: string[] = [];
  if (!options.global)
    sections.push(renderListSection(i18n.messages.plugin.projectTitle, result.project, i18n));
  if (!options.project)
    sections.push(renderListSection(i18n.messages.plugin.globalTitle, result.global, i18n));
  return `${sections.join("\n")}\n`;
}

function renderListSection(title: string, plugins: ListedPlugin[], i18n: I18n): string {
  const sorted = plugins
    .slice()
    .sort((left, right) => left.packageName.localeCompare(right.packageName));
  if (sorted.length === 0) return i18n.messages.plugin.empty(title);
  const lines = sorted.map((plugin) =>
    i18n.messages.plugin.item(
      plugin.packageName,
      plugin.version,
      plugin.requested,
      plugin.tools.length,
      plugin.shadowedByProject === true,
    ),
  );
  return `${title}:\n${lines.join("\n")}\n`;
}

function sanitizeError(error: unknown): string {
  let message = error instanceof Error ? error.message : String(error);
  for (const value of Object.values(process.env)) {
    if (!value || value.length < 8) continue;
    message = message.split(value).join("[redacted]");
  }
  return message;
}
