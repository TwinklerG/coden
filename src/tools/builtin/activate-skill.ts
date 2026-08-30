import type { ToolDefinition } from "../../core/types.js";
import { SkillActivationError, type SkillRegistry } from "../../skills/registry.js";

export function createActivateSkillTool(skills: SkillRegistry): ToolDefinition {
  return {
    name: "activate_skill",
    description: "Load full instructions for one available Agent Skill by name.",
    risk: "read",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["name"],
      properties: { name: { type: "string", minLength: 1, maxLength: 64 } },
    },
    async execute(input) {
      const { name } = input as { name: string };
      try {
        const activated = await skills.activate(name);
        return { content: `Skill root: ${activated.skill.rootRealPath}\n\n${activated.content}` };
      } catch (error) {
        if (error instanceof SkillActivationError)
          return { content: `${error.code}: ${error.message}`, isError: true };
        return {
          content: `skill.activation_failed: ${error instanceof Error ? error.message : String(error)}`,
          isError: true,
        };
      }
    },
  };
}
