import path from "node:path";
import { pathToFileURL } from "node:url";
import { CodeNError, type ToolDefinition } from "../core/types.js";
import { ToolRegistry, type ToolSource } from "../tools/registry.js";
import { normalizePluginExport } from "./api.js";
import { readPluginManifest } from "./manifest.js";
import { readInstalledPackageMetadata } from "./package-metadata.js";
import type { PluginPaths } from "./paths.js";

export interface LoadedPackagePlugin {
  packageName: string;
  version: string;
  entryPath: string;
  tools: ToolDefinition[];
}

export interface PackagePluginFailure {
  packageName: string;
  path: string;
  message: string;
}

export interface PackagePluginLoadResult {
  loaded: LoadedPackagePlugin[];
  failed: PackagePluginFailure[];
}

export type PackageImporter = (specifier: string) => Promise<{ default?: unknown }>;

export interface ShadowedPackage {
  packageName: string;
  globalVersion: string;
  projectVersion: string;
}

export class InstalledPluginLoader {
  constructor(private readonly importer: PackageImporter = (specifier) => import(specifier)) {}

  async loadScope(paths: PluginPaths): Promise<PackagePluginLoadResult> {
    const manifest = await readPluginManifest(paths.manifestPath);
    const loaded: LoadedPackagePlugin[] = [];
    const failed: PackagePluginFailure[] = [];

    for (const packageName of Object.keys(manifest.plugins).sort()) {
      const packageDirectory = packageDirectoryFor(paths.runtimeDir, packageName);
      try {
        const metadata = await readInstalledPackageMetadata(paths.runtimeDir, packageName);
        try {
          const module = await this.importer(pathToFileURL(metadata.entryPath).href);
          const tools = normalizePluginExport(module.default, packageName);
          loaded.push({
            packageName,
            version: metadata.version,
            entryPath: metadata.entryPath,
            tools,
          });
        } catch (error) {
          failed.push({
            packageName,
            path: metadata.entryPath,
            message: errorMessage(error),
          });
        }
      } catch (error) {
        failed.push({
          packageName,
          path: packageDirectory,
          message: errorMessage(error),
        });
      }
    }

    return { loaded, failed };
  }
}

export function composePackageRegistry(
  builtins: ToolDefinition[],
  globalPlugins: LoadedPackagePlugin[],
  projectPlugins: LoadedPackagePlugin[],
): { registry: ToolRegistry; effective: LoadedPackagePlugin[]; shadowed: ShadowedPackage[] } {
  const registry = new ToolRegistry(builtins);
  const projectByName = new Map(projectPlugins.map((plugin) => [plugin.packageName, plugin]));
  const shadowed: ShadowedPackage[] = [];
  const effectiveGlobals: LoadedPackagePlugin[] = [];

  for (const plugin of globalPlugins) {
    const projectPlugin = projectByName.get(plugin.packageName);
    if (projectPlugin) {
      shadowed.push({
        packageName: plugin.packageName,
        globalVersion: plugin.version,
        projectVersion: projectPlugin.version,
      });
      continue;
    }
    effectiveGlobals.push(plugin);
  }

  const effective = [...effectiveGlobals, ...projectPlugins];
  for (const plugin of effective) registerPackageTools(registry, plugin);
  return { registry, effective, shadowed };
}

function registerPackageTools(registry: ToolRegistry, plugin: LoadedPackagePlugin): void {
  const source: ToolSource = {
    kind: "npm",
    pluginName: plugin.packageName,
    pluginVersion: plugin.version,
    path: plugin.entryPath,
  };
  for (const tool of plugin.tools) {
    const existingSource = registry.source(tool.name);
    if (existingSource) {
      throw new CodeNError(
        "plugin",
        "plugin.tool_conflict",
        `plugin.tool_conflict: ${tool.name} from ${formatSource(existingSource)} conflicts with ${formatSource(source)}`,
      );
    }
    registry.register(tool, source);
  }
}

function packageDirectoryFor(runtimeDir: string, packageName: string): string {
  return path.join(runtimeDir, "node_modules", ...packageName.split("/"));
}

function formatSource(source: ToolSource): string {
  switch (source.kind) {
    case "builtin":
      return "builtin";
    case "local":
      return source.path ? `local:${source.path}` : "local";
    case "npm":
      return source.path
        ? `${source.pluginName}@${source.pluginVersion}:${source.path}`
        : `${source.pluginName}@${source.pluginVersion}`;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
