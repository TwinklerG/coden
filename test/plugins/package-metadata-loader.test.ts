import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { readInstalledPackageMetadata } from "../../src/plugins/package-metadata.js";

it("accepts an in-package JavaScript entry", async () => {
  const runtime = await makeInstalledPackage({
    name: "@acme/ok",
    version: "1.0.0",
    type: "module",
    coden: { apiVersion: 1, plugin: "./dist/index.js" },
  }, {
    "dist/index.js": "export default {};\n",
  });
  const metadata = await readInstalledPackageMetadata(runtime, "@acme/ok");
  expect(metadata.version).toBe("1.0.0");
  expect(metadata.entryPath.endsWith(path.join("dist", "index.js"))).toBe(true);
});

describe("installed package metadata", () => {
  it.each([
    [{ name: "@acme/bad", version: "1.0.0", type: "module" }, "plugin.metadata_missing"],
    [{ name: "@acme/bad", version: "1.0.0", type: "commonjs", coden: { apiVersion: 1, plugin: "./dist/index.js" } }, "plugin.metadata_missing"],
    [{ name: "@acme/bad", version: "1.0.0", type: "module", coden: { apiVersion: 2, plugin: "./dist/index.js" } }, "plugin.api_unsupported"],
    [{ name: "@acme/bad", version: "1.0.0", type: "module", coden: { apiVersion: 1, plugin: "../escape.js" } }, "plugin.entry_invalid"],
    [{ name: "@acme/bad", version: "1.0.0", type: "module", coden: { apiVersion: 1, plugin: "./src/index.ts" } }, "plugin.entry_invalid"],
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
      JSON.stringify(
        {
          name: "@acme/escape",
          version: "1.0.0",
          type: "module",
          coden: { apiVersion: 1, plugin: "../outside/escape.js" },
        },
        null,
        2,
      ) + "\n",
      "utf8",
    );
    await expect(readInstalledPackageMetadata(runtime, "@acme/escape")).rejects.toThrow(
      /plugin.entry_invalid/,
    );
  });
});

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
