import type { ToolDefinition } from "../../core/types.js";
import { SkillRegistry } from "../../skills/registry.js";
import { createActivateSkillTool } from "./activate-skill.js";
import { bashTool } from "./bash.js";
import { editTool } from "./edit.js";
import { readTool } from "./read.js";
import { writeTool } from "./write.js";

export function builtinTools(skills: SkillRegistry = new SkillRegistry()): ToolDefinition[] {
  return [readTool, writeTool, editTool, bashTool, createActivateSkillTool(skills)];
}
