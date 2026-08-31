import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ContextManager } from "../src/context/manager.js";
import { EventBus } from "../src/core/events.js";
import { AgentRuntime } from "../src/core/runtime.js";
import { resolveStartupLanguage, saveUserLanguage } from "../src/i18n/config.js";
import { I18n } from "../src/i18n/i18n.js";
import { DEFAULT_LANGUAGE, SUPPORTED_LANGUAGES } from "../src/i18n/language.js";
import { buildSystemPrompt } from "../src/i18n/prompts.js";
import { PermissionPolicy } from "../src/permissions/policy.js";
import { ScriptedProvider, scriptedText } from "../src/providers/scripted.js";
import { SessionStore } from "../src/sessions/store.js";
import { builtinTools } from "../src/tools/builtin/index.js";
import { ToolExecutor } from "../src/tools/executor.js";
import { ToolRegistry } from "../src/tools/registry.js";

describe("i18n", () => {
  it("uses a stable Chinese default and switches existing references", () => {
    expect(DEFAULT_LANGUAGE).toBe("zh");
    expect(SUPPORTED_LANGUAGES).toEqual(["zh", "en"]);
    const i18n = new I18n();
    expect(i18n.messages.cli.description).toContain("极简");
    expect(i18n.messages.cli.tui).toContain("TUI");
    expect(i18n.messages.tui.phases.reviewing).toBe("审查中");
    i18n.setLanguage("en");
    expect(i18n.messages.cli.description).toContain("minimal");
    expect(i18n.messages.cli.legacyCli).toContain("default");
    expect(i18n.messages.tui.phases.reviewing).toBe("reviewing");
  });

  it("resolves CLI over user preference and respects --", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "coden-lang-"));
    const config = path.join(root, "config.json");
    await writeFile(config, '{"language":"zh"}');
    await expect(
      resolveStartupLanguage(["node", "coden", "--lang=en"], config),
    ).resolves.toMatchObject({ language: "en" });
    await expect(
      resolveStartupLanguage(["node", "coden", "--", "--lang=en"], config),
    ).resolves.toMatchObject({ language: "zh" });
  });

  it("atomically preserves config fields with newline and 0600 mode", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "coden-lang-"));
    const config = path.join(root, "config.json");
    await writeFile(config, '{"unknown":42,"language":"zh"}');
    await saveUserLanguage("en", config);
    const raw = await readFile(config, "utf8");
    expect(JSON.parse(raw)).toEqual({ unknown: 42, language: "en" });
    expect(raw.endsWith("\n")).toBe(true);
    expect((await stat(config)).mode & 0o777).toBe(0o600);
  });

  it("builds complete bilingual prompts without translating project content", () => {
    const i18n = new I18n("zh");
    const zh = buildSystemPrompt(i18n, "KEEP PROJECT TEXT", "SKILL AUTHOR TEXT");
    expect(zh).toContain("AGENTS.md");
    expect(zh).toContain("activate_skill");
    expect(zh).toContain("KEEP PROJECT TEXT");
    i18n.setLanguage("en");
    const en = buildSystemPrompt(i18n, "KEEP PROJECT TEXT", "SKILL AUTHOR TEXT");
    expect(en).toContain("Do not guess");
    expect(en).toContain("KEEP PROJECT TEXT");
  });

  it("updates only the main system message and preserves it across reset", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "coden-runtime-i18n-"));
    const registry = new ToolRegistry(builtinTools());
    const events = new EventBus();
    const runtime = new AgentRuntime(
      new ScriptedProvider([scriptedText("ok")]),
      registry,
      new ToolExecutor(registry, new PermissionPolicy("auto"), events, workspace),
      new ContextManager({ contextWindow: 10_000, reservedOutputTokens: 200, safetyMargin: 100 }),
      new SessionStore(workspace, workspace, "lang-test"),
      events,
      { model: "scripted", systemPrompt: "old" },
      [
        { role: "system", content: "old" },
        { role: "user", content: "history" },
      ],
    );
    runtime.updateSystemPrompt("new");
    expect(runtime.messages).toEqual([
      { role: "system", content: "new" },
      { role: "user", content: "history" },
    ]);
    await runtime.reset();
    expect(runtime.messages).toEqual([{ role: "system", content: "new" }]);
  });

  it("localizes built-ins without changing machine names or schemas", () => {
    const zh = builtinTools(undefined, new I18n("zh"));
    const en = builtinTools(undefined, new I18n("en"));
    expect(zh.map((tool) => tool.name)).toEqual(en.map((tool) => tool.name));
    expect(zh.map((tool) => tool.inputSchema)).toEqual(en.map((tool) => tool.inputSchema));
    expect(zh[0]?.description).not.toBe(en[0]?.description);
  });
});
