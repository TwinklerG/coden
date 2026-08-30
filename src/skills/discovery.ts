import type { Dirent } from "node:fs";
import { readdir, realpath, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { SkillParser } from "./parser.js";
import { SkillRegistry } from "./registry.js";
import type { Skill, SkillDiscoveryFailure, SkillScope } from "./types.js";

export interface SkillDiscoveryOptions {
  workspace: string;
  home?: string;
  parser?: SkillParser;
}
export interface SkillDiscoveryResult {
  registry: SkillRegistry;
  failures: SkillDiscoveryFailure[];
}

export class SkillDiscovery {
  private readonly parser: SkillParser;
  constructor(private readonly options: SkillDiscoveryOptions) {
    this.parser = options.parser ?? new SkillParser();
  }
  async discover(): Promise<SkillDiscoveryResult> {
    const failures: SkillDiscoveryFailure[] = [];
    const user = await this.scan(
      "user",
      path.join(this.options.home ?? os.homedir(), ".agents", "skills"),
      failures,
    );
    const project = await this.scan(
      "project",
      path.join(this.options.workspace, ".agents", "skills"),
      failures,
    );
    return { registry: new SkillRegistry([...user, ...project]), failures };
  }

  private async scan(
    scope: SkillScope,
    scanRoot: string,
    failures: SkillDiscoveryFailure[],
  ): Promise<Skill[]> {
    let scanReal: string;
    try {
      scanReal = await realpath(scanRoot);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      failures.push({ path: scanRoot, scope, reason: errorMessage(error) });
      return [];
    }
    let entries: Dirent[];
    try {
      entries = await readdir(scanRoot, { withFileTypes: true });
    } catch (error) {
      failures.push({ path: scanRoot, scope, reason: errorMessage(error) });
      return [];
    }
    const skills: Skill[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
      const rootPath = path.join(scanRoot, entry.name);
      const entryPath = path.join(rootPath, "SKILL.md");
      try {
        const rootRealPath = await realpath(rootPath);
        const entryRealPath = await realpath(entryPath);
        if (!isInside(rootRealPath, scanReal) || !isInside(entryRealPath, scanReal))
          throw new Error("skill path escapes its scan root through a symbolic link");
        const rootStat = await stat(rootRealPath);
        if (!rootStat.isDirectory()) throw new Error("skill root is not a directory");
        skills.push(
          await this.parser.parse({
            scope,
            rootPath,
            entryPath,
            rootRealPath,
            entryRealPath,
            rootDevice: rootStat.dev,
            rootInode: rootStat.ino,
          }),
        );
      } catch (error) {
        failures.push({ path: rootPath, scope, reason: errorMessage(error) });
      }
    }
    return skills;
  }
}

export function isInside(child: string, parent: string): boolean {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
