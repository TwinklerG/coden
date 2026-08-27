import { constants } from "node:fs";
import { lstat, open, readlink, realpath } from "node:fs/promises";
import path from "node:path";
import { CodeNError } from "../core/types.js";

function isInside(child: string, parent: string): boolean {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
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

export async function resolveWorkspacePath(workspace: string, requested: string): Promise<string> {
  const workspaceReal = await realpath(workspace);
  const absolute = path.resolve(workspaceReal, requested);
  if (!isInside(absolute, workspaceReal))
    throw new CodeNError(
      "permission",
      "workspace.outside",
      `Path is outside workspace: ${requested}`,
    );
  try {
    const targetReal = await realpath(absolute);
    if (!isInside(targetReal, workspaceReal))
      throw new CodeNError(
        "permission",
        "workspace.symlink_escape",
        `Path escapes workspace through a symlink: ${requested}`,
      );
    return targetReal;
  } catch (error) {
    if (error instanceof CodeNError) throw error;
    // The target does not exist or is a dangling symlink. Validate every
    // existing component (including symlink target chains) before returning.
    try {
      const targetStat = await lstat(absolute);
      if (targetStat.isSymbolicLink()) {
        const linkTarget = path.resolve(path.dirname(absolute), await readlink(absolute));
        await assertResolvedInside(linkTarget, workspaceReal, requested, "dangling symlink");
      }
    } catch (linkError) {
      if (linkError instanceof CodeNError) throw linkError;
    }
    await assertAncestorsInside(absolute, workspaceReal, requested);
    return absolute;
  }
}

async function assertResolvedInside(
  target: string,
  workspaceReal: string,
  requested: string,
  kind: string,
): Promise<void> {
  const resolved = await nearestExistingRealpath(target);
  if (!resolved || !isInside(resolved, workspaceReal))
    throw new CodeNError(
      "permission",
      "workspace.symlink_escape",
      `Path escapes workspace through a ${kind}: ${requested}`,
    );
}

async function assertAncestorsInside(
  absolute: string,
  workspaceReal: string,
  requested: string,
): Promise<void> {
  let parent = path.dirname(absolute);
  while (parent !== path.dirname(parent)) {
    let statResult: Awaited<ReturnType<typeof lstat>> | undefined;
    try {
      statResult = await lstat(parent);
    } catch {
      parent = path.dirname(parent);
      continue;
    }
    if (!statResult) {
      parent = path.dirname(parent);
      continue;
    }
    if (statResult.isSymbolicLink()) {
      // An intermediate symlink (possibly dangling) must resolve inside the
      // workspace even when the final component does not exist yet.
      const linkTarget = path.resolve(path.dirname(parent), await readlink(parent));
      await assertResolvedInside(linkTarget, workspaceReal, requested, "symlink");
    } else {
      let parentReal: string | undefined;
      try {
        parentReal = await realpath(parent);
      } catch {
        parent = path.dirname(parent);
        continue;
      }
      if (!parentReal) continue;
      // The deepest existing ancestor is a real directory. If it is inside the
      // workspace we are done; upper levels are the workspace's own ancestors.
      if (isInside(parentReal, workspaceReal)) return;
      throw new CodeNError(
        "permission",
        "workspace.symlink_escape",
        `Parent escapes workspace: ${requested}`,
      );
    }
    parent = path.dirname(parent);
  }
}

async function nearestExistingRealpath(target: string): Promise<string | undefined> {
  let current = target;
  while (true) {
    try {
      return await realpath(current);
    } catch {
      const parent = path.dirname(current);
      if (parent === current) return undefined;
      current = parent;
    }
  }
}
