import { spawnSync } from "node:child_process";
import { access, cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCliProgram } from "../../src/cli/index.js";
import type { PluginCommandService } from "../../src/cli/plugin-command.js";
import { InstalledPluginLoader } from "../../src/plugins/installed-loader.js";
import {
  type InstalledPluginSummary,
  type ListedPlugin,
  PluginInstaller,
  type PluginOperationOptions,
} from "../../src/plugins/installer.js";
import type { PackageInstallRequest, PackageManager } from "../../src/plugins/package-manager.js";
import { builtinTools } from "../../src/tools/builtin/index.js";

function fakePluginService() {
  return {
    install: vi.fn(async (_raw: string, options: PluginOperationOptions) => ({
      packageName: "@acme/hello",
      requested: "^1",
      version: "1.2.3",
      tools: ["hello", "hello_extra"],
      scope: options.scope,
    })),
    remove: vi.fn(async (_packageName: string, _options: PluginOperationOptions) => undefined),
    sync: vi.fn(async (options: PluginOperationOptions) => [summary("@acme/hello", options.scope)]),
    list: vi.fn(async () => ({
      project: [listed("@acme/project", "project", false)],
      global: [listed("@acme/global", "global", true)],
    })),
  } satisfies PluginCommandService;
}

function summary(packageName: string, scope: "project" | "global"): InstalledPluginSummary {
  return { packageName, requested: "latest", version: "1.0.0", tools: ["tool"], scope };
}

function listed(
  packageName: string,
  scope: "project" | "global",
  shadowedByProject: boolean,
): ListedPlugin {
  return { ...summary(packageName, scope), shadowedByProject };
}

class FixturePackageManager implements PackageManager {
  readonly requests: PackageInstallRequest[] = [];

  async install(request: PackageInstallRequest): Promise<void> {
    this.requests.push(request);
    const packageJson = JSON.parse(
      await readFile(path.join(request.cwd, "package.json"), "utf8"),
    ) as { dependencies?: Record<string, string> };
    await rm(path.join(request.cwd, "node_modules"), { recursive: true, force: true });
    for (const packageName of Object.keys(packageJson.dependencies ?? {}).sort()) {
      const fixture = packageName.replace(/^@fixtures\//, "");
      const source = path.join(process.cwd(), "test", "fixtures", "npm-plugins", fixture);
      const destination = path.join(request.cwd, "node_modules", ...packageName.split("/"));
      await mkdir(path.dirname(destination), { recursive: true });
      await cp(source, destination, { recursive: true });
    }
    await writeFile(path.join(request.cwd, "bun.lock"), "fixture-lock\n", "utf8");
  }
}

describe("plugin CLI subcommands", () => {
  let stdout = "";
  let stderr = "";
  let stdoutSpy: { mockRestore(): void };
  let stderrSpy: { mockRestore(): void };
  let originalExitCode: string | number | null | undefined;

  beforeEach(() => {
    stdout = "";
    stderr = "";
    originalExitCode = process.exitCode;
    process.exitCode = undefined;
    stdoutSpy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation((chunk: string | Uint8Array) => {
        stdout += String(chunk);
        return true;
      });
    stderrSpy = vi
      .spyOn(process.stderr, "write")
      .mockImplementation((chunk: string | Uint8Array) => {
        stderr += String(chunk);
        return true;
      });
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
    process.exitCode = originalExitCode;
    vi.restoreAllMocks();
  });

  it("dispatches project install by default", async () => {
    const service = fakePluginService();
    const program = createCliProgram({ pluginService: service, confirm: async () => true });

    await program.parseAsync(["node", "coden", "plugin", "install", "npm:@acme/hello@^1"]);

    expect(service.install).toHaveBeenCalledWith("npm:@acme/hello@^1", {
      scope: "project",
      allowScripts: false,
    });
  });

  it("dispatches global install and explicit script permission", async () => {
    const service = fakePluginService();
    const program = createCliProgram({ pluginService: service, confirm: async () => true });

    await program.parseAsync([
      "node",
      "coden",
      "plugin",
      "install",
      "npm:@acme/hello",
      "--global",
      "--allow-scripts",
    ]);

    expect(service.install).toHaveBeenCalledWith("npm:@acme/hello", {
      scope: "global",
      allowScripts: true,
    });
  });

  it("dispatches remove, sync, and list commands", async () => {
    const service = fakePluginService();
    const program = createCliProgram({ pluginService: service, confirm: async () => true });

    await program.parseAsync([
      "node",
      "coden",
      "plugin",
      "remove",
      "@acme/hello",
      "--global",
      "--allow-scripts",
    ]);
    await program.parseAsync(["node", "coden", "plugin", "sync", "--global"]);
    await program.parseAsync(["node", "coden", "plugin", "list", "--project"]);

    expect(service.remove).toHaveBeenCalledWith("@acme/hello", {
      scope: "global",
      allowScripts: true,
    });
    expect(service.sync).toHaveBeenCalledWith({ scope: "global", allowScripts: false });
    expect(service.list).toHaveBeenCalledTimes(1);
    expect(stdout).toContain("Project plugins");
    expect(stdout).not.toContain("Global plugins");
  });

  it("rejects plugin list with project and global filters together", async () => {
    const service = fakePluginService();
    const program = createCliProgram({ pluginService: service, confirm: async () => true });

    await program.parseAsync(["node", "coden", "plugin", "list", "--project", "--global"]);

    expect(service.list).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(2);
    expect(stderr).toContain("only one of --project or --global");
  });

  it("ordinary install asks once and refusal does not call the service", async () => {
    const service = fakePluginService();
    const confirm = vi.fn(async (_message: string) => false);
    const program = createCliProgram({ pluginService: service, confirm });

    await program.parseAsync(["node", "coden", "plugin", "install", "npm:@acme/hello"]);

    expect(confirm).toHaveBeenCalledTimes(1);
    expect(confirm.mock.calls[0]?.[0]).toContain(
      "validation imports plugin top-level code with full permissions",
    );
    expect(service.install).not.toHaveBeenCalled();
  });

  it("--yes skips the ordinary prompt without enabling scripts", async () => {
    const service = fakePluginService();
    const confirm = vi.fn(async (_message: string) => true);
    const program = createCliProgram({ pluginService: service, confirm });

    await program.parseAsync(["node", "coden", "plugin", "install", "npm:@acme/hello", "--yes"]);

    expect(confirm).not.toHaveBeenCalled();
    expect(service.install).toHaveBeenCalledWith("npm:@acme/hello", {
      scope: "project",
      allowScripts: false,
    });
  });

  it("--allow-scripts prints a second warning and asks for script confirmation", async () => {
    const service = fakePluginService();
    const confirm = vi.fn(async (_message: string) => true);
    const program = createCliProgram({ pluginService: service, confirm });

    await program.parseAsync([
      "node",
      "coden",
      "plugin",
      "install",
      "npm:@acme/hello",
      "--allow-scripts",
    ]);

    expect(confirm).toHaveBeenCalledTimes(2);
    expect(confirm.mock.calls[1]?.[0]).toContain("Allow npm lifecycle scripts");
    expect(stderr).toContain("--allow-scripts");
    expect(service.install).toHaveBeenCalledWith("npm:@acme/hello", {
      scope: "project",
      allowScripts: true,
    });
  });

  it("--yes --allow-scripts prints the warning but skips script confirmation", async () => {
    const service = fakePluginService();
    const confirm = vi.fn(async (_message: string) => true);
    const program = createCliProgram({ pluginService: service, confirm });

    await program.parseAsync([
      "node",
      "coden",
      "plugin",
      "install",
      "npm:@acme/hello",
      "--yes",
      "--allow-scripts",
    ]);

    expect(confirm).not.toHaveBeenCalled();
    expect(stderr).toContain("--allow-scripts");
    expect(service.install).toHaveBeenCalledWith("npm:@acme/hello", {
      scope: "project",
      allowScripts: true,
    });
  });

  it("successful install output includes package, version, scope, tools, scripts, and restart", async () => {
    const service = fakePluginService();
    const program = createCliProgram({ pluginService: service, confirm: async () => true });

    await program.parseAsync(["node", "coden", "plugin", "install", "npm:@acme/hello@^1"]);

    expect(stdout).toContain("@acme/hello@1.2.3");
    expect(stdout).toContain("project");
    expect(stdout).toContain("hello, hello_extra");
    expect(stdout).toContain("Lifecycle scripts: disabled");
    expect(stdout).toContain("Restart CodeN");
  });

  it("creates the project files intended for version control", async () => {
    const harness = await cliHarnessWithFixturePackage();

    await harness.run(["plugin", "install", "npm:@fixtures/single-tool", "--yes"]);

    expect(
      await readFile(path.join(harness.workspace, ".coden", "plugins.json"), "utf8"),
    ).toContain("@fixtures/single-tool");
    expect(
      await readFile(
        path.join(harness.workspace, ".coden", "plugin-runtime", ".gitignore"),
        "utf8",
      ),
    ).toBe("*\n!.gitignore\n!bun.lock\n");
    await expect(
      access(path.join(harness.workspace, ".coden", "plugin-runtime", "bun.lock")),
    ).resolves.toBeUndefined();
  });

  it("installs offline fixtures and exposes them through Bun startup composition", async () => {
    const harness = await cliHarnessWithFixturePackage();
    await harness.run(["plugin", "install", "npm:@fixtures/single-tool", "--yes"]);
    const script = await writeStartupCompositionScript(harness.workspace);

    const result = spawnSync("bun", [script], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        CODEN_E2E_WORKSPACE: harness.workspace,
        CODEN_E2E_DATA_DIR: harness.dataDir,
      },
      encoding: "utf8",
    });

    expect(result.status, result.stderr).toBe(0);
    const observed = JSON.parse(result.stdout) as { tools: string[]; events: string[] };
    expect(observed.tools).toContain("fixture_single");
    expect(observed.events).toContain("plugin.loaded");
    expect(harness.manager.requests).toHaveLength(1);
  });

  it("errors set exit code 2 without leaking environment secrets", async () => {
    const previousSecret = process.env.CODEN_FAKE_SECRET;
    process.env.CODEN_FAKE_SECRET = "super-secret-token";
    const service = fakePluginService();
    service.install.mockRejectedValueOnce(new Error("failed with super-secret-token"));
    const program = createCliProgram({ pluginService: service, confirm: async () => true });

    try {
      await program.parseAsync(["node", "coden", "plugin", "install", "npm:@acme/hello"]);
    } finally {
      process.env.CODEN_FAKE_SECRET = previousSecret;
    }

    expect(process.exitCode).toBe(2);
    expect(stderr).toContain("failed with [redacted]");
    expect(stderr).not.toContain("super-secret-token");
  });
});

async function cliHarnessWithFixturePackage(): Promise<{
  workspace: string;
  dataDir: string;
  manager: FixturePackageManager;
  run(args: string[]): Promise<void>;
}> {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "coden-plugin-cli-work-"));
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "coden-plugin-cli-data-"));
  const manager = new FixturePackageManager();
  const installer = new PluginInstaller(
    workspace,
    dataDir,
    manager,
    new InstalledPluginLoader(),
    builtinTools(),
  );
  const program = createCliProgram({ pluginService: installer, confirm: async () => true });
  return {
    workspace,
    dataDir,
    manager,
    async run(args: string[]): Promise<void> {
      await program.parseAsync(["node", "coden", ...args]);
    },
  };
}

async function writeStartupCompositionScript(workspace: string): Promise<string> {
  const script = path.join(workspace, "observe-startup-composition.ts");
  const root = process.cwd();
  await writeFile(
    script,
    `import { EventBus } from ${JSON.stringify(pathToFileURL(path.join(root, "src", "core", "events.ts")).href)};
import { composeRuntimePackageRegistry, loadInstalledScope } from ${JSON.stringify(pathToFileURL(path.join(root, "src", "cli", "agent-command.ts")).href)};
import { InstalledPluginLoader } from ${JSON.stringify(pathToFileURL(path.join(root, "src", "plugins", "installed-loader.ts")).href)};
import { resolvePluginPaths } from ${JSON.stringify(pathToFileURL(path.join(root, "src", "plugins", "paths.ts")).href)};
import { builtinTools } from ${JSON.stringify(pathToFileURL(path.join(root, "src", "tools", "builtin", "index.ts")).href)};

const workspace = process.env.CODEN_E2E_WORKSPACE;
const dataDir = process.env.CODEN_E2E_DATA_DIR;
if (!workspace || !dataDir) throw new Error("missing test environment");
const events = new EventBus();
const seen = [];
events.on((event) => seen.push(event.type));
const paths = resolvePluginPaths(workspace, "project", dataDir);
const project = await loadInstalledScope(new InstalledPluginLoader(), paths, events, "project");
const composed = await composeRuntimePackageRegistry(builtinTools(), [], project.loaded, events);
console.log(JSON.stringify({
  tools: composed.registry.list().map((tool) => tool.name).sort(),
  events: seen,
}));
`,
    "utf8",
  );
  return script;
}
