import { readFile } from "node:fs/promises";
import { CodeNError } from "../core/types.js";
import { isValidNpmPackageName } from "./specifier.js";

export interface PluginManifestEntry {
  source: "npm";
  requested: string;
}

export interface PluginManifest {
  schemaVersion: 1;
  plugins: Record<string, PluginManifestEntry>;
}

export const emptyPluginManifest = (): PluginManifest => ({ schemaVersion: 1, plugins: {} });

export async function readPluginManifest(file: string): Promise<PluginManifest> {
  try {
    const raw = JSON.parse(await readFile(file, "utf8")) as unknown;
    return normalizePluginManifest(raw);
  } catch (error) {
    if (isMissingFile(error)) return emptyPluginManifest();
    if (error instanceof CodeNError) throw error;
    throw manifestError(error, file);
  }
}

export function serializePluginManifest(manifest: PluginManifest): string {
  return `${JSON.stringify(normalizePluginManifest(manifest), null, 2)}\n`;
}

export function runtimePackageJson(manifest: PluginManifest): {
  private: true;
  dependencies: Record<string, string>;
} {
  const normalized = normalizePluginManifest(manifest);
  const dependencies: Record<string, string> = {};
  for (const [name, entry] of Object.entries(normalized.plugins))
    dependencies[name] = entry.requested;
  return { private: true, dependencies };
}

function normalizePluginManifest(value: unknown): PluginManifest {
  if (!value || typeof value !== "object") throw manifestError();
  const manifest = value as Partial<PluginManifest> & {
    plugins?: unknown;
    schemaVersion?: unknown;
  };
  if (manifest.schemaVersion !== 1) throw manifestError();
  if (!manifest.plugins || typeof manifest.plugins !== "object" || Array.isArray(manifest.plugins))
    throw manifestError();

  const plugins: Record<string, PluginManifestEntry> = {};
  for (const name of Object.keys(manifest.plugins).sort()) {
    if (!isValidNpmPackageName(name)) throw manifestError();
    const entry = (manifest.plugins as Record<string, unknown>)[name];
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw manifestError();
    const pluginEntry = entry as Partial<PluginManifestEntry>;
    if (
      pluginEntry.source !== "npm" ||
      typeof pluginEntry.requested !== "string" ||
      !pluginEntry.requested
    )
      throw manifestError();
    plugins[name] = { source: "npm", requested: pluginEntry.requested };
  }

  return { schemaVersion: 1, plugins };
}

function isMissingFile(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "ENOENT"
  );
}

function manifestError(cause?: unknown, file?: string): CodeNError {
  return new CodeNError(
    "plugin",
    "plugin.manifest_invalid",
    file ? `plugin.manifest_invalid: ${file}` : "plugin.manifest_invalid",
    false,
    undefined,
    cause instanceof Error ? { cause } : undefined,
  );
}
