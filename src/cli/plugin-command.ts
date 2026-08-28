import type { Command } from "commander";
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
  const plugin = program.command("plugin").description("manage installed npm plugins");

  plugin
    .command("install")
    .argument("<specifier>", "npm:<package> or npm:<package>@<version-or-tag>")
    .option("--global", "install in the user-global scope")
    .option("--allow-scripts", "allow npm lifecycle scripts during dependency install")
    .option("--yes", "skip confirmation prompts")
    .action((specifier: string, options: MutatingOptions) =>
      runPluginAction(dependencies, async () => {
        const operation = operationOptions(options);
        if (!(await confirmMutation(dependencies, "Install", specifier, options))) return;
        const result = await dependencies.service.install(specifier, operation);
        dependencies.stdout.write(renderInstallSummary(result, operation.allowScripts));
      }),
    );

  plugin
    .command("remove")
    .argument("<package>", "installed npm package name")
    .option("--global", "remove from the user-global scope")
    .option("--allow-scripts", "allow npm lifecycle scripts while rebuilding dependencies")
    .option("--yes", "skip confirmation prompts")
    .action((packageName: string, options: MutatingOptions) =>
      runPluginAction(dependencies, async () => {
        const operation = operationOptions(options);
        if (!(await confirmMutation(dependencies, "Remove", packageName, options))) return;
        await dependencies.service.remove(packageName, operation);
        dependencies.stdout.write(
          `Removed ${packageName} from ${operation.scope} plugins.\nRestart CodeN to use npm plugin changes.\n`,
        );
      }),
    );

  plugin
    .command("list")
    .option("--project", "show only project plugins")
    .option("--global", "show only user-global plugins")
    .action((options: ListOptions) =>
      runPluginAction(dependencies, async () => {
        if (options.project && options.global) {
          throw new Error("plugin list accepts only one of --project or --global");
        }
        const result = await dependencies.service.list();
        dependencies.stdout.write(renderList(result, options));
      }),
    );

  plugin
    .command("sync")
    .option("--global", "sync the user-global plugin runtime")
    .option("--allow-scripts", "allow npm lifecycle scripts during dependency install")
    .option("--yes", "skip confirmation prompts")
    .action((options: MutatingOptions) =>
      runPluginAction(dependencies, async () => {
        const operation = operationOptions(options);
        if (!(await confirmMutation(dependencies, "Sync", `${operation.scope} plugins`, options)))
          return;
        const synced = await dependencies.service.sync(operation);
        dependencies.stdout.write(
          renderSyncSummary(operation.scope, synced, operation.allowScripts),
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
    const allowed = await dependencies.confirm(
      `${verb} ${target}? npm plugins run with full process permissions; validation imports plugin top-level code with full permissions. Continue?`,
    );
    if (!allowed) return false;
  }
  if (options.allowScripts) {
    dependencies.stderr.write(
      "Warning: --allow-scripts lets this package and transitive dependencies run lifecycle scripts with your user permissions.\n",
    );
    if (!options.yes) {
      const allowed = await dependencies.confirm(
        "Allow npm lifecycle scripts to run with full user permissions?",
      );
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

function renderInstallSummary(result: InstalledPluginSummary, allowScripts: boolean): string {
  return [
    `Installed ${result.packageName}@${result.version} (${result.scope})`,
    `Requested: ${result.requested}`,
    `Tools: ${result.tools.length > 0 ? result.tools.slice().sort().join(", ") : "none"}`,
    `Lifecycle scripts: ${allowScripts ? "enabled" : "disabled"}`,
    "Restart CodeN to use npm plugin changes.",
    "",
  ].join("\n");
}

function renderSyncSummary(
  scope: "project" | "global",
  synced: InstalledPluginSummary[],
  allowScripts: boolean,
): string {
  const packages = synced
    .slice()
    .sort((left, right) => left.packageName.localeCompare(right.packageName))
    .map((item) => `${item.packageName}@${item.version}`);
  return [
    `Synced ${scope} plugins: ${packages.join(", ") || "none"}`,
    `Lifecycle scripts: ${allowScripts ? "enabled" : "disabled"}`,
    "Restart CodeN to use npm plugin changes.",
    "",
  ].join("\n");
}

function renderList(
  result: { project: ListedPlugin[]; global: ListedPlugin[] },
  options: ListOptions,
): string {
  const sections: string[] = [];
  if (!options.global) sections.push(renderListSection("Project plugins", result.project));
  if (!options.project) sections.push(renderListSection("Global plugins", result.global));
  return `${sections.join("\n")}\n`;
}

function renderListSection(title: string, plugins: ListedPlugin[]): string {
  const sorted = plugins
    .slice()
    .sort((left, right) => left.packageName.localeCompare(right.packageName));
  if (sorted.length === 0) return `${title}: none\n`;
  const lines = sorted.map((plugin) => {
    const shadowed = plugin.shadowedByProject ? " (shadowed by project)" : "";
    return `  ${plugin.packageName}@${plugin.version} requested ${plugin.requested}; ${plugin.tools.length} tool(s)${shadowed}`;
  });
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
