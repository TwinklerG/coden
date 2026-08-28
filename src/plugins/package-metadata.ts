import { readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { CodeNError } from "../core/types.js";
import { isValidNpmPackageName } from "./specifier.js";

export interface InstalledPackageMetadata {
  packageName: string;
  version: string;
  packageDirectory: string;
  entryPath: string;
  apiVersion: 1;
}

export async function readInstalledPackageMetadata(
  runtimeDirectory: string,
  packageName: string,
): Promise<InstalledPackageMetadata> {
  if (!isValidNpmPackageName(packageName)) throw metadataError();
  const packageDirectory = path.join(runtimeDirectory, "node_modules", ...packageName.split("/"));
  const packageJsonPath = path.join(packageDirectory, "package.json");
  let packageJson: unknown;
  try {
    packageJson = JSON.parse(await readFile(packageJsonPath, "utf8")) as unknown;
  } catch {
    throw metadataError();
  }

  const metadata = normalizePackageJson(packageJson, packageName);
  const packageReal = await safeRealpath(packageDirectory);
  const entryPath = path.resolve(packageDirectory, metadata.entry);
  const entryReal = await safeRealpath(entryPath, true);
  if (!withinBoundary(packageReal, entryReal)) throw entryError();

  return {
    packageName,
    version: metadata.version,
    packageDirectory: packageReal,
    entryPath: entryReal,
    apiVersion: 1,
  };
}

function normalizePackageJson(
  packageJson: unknown,
  packageName: string,
): { version: string; entry: string } {
  if (!packageJson || typeof packageJson !== "object") throw metadataError();
  const manifest = packageJson as Record<string, unknown>;
  if (manifest.name !== packageName || typeof manifest.version !== "string" || !manifest.version)
    throw metadataError();
  if (manifest.type !== "module") throw metadataError();
  if (!manifest.coden || typeof manifest.coden !== "object" || Array.isArray(manifest.coden))
    throw metadataError();
  const coden = manifest.coden as Record<string, unknown>;
  if (coden.apiVersion !== 1) throw unsupportedApiError(coden.apiVersion);
  if (typeof coden.plugin !== "string" || !isValidEntryPath(coden.plugin)) throw entryError();
  return { version: manifest.version, entry: coden.plugin };
}

async function safeRealpath(file: string, allowMissing = false): Promise<string> {
  try {
    return await realpath(file);
  } catch {
    if (allowMissing) throw entryError();
    throw metadataError();
  }
}

function withinBoundary(root: string, candidate: string): boolean {
  return candidate === root || candidate.startsWith(`${root}${path.sep}`);
}

function isValidEntryPath(entry: string): boolean {
  if (!entry.startsWith("./")) return false;
  if (entry.includes("\\") || entry.includes("://") || /\s/.test(entry)) return false;
  if (!(entry.endsWith(".js") || entry.endsWith(".mjs"))) return false;
  if (entry.split("/").includes("..")) return false;
  return true;
}

function metadataError(): CodeNError {
  return new CodeNError("plugin", "plugin.metadata_missing", "plugin.metadata_missing");
}

function unsupportedApiError(apiVersion: unknown): CodeNError {
  return new CodeNError(
    "plugin",
    "plugin.api_unsupported",
    `plugin.api_unsupported: ${String(apiVersion)}`,
  );
}

function entryError(): CodeNError {
  return new CodeNError("plugin", "plugin.entry_invalid", "plugin.entry_invalid");
}
