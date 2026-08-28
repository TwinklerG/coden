import { constants } from "node:fs";
import { access, cp, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CodeNError } from "../../src/core/types.js";
import { InstalledPluginLoader } from "../../src/plugins/installed-loader.js";
import { PluginInstaller, type PluginOperationOptions } from "../../src/plugins/installer.js";
import { readPluginManifest, serializePluginManifest } from "../../src/plugins/manifest.js";
import type { PackageInstallRequest, PackageManager } from "../../src/plugins/package-manager.js";
import { type PluginPaths, resolvePluginPaths } from "../../src/plugins/paths.js";
import { builtinTools } from "../../src/tools/builtin/index.js";

const projectOptions: PluginOperationOptions = { scope: "project", allowScripts: false };
const globalOptions: PluginOperationOptions = { scope: "global", allowScripts: false };

class FakePackageManager implements PackageManager {
  readonly requests: PackageInstallRequest[] = [];
  failWith?: Error;
  readonly fixtureOverrides = new Map<string, string>();

  async install(request: PackageInstallRequest): Promise<void> {
    this.requests.push(request);
    if (this.failWith) throw this.failWith;
    const packageJson = JSON.parse(
      await readFile(path.join(request.cwd, "package.json"), "utf8"),
    ) as {
      dependencies?: Record<string, string>;
    };
    await materializeFixtureDependencies(
      request.cwd,
      packageJson.dependencies ?? {},
      this.fixtureOverrides,
    );
    await writeFile(path.join(request.cwd, "bun.lock"), "fixture-lock\n", "utf8");
  }
}

describe("PluginInstaller", () => {
  it("installs an npm plugin into project scope with scripts disabled", async () => {
    const harness = await createInstallerHarness();
    const result = await harness.installer.install("npm:@fixtures/single-tool@^1", {
      scope: "project",
      allowScripts: false,
    });

    expect(result.packageName).toBe("@fixtures/single-tool");
    expect(result.version).toBe("1.0.0");
    expect(result.tools).toEqual(["fixture_single"]);
    expect(harness.manager.requests[0]).toMatchObject({
      frozenLockfile: false,
      allowScripts: false,
    });
    expect(await readPluginManifest(harness.projectPaths.manifestPath)).toMatchObject({
      plugins: { "@fixtures/single-tool": { source: "npm", requested: "^1" } },
    });
  });

  it("removes a package by rebuilding the candidate dependency tree", async () => {
    const h = await createInstallerHarness();
    await h.installer.install("npm:@fixtures/single-tool", projectOptions);
    await h.installer.install("npm:@fixtures/multi-tool", projectOptions);

    await h.installer.remove("@fixtures/single-tool", projectOptions);

    const manifest = await readPluginManifest(h.projectPaths.manifestPath);
    expect(Object.keys(manifest.plugins)).toEqual(["@fixtures/multi-tool"]);
    expect(h.manager.requests.at(-1)?.frozenLockfile).toBe(false);
  });

  it("sync uses the committed lockfile and frozen mode", async () => {
    const h = await createInstallerHarness();
    await h.installer.install("npm:@fixtures/single-tool", projectOptions);
    h.manager.requests.length = 0;

    await h.installer.sync(projectOptions);

    expect(h.manager.requests).toHaveLength(1);
    expect(h.manager.requests[0]?.frozenLockfile).toBe(true);
  });

  it("rejects project sync when its lockfile is missing", async () => {
    const h = await createInstallerHarness();
    await seedManifestOnly(h.projectPaths, "@fixtures/single-tool", "latest");

    await expect(h.installer.sync(projectOptions)).rejects.toThrow(/plugin.lock_missing/);
  });

  it("lists requested and resolved versions in package-name order", async () => {
    const h = await createInstallerHarness();
    await h.installer.install("npm:@fixtures/single-tool@^1", projectOptions);
    await h.installer.install("npm:@fixtures/multi-tool@latest", projectOptions);

    const listed = await h.installer.list();

    expect(listed.project.map((item) => [item.packageName, item.requested, item.version])).toEqual([
      ["@fixtures/multi-tool", "latest", "1.0.0"],
      ["@fixtures/single-tool", "^1", "1.0.0"],
    ]);
  });

  it("marks listed global packages shadowed by project package names", async () => {
    const h = await createInstallerHarness();
    await h.installer.install("npm:@fixtures/single-tool@1", globalOptions);
    await h.installer.install("npm:@fixtures/single-tool@2", projectOptions);

    const listed = await h.installer.list();

    expect(listed.global).toMatchObject([
      { packageName: "@fixtures/single-tool", shadowedByProject: true },
    ]);
  });

  it("preserves the old pair when package installation fails", async () => {
    const h = await createInstallerHarness();
    await h.installer.install("npm:@fixtures/single-tool", projectOptions);
    const before = await snapshotScope(h.projectPaths);
    h.manager.failWith = new Error("registry unavailable");

    await expect(h.installer.install("npm:@fixtures/multi-tool", projectOptions)).rejects.toThrow(
      "registry unavailable",
    );

    expect(await snapshotScope(h.projectPaths)).toEqual(before);
  });

  it("preserves the old pair when export validation fails", async () => {
    const h = await createInstallerHarness();
    await h.installer.install("npm:@fixtures/single-tool", projectOptions);
    const before = await snapshotScope(h.projectPaths);
    h.manager.fixtureOverrides.set("@fixtures/invalid-export", "invalid/export");

    await expect(
      h.installer.install("npm:@fixtures/invalid-export", projectOptions),
    ).rejects.toThrow(/plugin.export_invalid/);

    expect(await snapshotScope(h.projectPaths)).toEqual(before);
  });

  it("validates project candidates with effective global packages", async () => {
    const h = await createInstallerHarness();
    await h.installer.install("npm:@fixtures/conflict-global", globalOptions);

    await expect(
      h.installer.install("npm:@fixtures/conflict-project", projectOptions),
    ).rejects.toThrow(/plugin.tool_conflict/);
  });

  it("allows a project package to shadow the same global package during validation", async () => {
    const h = await createInstallerHarness();
    await h.installer.install("npm:@fixtures/conflict-global", globalOptions);

    await expect(
      h.installer.install("npm:@fixtures/conflict-global", projectOptions),
    ).resolves.toMatchObject({ packageName: "@fixtures/conflict-global" });
  });

  it("does not rebuild when the same request is already installed and loadable", async () => {
    const h = await createInstallerHarness();
    await h.installer.install("npm:@fixtures/single-tool@latest", projectOptions);
    h.manager.requests.length = 0;

    const result = await h.installer.install("npm:@fixtures/single-tool", projectOptions);

    expect(result).toMatchObject({ packageName: "@fixtures/single-tool", requested: "latest" });
    expect(h.manager.requests).toEqual([]);
  });

  it("maps frozen lockfile package-manager failures to plugin.lock_outdated", async () => {
    const h = await createInstallerHarness();
    await h.installer.install("npm:@fixtures/single-tool", projectOptions);
    h.manager.failWith = new CodeNError(
      "plugin",
      "plugin.install_failed",
      "bun install failed: lockfile would change with --frozen-lockfile",
    );

    await expect(h.installer.sync(projectOptions)).rejects.toThrow(/plugin.lock_outdated/);
  });
});

async function createInstallerHarness(): Promise<{
  workspace: string;
  dataDir: string;
  projectPaths: PluginPaths;
  globalPaths: PluginPaths;
  manager: FakePackageManager;
  installer: PluginInstaller;
}> {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "coden-installer-work-"));
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "coden-installer-data-"));
  const manager = new FakePackageManager();
  const installer = new PluginInstaller(
    workspace,
    dataDir,
    manager,
    new InstalledPluginLoader(),
    builtinTools(),
  );
  return {
    workspace,
    dataDir,
    projectPaths: resolvePluginPaths(workspace, "project", dataDir),
    globalPaths: resolvePluginPaths(workspace, "global", dataDir),
    manager,
    installer,
  };
}

async function materializeFixtureDependencies(
  runtimeDir: string,
  dependencies: Record<string, string>,
  fixtureOverrides: Map<string, string>,
): Promise<void> {
  await rm(path.join(runtimeDir, "node_modules"), { recursive: true, force: true });
  for (const packageName of Object.keys(dependencies).sort()) {
    const fixture = fixtureOverrides.get(packageName) ?? packageName.replace(/^@fixtures\//, "");
    const source = path.join(process.cwd(), "test", "fixtures", "npm-plugins", fixture);
    const destination = path.join(runtimeDir, "node_modules", ...packageName.split("/"));
    await mkdir(path.dirname(destination), { recursive: true });
    await cp(source, destination, { recursive: true });
  }
}

async function seedManifestOnly(
  paths: PluginPaths,
  packageName: string,
  requested: string,
): Promise<void> {
  await mkdir(path.dirname(paths.manifestPath), { recursive: true });
  await writeFile(
    paths.manifestPath,
    serializePluginManifest({
      schemaVersion: 1,
      plugins: { [packageName]: { source: "npm", requested } },
    }),
    "utf8",
  );
}

async function snapshotScope(paths: PluginPaths): Promise<{
  manifest: string;
  lockfile: string;
  runtimeFiles: string[];
}> {
  return {
    manifest: await readIfExists(paths.manifestPath),
    lockfile: await readIfExists(path.join(paths.runtimeDir, "bun.lock")),
    runtimeFiles: await listRelativeFiles(paths.runtimeDir),
  };
}

async function readIfExists(file: string): Promise<string> {
  try {
    return await readFile(file, "utf8");
  } catch (error) {
    if (isFileSystemError(error, "ENOENT")) return "";
    throw error;
  }
}

async function listRelativeFiles(root: string): Promise<string[]> {
  if (!(await pathExists(root))) return [];
  const files: string[] = [];
  async function walk(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) await walk(absolute);
      else files.push(path.relative(root, absolute));
    }
  }
  await walk(root);
  return files.sort();
}

async function pathExists(file: string): Promise<boolean> {
  try {
    await access(file, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function isFileSystemError(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === code
  );
}
