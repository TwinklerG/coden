import { cp, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { ToolDefinition } from "../../src/core/types.js";
import {
  composePackageRegistry,
  InstalledPluginLoader,
} from "../../src/plugins/installed-loader.js";
import { serializePluginManifest } from "../../src/plugins/manifest.js";
import { readInstalledPackageMetadata } from "../../src/plugins/package-metadata.js";
import { resolvePluginPaths } from "../../src/plugins/paths.js";
import { builtinTools } from "../../src/tools/builtin/index.js";

it("accepts an in-package JavaScript entry", async () => {
  const runtime = await makeInstalledPackage(
    {
      name: "@acme/ok",
      version: "1.0.0",
      type: "module",
      coden: { apiVersion: 1, plugin: "./dist/index.js" },
    },
    {
      "dist/index.js": "export default {};\n",
    },
  );
  const metadata = await readInstalledPackageMetadata(runtime, "@acme/ok");
  expect(metadata.version).toBe("1.0.0");
  expect(metadata.entryPath.endsWith(path.join("dist", "index.js"))).toBe(true);
});

describe("installed package metadata", () => {
  it.each([
    [{ name: "@acme/bad", version: "1.0.0", type: "module" }, "plugin.metadata_missing"],
    [
      {
        name: "@acme/bad",
        version: "1.0.0",
        type: "commonjs",
        coden: { apiVersion: 1, plugin: "./dist/index.js" },
      },
      "plugin.metadata_missing",
    ],
    [
      {
        name: "@acme/bad",
        version: "1.0.0",
        type: "module",
        coden: { apiVersion: 2, plugin: "./dist/index.js" },
      },
      "plugin.api_unsupported",
    ],
    [
      {
        name: "@acme/bad",
        version: "1.0.0",
        type: "module",
        coden: { apiVersion: 1, plugin: "../escape.js" },
      },
      "plugin.entry_invalid",
    ],
    [
      {
        name: "@acme/bad",
        version: "1.0.0",
        type: "module",
        coden: { apiVersion: 1, plugin: "./src/index.ts" },
      },
      "plugin.entry_invalid",
    ],
  ])("rejects invalid metadata", async (packageJson, code) => {
    const runtime = await makeInstalledPackage(packageJson);
    await expect(readInstalledPackageMetadata(runtime, "@acme/bad")).rejects.toThrow(code);
  });

  it("rejects an entry that resolves outside the package boundary", async () => {
    const runtime = await mkdtemp(path.join(os.tmpdir(), "coden-plugin-meta-"));
    const packageDir = path.join(runtime, "node_modules", "@acme", "escape");
    const outside = path.join(runtime, "outside");
    await mkdir(path.join(runtime, "node_modules", "@acme"), { recursive: true });
    await mkdir(outside, { recursive: true });
    await writeFile(path.join(outside, "escape.js"), "export default {};\n", "utf8");
    await mkdir(packageDir, { recursive: true });
    await writeFile(
      path.join(packageDir, "package.json"),
      `${JSON.stringify(
        {
          name: "@acme/escape",
          version: "1.0.0",
          type: "module",
          coden: { apiVersion: 1, plugin: "../outside/escape.js" },
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
    await expect(readInstalledPackageMetadata(runtime, "@acme/escape")).rejects.toThrow(
      /plugin.entry_invalid/,
    );
  });
});

describe("installed npm package loading", () => {
  it("loads single, multi, and dependency-backed package exports", async () => {
    const scope = await copyFixtureRuntime([
      "@fixtures/single-tool",
      "@fixtures/multi-tool",
      "@fixtures/with-dependency",
    ]);
    const result = await new InstalledPluginLoader().loadScope(scope);
    expect(result.failed).toEqual([]);
    expect(result.loaded.map((plugin) => [plugin.packageName, plugin.tools.length])).toEqual([
      ["@fixtures/multi-tool", 2],
      ["@fixtures/single-tool", 1],
      ["@fixtures/with-dependency", 1],
    ]);
    const dependencyTool = result.loaded.find((item) =>
      item.packageName.endsWith("with-dependency"),
    )?.tools[0];
    if (!dependencyTool) throw new Error("dependency tool missing");
    expect(
      await dependencyTool.execute(
        {},
        { workspace: "/work", signal: new AbortController().signal },
      ),
    ).toMatchObject({ content: "from dependency" });
  });

  it("isolates one invalid package without blocking valid siblings", async () => {
    const scope = await copyFixtureRuntime([
      "@fixtures/single-tool",
      "@fixtures/missing-metadata",
      "@fixtures/multi-tool",
    ]);
    const result = await new InstalledPluginLoader().loadScope(scope);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0]).toMatchObject({ packageName: "@fixtures/missing-metadata" });
    expect(result.loaded.map((plugin) => plugin.packageName)).toEqual([
      "@fixtures/multi-tool",
      "@fixtures/single-tool",
    ]);
  });

  it("lets a project package shadow the same global package before tool registration", () => {
    const global = packageResult("@fixtures/same", "1.0.0", "global_tool");
    const project = packageResult("@fixtures/same", "2.0.0", "project_tool");
    const composed = composePackageRegistry(builtinTools(), [global], [project]);
    expect(composed.registry.get("global_tool")).toBeUndefined();
    expect(composed.registry.get("project_tool")).toBeDefined();
    expect(composed.shadowed).toEqual([
      { packageName: "@fixtures/same", globalVersion: "1.0.0", projectVersion: "2.0.0" },
    ]);
    expect(composed.effective.map((plugin) => plugin.packageName)).toEqual(["@fixtures/same"]);
  });

  it("reports tool conflicts with both package versions", () => {
    const left = packageResult("@fixtures/left", "1.0.0", "shared_tool");
    const right = packageResult("@fixtures/right", "2.0.0", "shared_tool");
    expect(() => composePackageRegistry(builtinTools(), [left], [right])).toThrow(
      /@fixtures\/left@1\.0\.0.*@fixtures\/right@2\.0\.0/s,
    );
  });

  it("reports builtin-vs-npm conflicts with both sources", () => {
    const npmPlugin = packageResult("@fixtures/shadow-read", "3.1.4", "read");
    expect(() => composePackageRegistry(builtinTools(), [npmPlugin], [])).toThrow(
      /plugin\.tool_conflict: read from builtin conflicts with @fixtures\/shadow-read@3\.1\.4/s,
    );
  });
});

async function copyFixtureRuntime(
  packageNames: string[],
): Promise<ReturnType<typeof resolvePluginPaths>> {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "coden-plugin-runtime-"));
  const paths = resolvePluginPaths(workspace, "project", path.join(workspace, "data"));
  await mkdir(path.dirname(paths.manifestPath), { recursive: true });
  await mkdir(path.join(paths.runtimeDir, "node_modules"), { recursive: true });

  for (const packageName of packageNames) {
    const fixtureDir = fixturePath(packageName);
    const targetDir = path.join(paths.runtimeDir, "node_modules", ...packageName.split("/"));
    await cp(fixtureDir, targetDir, { recursive: true });
  }

  await writeFile(
    paths.manifestPath,
    serializePluginManifest({
      schemaVersion: 1,
      plugins: Object.fromEntries(
        [...packageNames]
          .sort()
          .map((packageName) => [packageName, { source: "npm" as const, requested: "latest" }]),
      ),
    }),
    "utf8",
  );

  return paths;
}

function fixturePath(packageName: string): string {
  const shortName = packageName.replace(/^@fixtures\//, "");
  const nestedInvalidFixtures = new Set(["missing-metadata", "unsupported-api", "escaped-entry"]);
  return path.join(
    process.cwd(),
    "test",
    "fixtures",
    "npm-plugins",
    nestedInvalidFixtures.has(shortName) ? "invalid" : "",
    shortName,
  );
}

function packageResult(packageName: string, version: string, ...toolNames: string[]) {
  return {
    packageName,
    version,
    entryPath: path.join("/virtual", packageName.replace(/^@/, ""), version),
    tools: toolNames.map(makeTool),
  };
}

function makeTool(name: string): ToolDefinition {
  return {
    name,
    description: `${name} tool`,
    inputSchema: { type: "object" },
    risk: "read",
    async execute() {
      return { content: name };
    },
  };
}

async function makeInstalledPackage(
  packageJson: Record<string, unknown>,
  files: Record<string, string> = {},
): Promise<string> {
  const runtime = await mkdtemp(path.join(os.tmpdir(), "coden-plugin-meta-"));
  const packageName = typeof packageJson.name === "string" ? packageJson.name : "@acme/bad";
  const packageDir = path.join(runtime, "node_modules", ...packageName.split("/"));
  await mkdir(packageDir, { recursive: true });
  await writeFile(
    path.join(packageDir, "package.json"),
    `${JSON.stringify(packageJson, null, 2)}\n`,
    "utf8",
  );
  for (const [relativeFile, content] of Object.entries(files)) {
    const absoluteFile = path.join(packageDir, relativeFile);
    await mkdir(path.dirname(absoluteFile), { recursive: true });
    await writeFile(absoluteFile, content, "utf8");
  }
  return runtime;
}
