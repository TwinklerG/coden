import { constants } from "node:fs";
import { access, copyFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { CodeNError, type ToolDefinition } from "../core/types.js";
import {
  composePackageRegistry,
  type InstalledPluginLoader,
  type LoadedPackagePlugin,
  type PackagePluginFailure,
} from "./installed-loader.js";
import {
  type PluginManifest,
  readPluginManifest,
  runtimePackageJson,
  serializePluginManifest,
} from "./manifest.js";
import type { PackageManager } from "./package-manager.js";
import { readInstalledPackageMetadata } from "./package-metadata.js";
import { type PluginPaths, type PluginScope, resolvePluginPaths } from "./paths.js";
import { isValidNpmPackageName, parseNpmPluginSpecifier } from "./specifier.js";
import { PluginTransaction, type PluginTransactionCandidate } from "./transaction.js";

export interface PluginOperationOptions {
  scope: PluginScope;
  allowScripts: boolean;
  signal?: AbortSignal;
}

export interface InstalledPluginSummary {
  packageName: string;
  requested: string;
  version: string;
  tools: string[];
  scope: PluginScope;
}

export interface ListedPlugin extends InstalledPluginSummary {
  shadowedByProject: boolean;
}

export class PluginInstaller {
  constructor(
    private readonly workspace: string,
    private readonly dataDir: string,
    private readonly packageManager: PackageManager,
    private readonly loader: InstalledPluginLoader,
    private readonly builtins: ToolDefinition[],
  ) {}

  async install(raw: string, options: PluginOperationOptions): Promise<InstalledPluginSummary> {
    const specifier = parseNpmPluginSpecifier(raw);
    const paths = this.paths(options.scope);
    await new PluginTransaction(paths).recover();
    const current = await readPluginManifest(paths.manifestPath);

    if (current.plugins[specifier.packageName]?.requested === specifier.requested) {
      const existing = await this.loader.loadScope(paths);
      const plugin = existing.loaded.find((item) => item.packageName === specifier.packageName);
      if (existing.failed.length === 0 && plugin)
        return summaryFor(plugin, specifier.requested, options.scope);
    }

    const next = cloneManifest(current);
    next.plugins[specifier.packageName] = { source: "npm", requested: specifier.requested };

    let installed: LoadedPackagePlugin[] = [];
    await new PluginTransaction(paths).run(async (candidate) => {
      installed = await this.buildCandidate(candidate, next, paths, options, false);
      await this.validateCandidate(paths.scope, installed);
    });

    const plugin = installed.find((item) => item.packageName === specifier.packageName);
    if (!plugin)
      throw packageLoadFailure([
        {
          packageName: specifier.packageName,
          path: paths.runtimeDir,
          message: "plugin did not load",
        },
      ]);
    return summaryFor(plugin, specifier.requested, options.scope);
  }

  async remove(packageName: string, options: PluginOperationOptions): Promise<void> {
    if (!isValidNpmPackageName(packageName)) throw invalidPackageName(packageName);
    const paths = this.paths(options.scope);
    await new PluginTransaction(paths).recover();
    const current = await readPluginManifest(paths.manifestPath);
    if (!current.plugins[packageName]) {
      throw new CodeNError(
        "plugin",
        "plugin.install_failed",
        `plugin.install_failed: ${packageName} is not installed in ${options.scope} scope`,
      );
    }

    const next = cloneManifest(current);
    delete next.plugins[packageName];

    await new PluginTransaction(paths).run(async (candidate) => {
      const installed = await this.buildCandidate(candidate, next, paths, options, false);
      await this.validateCandidate(paths.scope, installed);
    });
  }

  async sync(options: PluginOperationOptions): Promise<InstalledPluginSummary[]> {
    const paths = this.paths(options.scope);
    await new PluginTransaction(paths).recover();
    const manifest = await readPluginManifest(paths.manifestPath);
    if (
      options.scope === "project" &&
      Object.keys(manifest.plugins).length > 0 &&
      !(await pathExists(path.join(paths.runtimeDir, "bun.lock")))
    ) {
      throw new CodeNError(
        "plugin",
        "plugin.lock_missing",
        `plugin.lock_missing: ${options.scope} plugin sync requires ${path.join(paths.runtimeDir, "bun.lock")}`,
      );
    }

    let installed: LoadedPackagePlugin[] = [];
    await new PluginTransaction(paths).run(async (candidate) => {
      installed = await this.buildCandidate(candidate, manifest, paths, options, true);
      await this.validateCandidate(paths.scope, installed);
    });

    return installed.map((plugin) =>
      summaryFor(
        plugin,
        manifest.plugins[plugin.packageName]?.requested ?? "latest",
        options.scope,
      ),
    );
  }

  async list(): Promise<{ project: ListedPlugin[]; global: ListedPlugin[] }> {
    const [project, global] = await Promise.all([
      this.listScope(this.paths("project")),
      this.listScope(this.paths("global")),
    ]);
    const projectNames = new Set(project.map((item) => item.packageName));
    return {
      project,
      global: global.map((item) => ({
        ...item,
        shadowedByProject: projectNames.has(item.packageName),
      })),
    };
  }

  private paths(scope: PluginScope): PluginPaths {
    return resolvePluginPaths(this.workspace, scope, this.dataDir);
  }

  private async buildCandidate(
    candidate: PluginTransactionCandidate,
    manifest: PluginManifest,
    sourcePaths: PluginPaths,
    options: PluginOperationOptions,
    frozenLockfile: boolean,
  ): Promise<LoadedPackagePlugin[]> {
    await mkdir(candidate.runtimeDir, { recursive: true });
    await writeFile(candidate.manifestPath, serializePluginManifest(manifest), "utf8");
    await writeFile(
      path.join(candidate.runtimeDir, "package.json"),
      `${JSON.stringify(runtimePackageJson(manifest), null, 2)}\n`,
      "utf8",
    );
    if (await pathExists(path.join(sourcePaths.runtimeDir, "bun.lock"))) {
      await copyFile(
        path.join(sourcePaths.runtimeDir, "bun.lock"),
        path.join(candidate.runtimeDir, "bun.lock"),
      );
    }

    try {
      await this.packageManager.install({
        cwd: candidate.runtimeDir,
        frozenLockfile,
        allowScripts: options.allowScripts,
        ...(options.signal ? { signal: options.signal } : {}),
      });
    } catch (error) {
      throw mapPackageManagerError(error, frozenLockfile);
    }

    await writeRuntimeGitignore(candidate.runtimeDir, sourcePaths.scope);
    const loaded = await this.loader.loadScope({
      ...sourcePaths,
      manifestPath: candidate.manifestPath,
      runtimeDir: candidate.runtimeDir,
    });
    if (loaded.failed.length > 0) throw packageLoadFailure(loaded.failed);
    return loaded.loaded;
  }

  private async validateCandidate(
    scope: PluginScope,
    staged: LoadedPackagePlugin[],
  ): Promise<void> {
    if (scope === "global") {
      composePackageRegistry(this.builtins, staged, []);
      return;
    }

    const globalPaths = this.paths("global");
    await new PluginTransaction(globalPaths).recover();
    const currentGlobals = await this.loadScopeOrThrow(globalPaths);
    composePackageRegistry(this.builtins, currentGlobals, staged);
  }

  private async loadScopeOrThrow(paths: PluginPaths): Promise<LoadedPackagePlugin[]> {
    const result = await this.loader.loadScope(paths);
    if (result.failed.length > 0) throw packageLoadFailure(result.failed);
    return result.loaded;
  }

  private async listScope(paths: PluginPaths): Promise<ListedPlugin[]> {
    await new PluginTransaction(paths).recover();
    const manifest = await readPluginManifest(paths.manifestPath);
    const listed: ListedPlugin[] = [];
    for (const packageName of Object.keys(manifest.plugins).sort()) {
      const metadata = await readInstalledPackageMetadata(paths.runtimeDir, packageName);
      listed.push({
        packageName,
        requested: manifest.plugins[packageName]?.requested ?? "latest",
        version: metadata.version,
        tools: [],
        scope: paths.scope,
        shadowedByProject: false,
      });
    }
    return listed;
  }
}

async function writeRuntimeGitignore(runtimeDir: string, scope: PluginScope): Promise<void> {
  if (scope !== "project") return;
  await writeFile(path.join(runtimeDir, ".gitignore"), "*\n!.gitignore\n!bun.lock\n", "utf8");
}

function summaryFor(
  plugin: LoadedPackagePlugin,
  requested: string,
  scope: PluginScope,
): InstalledPluginSummary {
  return {
    packageName: plugin.packageName,
    requested,
    version: plugin.version,
    tools: plugin.tools.map((tool) => tool.name).sort(),
    scope,
  };
}

function cloneManifest(manifest: PluginManifest): PluginManifest {
  return JSON.parse(serializePluginManifest(manifest)) as PluginManifest;
}

function packageLoadFailure(failures: PackagePluginFailure[]): CodeNError {
  const message = failures
    .map((failure) => `${failure.packageName}: ${failure.message} (${failure.path})`)
    .join("; ");
  return new CodeNError("plugin", "plugin.sync_failed", `plugin.sync_failed: ${message}`);
}

function invalidPackageName(packageName: string): CodeNError {
  return new CodeNError(
    "plugin",
    "plugin.specifier_invalid",
    `plugin.specifier_invalid: ${packageName}`,
  );
}

function mapPackageManagerError(error: unknown, frozenLockfile: boolean): unknown {
  if (frozenLockfile && isFrozenLockMismatch(error)) {
    return new CodeNError(
      "plugin",
      "plugin.lock_outdated",
      `plugin.lock_outdated: committed plugin lockfile is out of date`,
      false,
      undefined,
      error instanceof Error ? { cause: error } : undefined,
    );
  }
  return error;
}

function isFrozenLockMismatch(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const text = `${error.message}\n${error instanceof CodeNError ? error.code : ""}`;
  return /frozen-lockfile|lockfile.*out.?of.?date|lockfile.*would.*change|lockfile had changes/i.test(
    text,
  );
}

async function pathExists(file: string): Promise<boolean> {
  try {
    await access(file, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}
