import { describe, expect, it, vi } from "vitest";
import { executeReplCommand, formatThinkingStatus } from "../src/cli/repl-command.js";
import { I18n } from "../src/i18n/i18n.js";
import { SkillRegistry } from "../src/skills/registry.js";
import { ToolRegistry } from "../src/tools/registry.js";

function dependencies() {
  const runtime = { compact: vi.fn(async () => {}), reset: vi.fn(async () => {}) };
  const reload = vi.fn(async () => ({ registry: new ToolRegistry(), loaded: [], failed: [] }));
  const switchLanguage = vi.fn(async (language: "zh" | "en") => i18n.setLanguage(language));
  const getThinkingStatus = vi.fn(() => ({
    level: "medium" as const,
    effectiveLevel: "medium" as const,
    displayLevel: "medium",
  }));
  const switchThinkingLevel = vi.fn(async () => ({
    level: "off" as const,
    effectiveLevel: "minimal" as const,
    displayLevel: "off→minimal",
  }));
  const i18n = new I18n("en");
  return {
    value: {
      runtime,
      session: { sessionId: "session", list: async () => [] },
      registry: new ToolRegistry(),
      skills: new SkillRegistry(),
      reload,
      switchLanguage,
      getThinkingStatus,
      switchThinkingLevel,
      i18n,
    },
    runtime,
    reload,
    switchLanguage,
    getThinkingStatus,
    switchThinkingLevel,
  };
}

describe("shared REPL commands", () => {
  it("keeps messages and multiline command-like input unchanged", async () => {
    const deps = dependencies();
    await expect(executeReplCommand("  hello  ", deps.value)).resolves.toEqual({
      type: "message",
      text: "  hello  ",
    });
    await expect(executeReplCommand("/help\nmore", deps.value)).resolves.toEqual({
      type: "message",
      text: "/help\nmore",
    });
  });

  it("executes lifecycle commands once", async () => {
    const deps = dependencies();
    await expect(executeReplCommand("/compact", deps.value)).resolves.toMatchObject({
      type: "output",
    });
    await expect(executeReplCommand("/new", deps.value)).resolves.toMatchObject({ type: "output" });
    await expect(executeReplCommand("/reload", deps.value)).resolves.toMatchObject({
      type: "output",
    });
    expect(deps.runtime.compact).toHaveBeenCalledOnce();
    expect(deps.runtime.reset).toHaveBeenCalledOnce();
    expect(deps.reload).toHaveBeenCalledOnce();
  });

  it("handles language and exit commands", async () => {
    const deps = dependencies();
    await expect(executeReplCommand("/lang zh", deps.value)).resolves.toMatchObject({
      type: "output",
    });
    expect(deps.switchLanguage).toHaveBeenCalledWith("zh");
    await expect(executeReplCommand("/lang xx", deps.value)).resolves.toMatchObject({
      type: "output",
    });
    await expect(executeReplCommand("/quit", deps.value)).resolves.toEqual({ type: "exit" });
  });

  it("reports configured and effective thinking levels separately", () => {
    expect(
      formatThinkingStatus(
        {
          level: "off",
          effectiveLevel: "minimal",
          displayLevel: "off→minimal",
        },
        new I18n("en"),
      ),
    ).toContain("Current: off\nEffective: off→minimal");
  });

  it("queries, switches, and rejects thinking levels", async () => {
    const deps = dependencies();
    await expect(executeReplCommand("/thinking", deps.value)).resolves.toMatchObject({
      type: "output",
      text: expect.stringContaining("medium"),
    });
    await expect(executeReplCommand("/thinking off", deps.value)).resolves.toMatchObject({
      type: "output",
      text: expect.stringContaining("off→minimal"),
    });
    expect(deps.switchThinkingLevel).toHaveBeenCalledWith("off");
    await expect(executeReplCommand("/thinking extreme", deps.value)).resolves.toMatchObject({
      type: "output",
      text: expect.stringContaining("Unsupported thinking level"),
    });
    await expect(executeReplCommand("/thinking high\ntext", deps.value)).resolves.toEqual({
      type: "message",
      text: "/thinking high\ntext",
    });
  });
});
