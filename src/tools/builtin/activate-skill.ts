import type { ToolDefinition } from "../../core/types.js";
import { I18n } from "../../i18n/i18n.js";
import { SkillActivationError, type SkillRegistry } from "../../skills/registry.js";

export function createActivateSkillTool(
  skills: SkillRegistry,
  i18n: I18n = new I18n("en"),
): ToolDefinition {
  return {
    name: "activate_skill",
    description: i18n.messages.tools.activateSkill,
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
        return {
          content: `${i18n.messages.skills.root(activated.skill.rootRealPath)}\n\n${activated.content}`,
        };
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
