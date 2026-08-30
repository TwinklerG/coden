import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { open, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { MAX_SKILL_BYTES } from "./parser.js";
import type { Skill } from "./types.js";

export class SkillRegistry {
  readonly #skills = new Map<string, Skill>();
  constructor(skills: Skill[] = []) {
    for (const skill of skills) {
      const previous = this.#skills.get(skill.name);
      if (!previous || skill.scope === "project") this.#skills.set(skill.name, skill);
    }
  }
  get(name: string): Skill | undefined {
    return this.#skills.get(name);
  }
  list(): Skill[] {
    return [...this.#skills.values()].sort((a, b) =>
      a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
    );
  }
  async activate(name: string): Promise<{ skill: Skill; content: string }> {
    const skill = this.get(name);
    if (!skill) throw new SkillActivationError("skill.not_found", `No active skill named ${name}`);
    try {
      const rootRealPath = await realpath(skill.rootPath);
      const entryRealPath = await realpath(skill.entryPath);
      const rootStat = await stat(rootRealPath);
      if (
        rootRealPath !== skill.rootRealPath ||
        entryRealPath !== skill.entryRealPath ||
        !isInside(entryRealPath, rootRealPath) ||
        rootStat.dev !== skill.rootDevice ||
        rootStat.ino !== skill.rootInode
      ) {
        throw new Error("skill entry was replaced or escapes its registered root");
      }
      const handle = await open(entryRealPath, constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        const entryStat = await handle.stat();
        if (
          !entryStat.isFile() ||
          entryStat.dev !== skill.entryDevice ||
          entryStat.ino !== skill.entryInode
        ) {
          throw new Error("skill entry was replaced after discovery");
        }
        if (entryStat.size > MAX_SKILL_BYTES)
          throw new Error(`SKILL.md exceeds ${MAX_SKILL_BYTES} bytes`);
        const content = await handle.readFile();
        const digest = createHash("sha256").update(content).digest("hex");
        if (digest !== skill.entryDigest) throw new Error("skill entry content was replaced");
        return { skill, content: content.toString("utf8") };
      } finally {
        await handle.close();
      }
    } catch (error) {
      throw new SkillActivationError(
        "skill.activation_failed",
        `Could not activate ${name}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
function isInside(child: string, parent: string): boolean {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export class SkillActivationError extends Error {
  constructor(
    readonly code: "skill.not_found" | "skill.activation_failed",
    message: string,
  ) {
    super(message);
  }
}
