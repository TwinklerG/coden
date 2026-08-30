import { constants } from "node:fs";
import { lstat, open, readlink, realpath } from "node:fs/promises";
import path from "node:path";
import { CodeNError } from "../core/types.js";

export interface ResolvedFilePath {
  requested: string;
  path: string;
  scope: "inside" | "outside";
}

function isInside(child: string, parent: string): boolean {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

/** Resolves an existing target or the nearest existing real parent for a new target. */
export async function resolveStructuredFilePath(
  workspace: string,
  requested: string,
): Promise<ResolvedFilePath> {
  const workspaceReal = await realpath(workspace);
  const absolute = path.resolve(workspaceReal, requested);
  const target = await canonicalize(absolute);
  return { requested, path: target, scope: isInside(target, workspaceReal) ? "inside" : "outside" };
}

/** Repeats classification immediately before a file operation to narrow TOCTOU exposure. */
export async function revalidateStructuredFilePath(
  workspace: string,
  expected: ResolvedFilePath | undefined,
  requested: string,
): Promise<string> {
  const current = await resolveStructuredFilePath(workspace, requested);
  if (expected && (current.scope !== expected.scope || current.path !== expected.path))
    throw new CodeNError(
      "permission",
      "workspace.path_changed",
      `Path changed before execution: ${requested}`,
    );
  return current.path;
}

export async function readWorkspaceTextFile(
  workspace: string,
  requested: string,
  maxBytes = 1_000_000,
): Promise<string> {
  const target = await resolveWorkspacePath(workspace, requested);
  const handle = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const fileStat = await handle.stat();
    if (fileStat.size > maxBytes)
      throw new CodeNError(
        "context",
        "workspace.instructions_too_large",
        `${requested} exceeds the ${maxBytes}-byte instruction limit`,
      );
    return await handle.readFile("utf8");
  } finally {
    await handle.close();
  }
}

/** Legacy workspace-only resolver used for project-owned configuration/instructions. */
export async function resolveWorkspacePath(workspace: string, requested: string): Promise<string> {
  const workspaceReal = await realpath(workspace);
  const absolute = path.resolve(workspaceReal, requested);
  const resolved = await resolveStructuredFilePath(workspace, requested);
  if (resolved.scope === "inside") {
    try {
      return await realpath(absolute);
    } catch {
      // Retain the lexical path for a missing target, matching the legacy
      // workspace-only contract while classification used the real parent.
      return absolute;
    }
  }
  const code = isInside(absolute, workspaceReal) ? "workspace.symlink_escape" : "workspace.outside";
  throw new CodeNError("permission", code, `Path is outside workspace: ${requested}`);
}

async function canonicalize(absolute: string, depth = 0): Promise<string> {
  if (depth > 32) throw new Error(`Too many symbolic links while resolving ${absolute}`);
  const parsed = path.parse(absolute);
  const parts = absolute.slice(parsed.root.length).split(path.sep).filter(Boolean);
  let lexical = parsed.root;
  let canonical = await realpath(parsed.root);
  for (let index = 0; index < parts.length; index++) {
    const part = parts[index];
    if (!part) continue;
    lexical = path.join(lexical, part);
    try {
      const stat = await lstat(lexical);
      if (stat.isSymbolicLink()) {
        const link = await readlink(lexical);
        return canonicalize(
          path.resolve(path.dirname(lexical), link, ...parts.slice(index + 1)),
          depth + 1,
        );
      }
      canonical = await realpath(lexical);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      return path.resolve(canonical, ...parts.slice(index));
    }
  }
  return canonical;
}
