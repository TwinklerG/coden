import { CodeNError } from "../core/types.js";

export interface NpmPluginSpecifier {
  source: "npm";
  packageName: string;
  requested: string;
  raw: string;
}

const PACKAGE_NAME_PATTERN = /^(?:@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*|[a-z0-9][a-z0-9._-]*)$/;

export function isValidNpmPackageName(name: string): boolean {
  return PACKAGE_NAME_PATTERN.test(name) && !name.includes("..") && !name.includes("\\");
}

export function parseNpmPluginSpecifier(raw: string): NpmPluginSpecifier {
  if (typeof raw !== "string" || !raw.startsWith("npm:")) throw invalidSpecifier(raw);
  const body = raw.slice(4);
  if (!body || /\s/.test(body) || body.includes("\\") || body.includes("://"))
    throw invalidSpecifier(raw);

  const { packageName, requested } = splitSpecifierBody(body);
  if (!isValidNpmPackageName(packageName)) throw invalidSpecifier(raw);
  if (!requested || /\s/.test(requested) || requested.includes("\\") || requested.includes("//"))
    throw invalidSpecifier(raw);
  if (requested.includes("..")) throw invalidSpecifier(raw);
  return { source: "npm", packageName, requested, raw };
}

function splitSpecifierBody(body: string): { packageName: string; requested: string } {
  if (body.startsWith("@")) {
    const slash = body.indexOf("/");
    if (slash < 2) throw invalidSpecifier(body);
    const versionDelimiter = body.indexOf("@", slash + 1);
    if (versionDelimiter === -1) return { packageName: body, requested: "latest" };
    return {
      packageName: body.slice(0, versionDelimiter),
      requested: body.slice(versionDelimiter + 1),
    };
  }

  const versionDelimiter = body.lastIndexOf("@");
  if (versionDelimiter === -1) return { packageName: body, requested: "latest" };
  return {
    packageName: body.slice(0, versionDelimiter),
    requested: body.slice(versionDelimiter + 1),
  };
}

function invalidSpecifier(value: string): CodeNError {
  return new CodeNError(
    "plugin",
    "plugin.specifier_invalid",
    `plugin.specifier_invalid: ${String(value)}`,
  );
}
