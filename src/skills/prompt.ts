import pc from "picocolors";
import { I18n } from "../i18n/i18n.js";
import type { SkillRegistry } from "./registry.js";

interface SkillListColors {
  bold(text: string): string;
}

export function formatSkillCatalog(registry: SkillRegistry, i18n: I18n = new I18n("en")): string {
  const skills = registry.list();
  if (skills.length === 0) return "";
  return `${i18n.messages.skills.catalogTitle}\n${skills.map((skill) => `- ${skill.name}: ${skill.description}`).join("\n")}\n\n${i18n.messages.skills.activateHint}`;
}
export function formatSkillsList(
  registry: SkillRegistry,
  colors: SkillListColors = pc,
  i18n: I18n = new I18n("en"),
): string {
  const skills = registry.list();
  return skills.length === 0
    ? i18n.messages.skills.none
    : `${skills.map((skill) => `${colors.bold(skill.name)} (${skill.scope}): ${skill.description}`).join("\n")}\n`;
}
