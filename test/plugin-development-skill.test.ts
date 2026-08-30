import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { afterEach, describe, expect, it } from "vitest";
import { SkillDiscovery } from "../src/skills/discovery.js";

const workspace = fileURLToPath(new URL("..", import.meta.url));
const skillRoot = path.join(
  workspace,
  ".agents",
  "skills",
  "coden-tool-plugin-development",
);
const temporaryDirectories: string[] = [];

async function resource(relativePath: string): Promise<string> {
  return readFile(path.join(skillRoot, relativePath), "utf8");
}

function syntaxErrors(source: string): string[] {
  const result = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      strict: true,
    },
    reportDiagnostics: true,
  });
  return (result.diagnostics ?? [])
    .filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error)
    .map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"));
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("CodeN tool plugin development skill", () => {
  it("is tracked as a discoverable project skill with progressive local guidance", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "coden-plugin-skill-home-"));
    temporaryDirectories.push(home);
    const discovery = await new SkillDiscovery({ workspace, home }).discover();
    const skill = discovery.registry.get("coden-tool-plugin-development");

    expect(skill).toMatchObject({
      name: "coden-tool-plugin-development",
      scope: "project",
      license: "MIT",
    });
    expect(skill?.description).toContain("CodeN");
    expect(skill?.description).toContain("local TypeScript");
    expect(skill?.compatibility).toContain("plugin API v1");
    expect(skill?.compatibility?.length).toBeLessThanOrEqual(500);

    const activated = await discovery.registry.activate("coden-tool-plugin-development");
    expect(activated.content.split("\n").length).toBeLessThan(500);
    expect(activated.content).toContain("references/api-contract.md");
    expect(activated.content).toContain("references/local-plugin.md");
    expect(activated.content).toContain("assets/local-tool.ts");
  });

  it("documents and templates the actual local plugin loader contract", async () => {
    const [api, local, template, gitignore] = await Promise.all([
      resource("references/api-contract.md"),
      resource("references/local-plugin.md"),
      resource("assets/local-tool.ts"),
      readFile(path.join(workspace, ".gitignore"), "utf8"),
    ]);

    expect(api).toContain('export type ToolRisk = "read" | "modify" | "dangerous"');
    expect(api).toContain("signal: AbortSignal");
    expect(api).toContain("CODEN_PLUGIN_API_VERSION = 1");
    expect(local).toContain(".coden/plugins/*.ts");
    expect(local).toContain("自包含单文件");
    expect(local).toContain("/reload");
    expect(template).toContain(
      'import type { ToolDefinition } from "@twinklerg/coden/plugin"',
    );
    expect(template).toContain('risk: "read"');
    expect(template).not.toMatch(/from\s+["']\.\.?\//);
    expect(syntaxErrors(template)).toEqual([]);
    expect(gitignore).toContain(".agents/skills/*");
    expect(gitignore).toContain("!.agents/skills/coden-tool-plugin-development/");
    expect(gitignore).toContain("!.agents/skills/coden-tool-plugin-development/**");
  });
});
