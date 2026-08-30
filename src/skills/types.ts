export type SkillScope = "user" | "project";

export interface Skill {
  name: string;
  description: string;
  scope: SkillScope;
  rootPath: string;
  entryPath: string;
  rootRealPath: string;
  entryRealPath: string;
  rootDevice: number;
  rootInode: number;
  entryDevice: number;
  entryInode: number;
  license?: string;
  compatibility?: string;
  metadata?: Record<string, unknown>;
  allowedTools?: unknown;
}

export interface SkillDiscoveryFailure {
  path: string;
  scope: SkillScope;
  reason: string;
}
