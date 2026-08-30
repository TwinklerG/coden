import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { afterEach, describe, expect, it } from "vitest";
import { SkillDiscovery } from "../src/skills/discovery.js";

const workspace = fileURLToPath(new URL("..", import.meta.url));
const skillRoot = path.join(workspace, ".agents", "skills", "coden-tool-plugin-development");
const temporaryDirectories: string[] = [];

async function resource(relativePath: string): Promise<string> {
  return readFile(path.join(skillRoot, relativePath), "utf8");
}

function transpile(source: string): ts.TranspileOutput {
  return ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      strict: true,
    },
    reportDiagnostics: true,
  });
}

function syntaxErrors(source: string): string[] {
  return (transpile(source).diagnostics ?? [])
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
    expect(template).toContain('import type { ToolDefinition } from "@twinklerg/coden/plugin"');
    expect(template).toContain('risk: "read"');
    expect(template).not.toMatch(/from\s+["']\.\.?\//);
    expect(syntaxErrors(template)).toEqual([]);
    expect(gitignore).toContain(".agents/skills/*");
    expect(gitignore).toContain("!.agents/skills/coden-tool-plugin-development/");
    expect(gitignore).toContain("!.agents/skills/coden-tool-plugin-development/**");
  });

  it("documents and templates valid npm single-tool and multi-tool packages", async () => {
    const [skill, guide, single, multi, packageText, tsconfigText, rootPackageText] =
      await Promise.all([
        resource("SKILL.md"),
        resource("references/npm-plugin.md"),
        resource("assets/npm-single-tool.ts"),
        resource("assets/npm-multi-tool.ts"),
        resource("assets/npm-package.json"),
        resource("assets/npm-tsconfig.json"),
        readFile(path.join(workspace, "package.json"), "utf8"),
      ]);
    const packageTemplate = JSON.parse(packageText) as {
      name: string;
      type: string;
      files: string[];
      coden: { apiVersion: number; plugin: string };
      devDependencies: Record<string, string>;
    };
    const rootPackage = JSON.parse(rootPackageText) as { version: string };

    expect(skill).toContain("references/npm-plugin.md");
    expect(skill).toContain("assets/npm-single-tool.ts");
    expect(skill).toContain("assets/npm-multi-tool.ts");
    expect(guide).toContain("npm pack --dry-run");
    expect(guide).toContain("coden plugin install npm:");
    expect(guide).toContain("公开 npmjs");
    expect(packageTemplate).toMatchObject({
      name: "@scope/coden-plugin-example",
      type: "module",
      files: ["dist"],
      coden: { apiVersion: 1, plugin: "./dist/index.js" },
    });
    expect(packageTemplate.devDependencies["@twinklerg/coden"]).toBe(`^${rootPackage.version}`);
    expect(JSON.parse(tsconfigText)).toMatchObject({
      compilerOptions: {
        target: "ES2022",
        module: "ESNext",
        moduleResolution: "Bundler",
        strict: true,
      },
      include: ["src/**/*.ts"],
    });
    expect(single).toContain('import type { ToolDefinition } from "@twinklerg/coden/plugin"');
    expect(multi).toContain(
      'import type { CodeNPlugin, ToolDefinition } from "@twinklerg/coden/plugin"',
    );
    expect(multi).toContain("apiVersion: 1");
    expect(multi).toContain('name: "@scope/coden-plugin-example"');
    expect(single).not.toMatch(/from\s+["']\.\.?\//);
    expect(multi).not.toMatch(/from\s+["']\.\.?\//);
    expect(syntaxErrors(single)).toEqual([]);
    expect(syntaxErrors(multi)).toEqual([]);

    const emittedSingle = transpile(single).outputText;
    const emittedMulti = transpile(multi).outputText;
    expect(emittedSingle).not.toContain("@twinklerg/coden");
    expect(emittedMulti).not.toContain("@twinklerg/coden");

    const [singleModule, multiModule] = await Promise.all([
      import(`data:text/javascript;base64,${Buffer.from(emittedSingle).toString("base64")}`),
      import(`data:text/javascript;base64,${Buffer.from(emittedMulti).toString("base64")}`),
    ]);
    expect(singleModule.default).toMatchObject({ name: "example_echo", risk: "read" });
    const plugin = multiModule.default as {
      apiVersion: number;
      name: string;
      tools: Array<{
        name: string;
        execute(
          input: unknown,
          context: { workspace: string; signal: AbortSignal },
        ): Promise<{
          content: string;
          isError?: boolean;
        }>;
      }>;
    };
    expect(plugin).toMatchObject({ apiVersion: 1, name: "@scope/coden-plugin-example" });
    const readTool = plugin.tools.find((tool) => tool.name === "example_read");
    expect(readTool).toBeDefined();
    await expect(
      readTool?.execute({ key: "" }, { workspace, signal: new AbortController().signal }),
    ).resolves.toMatchObject({ isError: true });
  });
});
