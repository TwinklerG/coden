import type { AgentRuntime } from "../core/runtime.js";
import { isThinkingLevel, THINKING_LEVELS, type ThinkingLevel } from "../core/thinking.js";
import type { I18n } from "../i18n/i18n.js";
import type { Language } from "../i18n/language.js";
import type { ThinkingStatus } from "../providers/thinking.js";
import type { SessionStore } from "../sessions/store.js";
import { formatSkillsList } from "../skills/prompt.js";
import type { SkillRegistry } from "../skills/registry.js";
import type { PluginLoadResult } from "../tools/plugin-loader.js";
import type { ToolRegistry } from "../tools/registry.js";
import { formatSessionList } from "./format.js";

const REPL_COMMANDS = new Set([
  "/help",
  "/skills",
  "/session",
  "/sessions",
  "/compact",
  "/reload",
  "/new",
  "/quit",
]);

export type ClassifiedReplInput =
  | { type: "empty" }
  | { type: "command"; command: string }
  | { type: "language"; language?: string }
  | { type: "thinking"; level?: string }
  | { type: "message"; text: string };

export type ReplCommandResult =
  | { type: "output"; text: string }
  | { type: "exit" }
  | { type: "message"; text: string }
  | { type: "empty" };

export interface ReplCommandDependencies {
  runtime: Pick<AgentRuntime, "compact" | "reset">;
  session: Pick<SessionStore, "list" | "sessionId">;
  registry: Pick<ToolRegistry, "list">;
  skills: SkillRegistry;
  reload(): Promise<PluginLoadResult>;
  switchLanguage(language: Language): Promise<void>;
  getThinkingStatus(): ThinkingStatus;
  switchThinkingLevel(level: ThinkingLevel): Promise<ThinkingStatus>;
  i18n: I18n;
}

export function classifyReplInput(text: string): ClassifiedReplInput {
  if (!text.trim()) return { type: "empty" };
  const trimmed = text.trim();
  if (!text.includes("\n") && (trimmed === "/lang" || trimmed.startsWith("/lang "))) {
    const language = trimmed.slice("/lang".length).trim();
    return language ? { type: "language", language } : { type: "language" };
  }
  if (!text.includes("\n") && (trimmed === "/thinking" || trimmed.startsWith("/thinking "))) {
    const level = trimmed.slice("/thinking".length).trim();
    return level ? { type: "thinking", level } : { type: "thinking" };
  }
  if (!text.includes("\n") && REPL_COMMANDS.has(trimmed)) {
    return { type: "command", command: trimmed };
  }
  return { type: "message", text };
}

export async function executeReplCommand(
  text: string,
  dependencies: ReplCommandDependencies,
): Promise<ReplCommandResult> {
  const input = classifyReplInput(text);
  if (input.type === "empty") return input;
  if (input.type === "message") return input;
  const { i18n } = dependencies;
  if (input.type === "language") {
    if (!input.language) return { type: "output", text: formatLanguageList(i18n) };
    if (input.language !== "zh" && input.language !== "en") {
      return {
        type: "output",
        text: `${i18n.messages.language.invalid(input.language)}\n${formatLanguageList(i18n)}`,
      };
    }
    try {
      await dependencies.switchLanguage(input.language);
      return {
        type: "output",
        text: `${i18n.messages.language.changed(i18n.displayName(input.language))}\n`,
      };
    } catch (error) {
      return {
        type: "output",
        text: `${i18n.messages.language.saveFailed(error instanceof Error ? error.message : String(error))}\n`,
      };
    }
  }

  if (input.type === "thinking") {
    if (!input.level)
      return { type: "output", text: formatThinkingStatus(dependencies.getThinkingStatus(), i18n) };
    if (!isThinkingLevel(input.level)) {
      return {
        type: "output",
        text: `${i18n.messages.thinking.invalid(input.level)}
${formatThinkingStatus(dependencies.getThinkingStatus(), i18n)}`,
      };
    }
    try {
      const status = await dependencies.switchThinkingLevel(input.level);
      return {
        type: "output",
        text: `${i18n.messages.thinking.changed(status.displayLevel)}
${formatThinkingStatus(status, i18n)}`,
      };
    } catch (error) {
      return {
        type: "output",
        text: `${i18n.messages.thinking.switchFailed(error instanceof Error ? error.message : String(error))}
`,
      };
    }
  }

  switch (input.command) {
    case "/quit":
      return { type: "exit" };
    case "/help":
      return { type: "output", text: i18n.messages.repl.help };
    case "/skills":
      return { type: "output", text: formatSkillsList(dependencies.skills, undefined, i18n) };
    case "/sessions":
      return {
        type: "output",
        text: formatSessionList(
          await dependencies.session.list(),
          dependencies.session.sessionId,
          i18n,
        ),
      };
    case "/session":
      return { type: "output", text: `${dependencies.session.sessionId}\n` };
    case "/compact": {
      const result = await dependencies.runtime.compact();
      if (result.status === "compacted")
        return { type: "output", text: i18n.messages.repl.compacted };
      const reason = i18n.messages.repl.compactFailureReasons[result.reason];
      return { type: "output", text: i18n.messages.repl.compactFailed(reason) };
    }
    case "/new":
      await dependencies.runtime.reset();
      return { type: "output", text: i18n.messages.repl.newConversation };
    case "/reload": {
      const result = await dependencies.reload();
      return {
        type: "output",
        text: i18n.messages.repl.loaded(
          result.loaded.join(", "),
          result.failed.length,
          dependencies.registry
            .list()
            .map((tool) => tool.name)
            .join(", "),
        ),
      };
    }
    default:
      return { type: "message", text };
  }
}

export function formatLanguageList(i18n: I18n): string {
  const lines = i18n.supportedLanguages.map((language) => {
    const marker = language === i18n.currentLanguage ? "*" : " ";
    const current =
      language === i18n.currentLanguage ? `（${i18n.messages.language.current}）` : "";
    return `${marker} ${language} - ${i18n.displayName(language)}${current}`;
  });
  return `${i18n.messages.language.supported}\n${lines.join("\n")}\n${i18n.messages.language.usage}\n`;
}

export function formatThinkingStatus(status: ThinkingStatus, i18n: I18n): string {
  const m = i18n.messages.thinking;
  const lines = [
    m.supported,
    ...THINKING_LEVELS.map((level) => `${level === status.level ? "*" : " "} ${level}`),
    m.current(status.level),
  ];
  if (status.effectiveLevel !== status.level) lines.push(m.effective(status.displayLevel));
  if (status.budgetTokens !== undefined) lines.push(m.budget(status.budgetTokens));
  lines.push(m.usage);
  return `${lines.join("\n")}\n`;
}
