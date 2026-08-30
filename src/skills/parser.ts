import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { open } from "node:fs/promises";
import path from "node:path";
import { parseDocument } from "yaml";
import type { Skill, SkillScope } from "./types.js";

export const MAX_SKILL_BYTES = 1024 * 1024;
const NAME = /^[a-z0-9][a-z0-9-]{0,63}$/;

export interface SkillCandidate {
  scope: SkillScope;
  rootPath: string;
  entryPath: string;
  rootRealPath: string;
  entryRealPath: string;
  rootDevice: number;
  rootInode: number;
}

export class SkillParser {
  async parse(candidate: SkillCandidate): Promise<Skill> {
    const handle = await open(candidate.entryRealPath, constants.O_RDONLY | constants.O_NOFOLLOW);
    let text: string;
    let entryDevice: number;
    let entryInode: number;
    let entryDigest: string;
    try {
      const stat = await handle.stat();
      if (!stat.isFile()) throw new Error("SKILL.md must be a regular file");
      if (stat.size > MAX_SKILL_BYTES) throw new Error(`SKILL.md exceeds ${MAX_SKILL_BYTES} bytes`);
      entryDevice = stat.dev;
      entryInode = stat.ino;
      const content = await handle.readFile();
      entryDigest = createHash("sha256").update(content).digest("hex");
      text = content.toString("utf8");
    } finally {
      await handle.close();
    }
    const metadata = parseFrontmatter(text);
    const name = metadata.name;
    const description = metadata.description;
    if (typeof name !== "string" || !NAME.test(name))
      throw new Error("frontmatter name must be 1-64 lowercase letters, digits, or hyphens");
    if (name !== path.basename(candidate.rootPath))
      throw new Error("frontmatter name must match the skill directory name");
    if (typeof description !== "string" || !description.trim() || description.length > 1024)
      throw new Error(
        "frontmatter description must be a non-empty string of at most 1024 characters",
      );
    const skill: Skill = {
      name,
      description,
      scope: candidate.scope,
      rootPath: candidate.rootPath,
      entryPath: candidate.entryPath,
      rootRealPath: candidate.rootRealPath,
      entryRealPath: candidate.entryRealPath,
      rootDevice: candidate.rootDevice,
      rootInode: candidate.rootInode,
      entryDevice,
      entryInode,
      entryDigest,
    };
    if (typeof metadata.license === "string") skill.license = metadata.license;
    if (typeof metadata.compatibility === "string") skill.compatibility = metadata.compatibility;
    if (isRecord(metadata.metadata)) skill.metadata = metadata.metadata;
    if (metadata["allowed-tools"] !== undefined) skill.allowedTools = metadata["allowed-tools"];
    return skill;
  }
}

function parseFrontmatter(text: string): Record<string, unknown> {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
  if (!match?.[1]) throw new Error("SKILL.md must start with YAML frontmatter");
  const document = parseDocument(match[1]);
  if (document.errors.length)
    throw new Error(`invalid YAML frontmatter: ${document.errors[0]?.message}`);
  const value = document.toJSON();
  if (!isRecord(value)) throw new Error("frontmatter must be a YAML mapping");
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
