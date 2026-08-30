import pc from "picocolors";
import type { SkillRegistry } from "./registry.js";

interface SkillListColors {
  bold(text: string): string;
}

export function formatSkillCatalog(registry: SkillRegistry): string {
  const skills = registry.list();
  if (skills.length === 0) return "";
  return `Available skills:\n${skills.map((skill) => `- ${skill.name}: ${skill.description}`).join("\n")}\n\nWhen a task matches a skill, call activate_skill before proceeding.`;
}
export function formatSkillsList(registry: SkillRegistry, colors: SkillListColors = pc): string {
  const skills = registry.list();
  return skills.length === 0
    ? "No active skills. Restart CodeN after adding standard .agents/skills entries.\n"
    : `${skills.map((skill) => `${colors.bold(skill.name)} (${skill.scope}): ${skill.description}`).join("\n")}\n`;
}
