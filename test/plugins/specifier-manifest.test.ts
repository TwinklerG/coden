import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  readPluginManifest,
  runtimePackageJson,
  serializePluginManifest,
} from "../../src/plugins/manifest.js";
import { resolvePluginPaths } from "../../src/plugins/paths.js";
import { parseNpmPluginSpecifier } from "../../src/plugins/specifier.js";

it.each([
  ["npm:hello", { packageName: "hello", requested: "latest" }],
  ["npm:hello@1.2.0", { packageName: "hello", requested: "1.2.0" }],
  ["npm:@scope/hello", { packageName: "@scope/hello", requested: "latest" }],
  ["npm:@scope/hello@^2.0.0", { packageName: "@scope/hello", requested: "^2.0.0" }],
])("parses %s", (raw, expected) => {
  expect(parseNpmPluginSpecifier(raw)).toMatchObject({ source: "npm", raw, ...expected });
});

it.each([
  "hello",
  "git:https://example.test/p.git",
  "file:../plugin",
  "npm:",
  "npm:../bad",
  "npm:hello@github:user/repo",
  "npm:@scope/hello@github:user/repo",
  "npm:@scope/hello@github/user/repo",
])("rejects unsupported or invalid source %s", (raw) =>
  expect(() => parseNpmPluginSpecifier(raw)).toThrow(/plugin.specifier_invalid/),
);

it("derives project and global scope paths", () => {
  expect(resolvePluginPaths("/work", "project", "/data")).toMatchObject({
    root: path.join("/work", ".coden"),
    manifestPath: path.join("/work", ".coden", "plugins.json"),
    runtimeDir: path.join("/work", ".coden", "plugin-runtime"),
    lockPath: path.join("/work", ".coden", "plugin-lock"),
    transactionPath: path.join("/work", ".coden", "plugin-transaction.json"),
  });
  expect(resolvePluginPaths("/work", "global", "/data")).toMatchObject({
    root: path.join("/data", "plugins"),
    runtimeDir: path.join("/data", "plugins", "runtime"),
    lockPath: path.join("/data", "plugins", "plugin-lock"),
    transactionPath: path.join("/data", "plugins", "plugin-transaction.json"),
  });
});

it("serializes manifests and runtime dependencies deterministically", () => {
  const manifest = {
    schemaVersion: 1 as const,
    plugins: {
      zed: { source: "npm" as const, requested: "latest" },
      alpha: { source: "npm" as const, requested: "^1" },
    },
  };
  expect(Object.keys(JSON.parse(serializePluginManifest(manifest)).plugins)).toEqual([
    "alpha",
    "zed",
  ]);
  expect(runtimePackageJson(manifest)).toEqual({
    private: true,
    dependencies: { alpha: "^1", zed: "latest" },
  });
});

describe("plugin manifests", () => {
  it("reads a missing manifest as empty", async () => {
    const workspace = await mkdtempPath();
    await expect(readPluginManifest(path.join(workspace, "plugins.json"))).resolves.toEqual({
      schemaVersion: 1,
      plugins: {},
    });
  });

  it.each([
    ["{", "plugin.manifest_invalid"],
    [JSON.stringify({ schemaVersion: 2, plugins: {} }), "plugin.manifest_invalid"],
    [
      JSON.stringify({ schemaVersion: 1, plugins: { Invalid: { source: "npm", requested: "1" } } }),
      "plugin.manifest_invalid",
    ],
    [
      JSON.stringify({ schemaVersion: 1, plugins: { hello: { source: "npm", requested: 1 } } }),
      "plugin.manifest_invalid",
    ],
  ])("rejects malformed manifest %s", async (content, code) => {
    const workspace = await mkdtempPath();
    const file = path.join(workspace, "plugins.json");
    await writeFile(file, `${content}\n`, "utf8");
    await expect(readPluginManifest(file)).rejects.toThrow(code);
  });

  it("writes sorted JSON with a trailing newline", async () => {
    const workspace = await mkdtempPath();
    const file = path.join(workspace, "plugins.json");
    await writeFile(
      file,
      serializePluginManifest({
        schemaVersion: 1,
        plugins: {
          zed: { source: "npm", requested: "latest" },
          alpha: { source: "npm", requested: "^1" },
        },
      }),
      "utf8",
    );
    const content = await readFile(file, "utf8");
    expect(content.endsWith("\n")).toBe(true);
  });
});

async function mkdtempPath(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), "coden-plugin-manifest-"));
}
