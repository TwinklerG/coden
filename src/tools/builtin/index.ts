import type { ToolDefinition } from "../../core/types.js";
import { I18n } from "../../i18n/i18n.js";
import { SkillRegistry } from "../../skills/registry.js";
import { createActivateSkillTool } from "./activate-skill.js";
import { createBashTool } from "./bash.js";
import { createEditTool } from "./edit.js";
import { createReadTool } from "./read.js";
import { createWriteTool } from "./write.js";

export function builtinTools(
  skills: SkillRegistry = new SkillRegistry(),
  i18n: I18n = new I18n("en"),
): ToolDefinition[] {
  return [
    createReadTool(i18n),
    createWriteTool(i18n),
    createEditTool(i18n),
    createBashTool(i18n),
    createActivateSkillTool(skills, i18n),
  ];
}
