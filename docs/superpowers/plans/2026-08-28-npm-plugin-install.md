# npm Plugin Installation Implementation Plan

<!-- markdownlint-disable MD013 MD032 -->

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add reproducible project/global installation of public npmjs-hosted CodeN tool plugins, including multi-tool exports and third-party dependencies.

**Architecture:** Keep the existing content-hashed `data:` loader for local TypeScript files and add a separate real-path loader for installed npm packages. Each scope owns a declarative manifest plus a shared Bun runtime; mutations are built in a staging directory, validated, and transactionally swapped into place. The CLI exposes `plugin install/remove/list/sync`, while startup composes built-ins, effective global/project npm packages, and local plugins into one source-aware registry.

**Tech Stack:** TypeScript 5.9, Bun CLI/runtime, Node.js standard APIs, Commander, AJV, Vitest, Biome.

**Spec:** `docs/superpowers/specs/2026-08-28-npm-plugin-install-design.md`

## Global Constraints

- Support Bun `>=1.1.0`, but do not use `Bun.*` APIs; subprocess and filesystem code must use standard Node.js APIs.
- Accept only `npm:<package>` and `npm:<package>@<version-or-tag>` from public `https://registry.npmjs.org` in v1.
- Require `package.json#coden.apiVersion === 1` and an in-package `.js` or `.mjs` `package.json#coden.plugin` entry.
- Default to project scope; `--global` selects user scope.
- Disable lifecycle scripts unless `--allow-scripts` is explicitly supplied; `--yes` must never enable scripts.
- Project `plugins.json`, `.coden/plugin-runtime/.gitignore`, and `bun.lock` are tracked; generated `package.json` and `node_modules` are ignored.
- npm plugins run in-process with full user permissions and are not a sandbox.
- npm plugin changes require process restart; `/reload` remains deterministic only for local `.ts` plugins.
- Preserve existing Agent CLI syntax, local plugin behavior, and the offline `just check` baseline.

---

## File Structure

### New production files

- `src/plugins/api.ts` — public plugin protocol and export normalization.
- `src/plugins/specifier.ts` — strict `npm:` specifier parser.
- `src/plugins/paths.ts` — project/global manifest and runtime paths.
- `src/plugins/manifest.ts` — manifest validation, deterministic JSON, and generated Runtime package JSON.
- `src/plugins/package-metadata.ts` — installed package metadata and entry-boundary validation.
- `src/plugins/installed-loader.ts` — real-path imports and package export validation.
- `src/plugins/package-manager.ts` — package-manager contract.
- `src/plugins/bun-package-manager.ts` — Bun CLI adapter.
- `src/plugins/transaction.ts` — scope lock, staging, commit, rollback, and recovery.
- `src/plugins/installer.ts` — install/remove/sync/list orchestration.
- `src/process/runner.ts` — reusable bounded subprocess runner.
- `src/cli/agent-command.ts` — existing Agent startup path extracted from the root CLI.
- `src/cli/plugin-command.ts` — Commander plugin subcommands and terminal presentation.

### Modified production files

- `src/core/types.ts` — no protocol duplication; public API reuses `ToolDefinition`.
- `src/tools/registry.ts` — retain tool source metadata and diagnose collisions.
- `src/tools/plugin-loader.ts` — load local files into a supplied candidate Registry.
- `src/tools/builtin/bash.ts` — delegate subprocess lifecycle to `runProcess`.
- `src/cli/index.ts` — build the root command and dispatch Agent/plugin paths.
- `src/index.ts` — export public plugin and manager APIs.
- `package.json` — expose `coden/plugin` and keep scripts/dependencies aligned.
- `.gitignore` — allow reproducibility files without exposing local hand-written plugins.
- `README.md` — user commands, package-author contract, trust, and restart behavior.

### New tests and fixtures

- `test/plugins/api-registry.test.ts`
- `test/plugins/specifier-manifest.test.ts`
- `test/plugins/package-metadata-loader.test.ts`
- `test/plugins/process-package-manager.test.ts`
- `test/plugins/transaction.test.ts`
- `test/plugins/installer.test.ts`
- `test/plugins/plugin-command.test.ts`
- `test/fixtures/npm-plugins/single-tool/`
- `test/fixtures/npm-plugins/multi-tool/`
- `test/fixtures/npm-plugins/with-dependency/`
- `test/fixtures/npm-plugins/invalid/`

---

### Task 1: Public Plugin Protocol and Source-Aware Registry

**Files:**
- Create: `src/plugins/api.ts`
- Modify: `src/tools/registry.ts`
- Modify: `src/index.ts`
- Modify: `package.json`
- Test: `test/plugins/api-registry.test.ts`

**Interfaces:**
- Consumes: existing `ToolDefinition`, `ToolRisk`, and `CodeNError` from `src/core/types.ts`.
- Produces: `CODEN_PLUGIN_API_VERSION`, `CodeNPlugin`, `normalizePluginExport`, `ToolSource`, `RegisteredTool`, `ToolRegistry.source()`, `ToolRegistry.entries()`, and `ToolRegistry.clone()`.

- [ ] **Step 1: Write failing protocol normalization tests**

```ts
import { describe, expect, it } from "vitest";
import { normalizePluginExport } from "../../src/plugins/api.js";

const tool = {
  name: "hello",
  description: "Say hello",
  risk: "read" as const,
  inputSchema: { type: "object" },
  async execute() {
    return { content: "hello" };
  },
};

describe("npm plugin API", () => {
  it("normalizes a single tool", () => {
    expect(normalizePluginExport(tool, "@acme/hello")).toEqual([tool]);
  });

  it("normalizes a version-one multi-tool plugin", () => {
    expect(
      normalizePluginExport(
        { apiVersion: 1, name: "@acme/hello", tools: [tool] },
        "@acme/hello",
      ),
    ).toEqual([tool]);
  });

  it("rejects mismatched package identity", () => {
    expect(() =>
      normalizePluginExport(
        { apiVersion: 1, name: "@other/plugin", tools: [tool] },
        "@acme/hello",
      ),
    ).toThrow(/plugin.name_mismatch/);
  });

  it("rejects unsupported API versions and empty tool arrays", () => {
    expect(() =>
      normalizePluginExport({ apiVersion: 2, name: "@acme/hello", tools: [tool] }, "@acme/hello"),
    ).toThrow(/plugin.api_unsupported/);
    expect(() =>
      normalizePluginExport({ apiVersion: 1, name: "@acme/hello", tools: [] }, "@acme/hello"),
    ).toThrow(/plugin.export_invalid/);
  });
});
```

- [ ] **Step 2: Write failing Registry source and collision tests**

Append to `test/plugins/api-registry.test.ts`:

```ts
import { builtinTools } from "../../src/tools/builtin/index.js";
import { ToolRegistry } from "../../src/tools/registry.js";

it("retains source metadata without changing list/get behavior", () => {
  const registry = new ToolRegistry(builtinTools());
  registry.register(tool, {
    kind: "npm",
    pluginName: "@acme/hello",
    pluginVersion: "1.0.0",
    path: "/plugins/hello.js",
  });

  expect(registry.get("hello")).toBe(tool);
  expect(registry.list()).toContain(tool);
  expect(registry.source("hello")?.pluginName).toBe("@acme/hello");
  expect(registry.clone().entries()).toEqual(registry.entries());
});

it("reports both sources when tools conflict", () => {
  const registry = new ToolRegistry(builtinTools());
  registry.register(tool, { kind: "npm", pluginName: "plugin-a", pluginVersion: "1.0.0" });
  expect(() =>
    registry.register(tool, { kind: "npm", pluginName: "plugin-b", pluginVersion: "2.0.0" }),
  ).toThrow(/plugin-a@1.0.0.*plugin-b@2.0.0/s);
});
```

- [ ] **Step 3: Run the focused tests and verify missing modules/APIs fail**

Run: `bun run test test/plugins/api-registry.test.ts`

Expected: FAIL because `src/plugins/api.ts`, source-aware registration, and `clone()` do not exist.

- [ ] **Step 4: Implement the public plugin protocol**

Create `src/plugins/api.ts` with these exact public shapes:

```ts
import { CodeNError, type ToolDefinition } from "../core/types.js";

export const CODEN_PLUGIN_API_VERSION = 1 as const;

export interface CodeNPlugin {
  apiVersion: typeof CODEN_PLUGIN_API_VERSION;
  name: string;
  tools: ToolDefinition[];
}

export type PluginModuleExport = ToolDefinition | CodeNPlugin;

export function normalizePluginExport(value: unknown, packageName: string): ToolDefinition[] {
  if (isToolDefinitionShape(value)) return [value];
  if (!value || typeof value !== "object")
    throw new CodeNError("plugin", "plugin.export_invalid", "plugin.export_invalid: default export must be a tool or CodeNPlugin");

  const plugin = value as Partial<CodeNPlugin> & { apiVersion?: unknown; tools?: unknown };
  if (plugin.apiVersion !== CODEN_PLUGIN_API_VERSION)
    throw new CodeNError("plugin", "plugin.api_unsupported", `plugin.api_unsupported: ${String(plugin.apiVersion)}`);
  if (plugin.name !== packageName)
    throw new CodeNError("plugin", "plugin.name_mismatch", `plugin.name_mismatch: expected ${packageName}, received ${String(plugin.name)}`);
  if (!Array.isArray(plugin.tools) || plugin.tools.length === 0)
    throw new CodeNError("plugin", "plugin.export_invalid", "plugin.export_invalid: tools must be a non-empty array");
  if (!plugin.tools.every(isToolDefinitionShape))
    throw new CodeNError("plugin", "plugin.export_invalid", "plugin.export_invalid: every tool must match ToolDefinition");
  return plugin.tools;
}

function isToolDefinitionShape(value: unknown): value is ToolDefinition {
  if (!value || typeof value !== "object") return false;
  const tool = value as Partial<ToolDefinition>;
  return (
    typeof tool.name === "string" &&
    typeof tool.description === "string" &&
    (tool.risk === "read" || tool.risk === "modify" || tool.risk === "dangerous") &&
    !!tool.inputSchema &&
    typeof tool.execute === "function"
  );
}
```

Keep detailed Schema/name validation in `ToolRegistry.register()` rather than duplicating AJV here.

- [ ] **Step 5: Extend `ToolRegistry` while preserving existing callers**

Implement these interfaces and method signatures in `src/tools/registry.ts`:

```ts
export type ToolSource =
  | { kind: "builtin" }
  | { kind: "local"; path?: string }
  | { kind: "npm"; pluginName: string; pluginVersion: string; path?: string };

export interface RegisteredTool {
  definition: ToolDefinition;
  source: ToolSource;
}

export class ToolRegistry {
  #tools = new Map<string, RegisteredTool>();

  constructor(tools: ToolDefinition[] = []) {
    for (const tool of tools) this.register(tool, { kind: "builtin" });
  }

  register(tool: ToolDefinition, source: ToolSource = { kind: "local" }): void;
  get(name: string): ToolDefinition | undefined;
  list(): ToolDefinition[];
  source(name: string): ToolSource | undefined;
  entries(): RegisteredTool[];
  clone(): ToolRegistry;
  replaceWith(candidate: ToolRegistry): void;
}
```

`clone()` must copy entries without reclassifying sources. On duplicate names, include `formatSource(existing.source)` and `formatSource(source)` in `tool.duplicate`. Keep `validate()` behavior unchanged.

- [ ] **Step 6: Export the API and package subpath**

Add to `src/index.ts`:

```ts
export * from "./plugins/api.js";
```

Add to `package.json` without changing the current Bun source-based package model:

```json
"exports": {
  ".": "./src/index.ts",
  "./plugin": "./src/plugins/api.ts"
}
```

- [ ] **Step 7: Run focused and baseline tests**

Run: `bun run test test/plugins/api-registry.test.ts test/tools.test.ts test/plugin-terminal.test.ts`

Expected: PASS.

Run: `bun run typecheck`

Expected: PASS with all existing `ToolRegistry` callers unchanged.

- [ ] **Step 8: Commit**

```bash
git add src/plugins/api.ts src/tools/registry.ts src/index.ts package.json test/plugins/api-registry.test.ts
git commit -m "feat: define npm plugin API and tool sources"
```

---

### Task 2: Reusable Process Runner and Bun Package Manager

**Files:**
- Create: `src/process/runner.ts`
- Create: `src/plugins/package-manager.ts`
- Create: `src/plugins/bun-package-manager.ts`
- Modify: `src/tools/builtin/bash.ts`
- Test: `test/plugins/process-package-manager.test.ts`
- Test: `test/tools.test.ts`

**Interfaces:**
- Consumes: `truncateOutput` and `CodeNError`.
- Produces: `runProcess(command, args, options)`, `ProcessRunResult`, `PackageManager`, `PackageInstallRequest`, and `BunPackageManager.install()`.

- [ ] **Step 1: Write failing bounded runner tests**

Create `test/plugins/process-package-manager.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { runProcess } from "../../src/process/runner.js";

it("captures bounded stdout and stderr", async () => {
  const result = await runProcess(
    process.execPath,
    ["-e", "process.stdout.write('a'.repeat(4000)); process.stderr.write('problem')"],
    { cwd: process.cwd(), timeoutMs: 5_000, maxOutputChars: 1_000 },
  );
  expect(result.exitCode).toBe(0);
  expect(result.stdout.length).toBeLessThanOrEqual(1_100);
  expect(result.stdout).toContain("omitted");
  expect(result.stderr).toBe("problem");
});

it("terminates a timed-out process", async () => {
  const result = await runProcess(
    process.execPath,
    ["-e", "setInterval(() => {}, 1000)"],
    { cwd: process.cwd(), timeoutMs: 100, maxOutputChars: 1_000 },
  );
  expect(result.timedOut).toBe(true);
  expect(result.ok).toBe(false);
});
```

- [ ] **Step 2: Write a failing Bun adapter argument test**

Append a fake runner seam test:

```ts
import { BunPackageManager } from "../../src/plugins/bun-package-manager.js";

describe("BunPackageManager", () => {
  it("pins npmjs and disables scripts by default", async () => {
    const calls: Array<{ command: string; args: string[] }> = [];
    const manager = new BunPackageManager(async (command, args) => {
      calls.push({ command, args });
      return { ok: true, stdout: "", stderr: "", exitCode: 0, signal: null, timedOut: false, cancelled: false };
    });

    await manager.install({ cwd: "/tmp/runtime", frozenLockfile: false, allowScripts: false });
    expect(calls).toEqual([
      {
        command: "bun",
        args: ["install", "--registry", "https://registry.npmjs.org", "--ignore-scripts"],
      },
    ]);
  });

  it("adds frozen lockfile without implicitly allowing scripts", async () => {
    const calls: string[][] = [];
    const manager = new BunPackageManager(async (_command, args) => {
      calls.push(args);
      return { ok: true, stdout: "", stderr: "", exitCode: 0, signal: null, timedOut: false, cancelled: false };
    });
    await manager.install({ cwd: "/tmp/runtime", frozenLockfile: true, allowScripts: false });
    expect(calls[0]).toContain("--frozen-lockfile");
    expect(calls[0]).toContain("--ignore-scripts");
  });
});
```

- [ ] **Step 3: Run tests and verify missing modules fail**

Run: `bun run test test/plugins/process-package-manager.test.ts`

Expected: FAIL because the process and package-manager modules do not exist.

- [ ] **Step 4: Implement `runProcess`**

Create `src/process/runner.ts` with:

```ts
export interface ProcessRunOptions {
  cwd: string;
  env?: NodeJS.ProcessEnv;
  signal?: AbortSignal;
  timeoutMs: number;
  maxOutputChars: number;
}

export interface ProcessRunResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
  cancelled: boolean;
}

export type ProcessRunner = (
  command: string,
  args: string[],
  options: ProcessRunOptions,
) => Promise<ProcessRunResult>;

export const runProcess: ProcessRunner = (command, args, options) =>
  new Promise((resolve) => {
    const grouped = process.platform !== "win32";
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ["ignore", "pipe", "pipe"],
      detached: grouped,
    });
    const stdout = new BoundedCollector(options.maxOutputChars);
    const stderr = new BoundedCollector(options.maxOutputChars);
    let timedOut = false;
    let cancelled = false;
    let settled = false;
    let escalation: NodeJS.Timeout | undefined;
    let timer: NodeJS.Timeout;

    const terminate = (signal: NodeJS.Signals) => {
      if (grouped && child.pid) {
        try {
          process.kill(-child.pid, signal);
          return;
        } catch {
          // The process group may already have exited; kill the child directly.
        }
      }
      child.kill(signal);
    };
    const finish = (exitCode: number | null, signal: NodeJS.Signals | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (escalation) clearTimeout(escalation);
      options.signal?.removeEventListener("abort", cancel);
      resolve({
        ok: !timedOut && !cancelled && exitCode === 0,
        stdout: stdout.value(),
        stderr: stderr.value(),
        exitCode,
        signal,
        timedOut,
        cancelled,
      });
    };
    const escalate = () => {
      if (escalation) return;
      escalation = setTimeout(() => terminate("SIGKILL"), 500);
      escalation.unref();
    };
    const cancel = () => {
      cancelled = true;
      terminate("SIGTERM");
      escalate();
    };

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => stdout.add(chunk));
    child.stderr.on("data", (chunk: string) => stderr.add(chunk));
    child.once("error", (error) => {
      stderr.add(error.message);
      finish(null, null);
    });
    child.once("close", finish);
    if (options.signal?.aborted) cancel();
    else options.signal?.addEventListener("abort", cancel, { once: true });
    timer = setTimeout(() => {
      timedOut = true;
      terminate("SIGTERM");
      escalate();
    }, options.timeoutMs);
  });
```

Move the existing `BoundedCollector` implementation unchanged from
`src/tools/builtin/bash.ts`. Keep process-group termination, cancellation, timeout, and escalation
in this module rather than maintaining two copies.

- [ ] **Step 5: Refactor the Bash tool onto `runProcess`**

Replace direct `spawn` logic in `src/tools/builtin/bash.ts` with:

```ts
const result = await runProcess("bash", ["-lc", command], {
  cwd: context.workspace,
  env: process.env,
  signal: context.signal,
  timeoutMs: timeout,
  maxOutputChars: maxOutput,
});

const combined = [
  result.stdout && `stdout:\n${result.stdout}`,
  result.stderr && `stderr:\n${result.stderr}`,
].filter(Boolean).join("\n");
```

Keep existing status text, `metadata`, output truncation, timeout behavior, and test-visible Bash semantics unchanged.

- [ ] **Step 6: Implement package-manager interfaces**

Create `src/plugins/package-manager.ts`:

```ts
export interface PackageInstallRequest {
  cwd: string;
  frozenLockfile: boolean;
  allowScripts: boolean;
  signal?: AbortSignal;
}

export interface PackageManager {
  install(request: PackageInstallRequest): Promise<void>;
}
```

Create `src/plugins/bun-package-manager.ts` with constructor injection:

```ts
export class BunPackageManager implements PackageManager {
  constructor(private readonly runner: ProcessRunner = runProcess) {}

  async install(request: PackageInstallRequest): Promise<void> {
    const args = ["install", "--registry", "https://registry.npmjs.org"];
    if (request.frozenLockfile) args.push("--frozen-lockfile");
    if (!request.allowScripts) args.push("--ignore-scripts");
    const result = await this.runner("bun", args, {
      cwd: request.cwd,
      env: process.env,
      signal: request.signal,
      timeoutMs: 120_000,
      maxOutputChars: 30_000,
    });
    if (!result.ok)
      throw new CodeNError("plugin", "plugin.install_failed", boundedInstallMessage(result));
  }
}
```

The error message must include exit status and bounded stderr, not environment data.

- [ ] **Step 7: Run focused and full tool tests**

Run: `bun run test test/plugins/process-package-manager.test.ts test/tools.test.ts`

Expected: PASS, including existing Bash timeout/output tests.

Run: `bun run typecheck`

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/process/runner.ts src/plugins/package-manager.ts src/plugins/bun-package-manager.ts src/tools/builtin/bash.ts test/plugins/process-package-manager.test.ts test/tools.test.ts
git commit -m "refactor: share bounded process runner"
```

---

### Task 3: Specifiers, Scope Paths, Manifests, and Package Metadata

**Files:**
- Create: `src/plugins/specifier.ts`
- Create: `src/plugins/paths.ts`
- Create: `src/plugins/manifest.ts`
- Create: `src/plugins/package-metadata.ts`
- Test: `test/plugins/specifier-manifest.test.ts`
- Test: `test/plugins/package-metadata-loader.test.ts`

**Interfaces:**
- Consumes: `userDataDir()` from `src/config/config.ts` and `CodeNError`.
- Produces: `NpmPluginSpecifier`, `parseNpmPluginSpecifier`, `PluginScope`, `PluginPaths`, `resolvePluginPaths`, `PluginManifest`, `readPluginManifest`, `serializePluginManifest`, `runtimePackageJson`, `InstalledPackageMetadata`, and `readInstalledPackageMetadata`.

- [ ] **Step 1: Write failing specifier tests**

Create `test/plugins/specifier-manifest.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { parseNpmPluginSpecifier } from "../../src/plugins/specifier.js";

it.each([
  ["npm:hello", { packageName: "hello", requested: "latest" }],
  ["npm:hello@1.2.0", { packageName: "hello", requested: "1.2.0" }],
  ["npm:@scope/hello", { packageName: "@scope/hello", requested: "latest" }],
  ["npm:@scope/hello@^2.0.0", { packageName: "@scope/hello", requested: "^2.0.0" }],
])("parses %s", (raw, expected) => {
  expect(parseNpmPluginSpecifier(raw)).toMatchObject({ source: "npm", raw, ...expected });
});

it.each(["hello", "git:https://example.test/p.git", "file:../plugin", "npm:", "npm:../bad"])(
  "rejects unsupported or invalid source %s",
  (raw) => expect(() => parseNpmPluginSpecifier(raw)).toThrow(/plugin.specifier_invalid/),
);
```

- [ ] **Step 2: Write failing path and manifest tests**

Append:

```ts
import path from "node:path";
import { resolvePluginPaths } from "../../src/plugins/paths.js";
import { runtimePackageJson, serializePluginManifest } from "../../src/plugins/manifest.js";

it("derives project and global scope paths", () => {
  expect(resolvePluginPaths("/work", "project", "/data")).toMatchObject({
    root: path.join("/work", ".coden"),
    manifestPath: path.join("/work", ".coden", "plugins.json"),
    runtimeDir: path.join("/work", ".coden", "plugin-runtime"),
  });
  expect(resolvePluginPaths("/work", "global", "/data")).toMatchObject({
    root: path.join("/data", "plugins"),
    runtimeDir: path.join("/data", "plugins", "runtime"),
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
  expect(Object.keys(JSON.parse(serializePluginManifest(manifest)).plugins)).toEqual(["alpha", "zed"]);
  expect(runtimePackageJson(manifest)).toEqual({
    private: true,
    dependencies: { alpha: "^1", zed: "latest" },
  });
});
```

Also test that a missing manifest reads as `{ schemaVersion: 1, plugins: {} }`, while malformed JSON, unknown schema versions, invalid package keys, and non-string requests throw `plugin.manifest_invalid`.

- [ ] **Step 3: Write failing metadata boundary tests**

Create the invalid fixture directories under `test/fixtures/npm-plugins/invalid/` and add tests:

```ts
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { readInstalledPackageMetadata } from "../../src/plugins/package-metadata.js";

it("accepts an in-package JavaScript entry", async () => {
  const runtime = await makeInstalledPackage({
    name: "@acme/ok",
    version: "1.0.0",
    coden: { apiVersion: 1, plugin: "./dist/index.js" },
  });
  const metadata = await readInstalledPackageMetadata(runtime, "@acme/ok");
  expect(metadata.version).toBe("1.0.0");
  expect(metadata.entryPath).toEndWith(path.join("dist", "index.js"));
});

it.each([
  [{ name: "@acme/bad", version: "1.0.0" }, "plugin.metadata_missing"],
  [{ name: "@acme/bad", version: "1.0.0", coden: { apiVersion: 2, plugin: "./dist/index.js" } }, "plugin.api_unsupported"],
  [{ name: "@acme/bad", version: "1.0.0", coden: { apiVersion: 1, plugin: "../escape.js" } }, "plugin.entry_invalid"],
  [{ name: "@acme/bad", version: "1.0.0", coden: { apiVersion: 1, plugin: "./src/index.ts" } }, "plugin.entry_invalid"],
])("rejects invalid metadata", async (packageJson, code) => {
  const runtime = await makeInstalledPackage(packageJson);
  await expect(readInstalledPackageMetadata(runtime, "@acme/bad")).rejects.toThrow(code);
});
```

`makeInstalledPackage` must create `runtime/node_modules/@acme/<name>/package.json` and requested entry files entirely under a temporary directory.

- [ ] **Step 4: Run tests and verify missing modules fail**

Run: `bun run test test/plugins/specifier-manifest.test.ts test/plugins/package-metadata-loader.test.ts`

Expected: FAIL because parser, path, manifest, and metadata modules do not exist.

- [ ] **Step 5: Implement strict `npm:` parsing**

Create `src/plugins/specifier.ts`:

```ts
export interface NpmPluginSpecifier {
  source: "npm";
  packageName: string;
  requested: string;
  raw: string;
}

export function parseNpmPluginSpecifier(raw: string): NpmPluginSpecifier;
```

After removing `npm:`, split unscoped names at their only version delimiter and scoped names at the final `@` after the `/`. Accept npm names matching lowercase npm naming rules and reject whitespace, backslashes, traversal segments, URL syntax, and an empty request suffix. Preserve semver/tag text as `requested`; Bun remains the version resolver.

- [ ] **Step 6: Implement scope paths and manifest functions**

Create `src/plugins/paths.ts`:

```ts
export type PluginScope = "project" | "global";

export interface PluginPaths {
  scope: PluginScope;
  root: string;
  manifestPath: string;
  runtimeDir: string;
  lockPath: string;
  transactionPath: string;
}

export function resolvePluginPaths(
  workspace: string,
  scope: PluginScope,
  dataDir = userDataDir(),
): PluginPaths;
```

Create `src/plugins/manifest.ts`:

```ts
export interface PluginManifestEntry {
  source: "npm";
  requested: string;
}

export interface PluginManifest {
  schemaVersion: 1;
  plugins: Record<string, PluginManifestEntry>;
}

export const emptyPluginManifest = (): PluginManifest => ({ schemaVersion: 1, plugins: {} });
export async function readPluginManifest(file: string): Promise<PluginManifest>;
export function serializePluginManifest(manifest: PluginManifest): string;
export function runtimePackageJson(manifest: PluginManifest): {
  private: true;
  dependencies: Record<string, string>;
};
```

Use sorted keys and a final newline for on-disk JSON. Reuse package-name validation from `specifier.ts` through an exported `isValidNpmPackageName()` helper.

- [ ] **Step 7: Implement installed metadata validation**

Create `src/plugins/package-metadata.ts`:

```ts
export interface InstalledPackageMetadata {
  packageName: string;
  version: string;
  packageDirectory: string;
  entryPath: string;
  apiVersion: 1;
}

export async function readInstalledPackageMetadata(
  runtimeDirectory: string,
  packageName: string,
): Promise<InstalledPackageMetadata>;
```

Resolve scoped package paths correctly, parse `package.json`, require exact name/version/CodeN fields
and `type: "module"`, require `.js` or `.mjs`, call `realpath()` for package and entry, and enforce
`entryReal === packageReal || entryReal.startsWith(packageReal + path.sep)`.

- [ ] **Step 8: Run focused tests and typecheck**

Run: `bun run test test/plugins/specifier-manifest.test.ts test/plugins/package-metadata-loader.test.ts`

Expected: PASS.

Run: `bun run typecheck`

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/plugins/specifier.ts src/plugins/paths.ts src/plugins/manifest.ts src/plugins/package-metadata.ts test/plugins/specifier-manifest.test.ts test/plugins/package-metadata-loader.test.ts test/fixtures/npm-plugins/invalid
git commit -m "feat: validate npm plugin packages and manifests"
```

---

### Task 4: Installed Package Loader and Effective Package Composition

**Files:**
- Create: `src/plugins/installed-loader.ts`
- Create: `test/fixtures/npm-plugins/single-tool/package.json`
- Create: `test/fixtures/npm-plugins/single-tool/dist/index.js`
- Create: `test/fixtures/npm-plugins/multi-tool/package.json`
- Create: `test/fixtures/npm-plugins/multi-tool/dist/index.js`
- Create: `test/fixtures/npm-plugins/with-dependency/package.json`
- Create: `test/fixtures/npm-plugins/with-dependency/dist/index.js`
- Create: `test/fixtures/npm-plugins/with-dependency/node_modules/plugin-message/package.json`
- Create: `test/fixtures/npm-plugins/with-dependency/node_modules/plugin-message/index.js`
- Modify: `test/plugins/package-metadata-loader.test.ts`

**Interfaces:**
- Consumes: `PluginPaths`, `readPluginManifest`, `readInstalledPackageMetadata`, `normalizePluginExport`, and source-aware `ToolRegistry`.
- Produces: `LoadedPackagePlugin`, `PackagePluginFailure`, `PackagePluginLoadResult`, `InstalledPluginLoader.loadScope()`, and `composePackageRegistry()`.

- [ ] **Step 1: Create realistic built-JavaScript fixtures**

Use this shape for `single-tool/dist/index.js`:

```js
export default {
  name: "fixture_single",
  description: "Return a fixture value",
  risk: "read",
  inputSchema: { type: "object", additionalProperties: false, properties: {} },
  async execute() {
    return { content: "single" };
  },
};
```

Use this shape for `multi-tool/dist/index.js`:

```js
const first = {
  name: "fixture_first",
  description: "First fixture tool",
  risk: "read",
  inputSchema: { type: "object" },
  async execute() { return { content: "first" }; },
};
const second = { ...first, name: "fixture_second", async execute() { return { content: "second" }; } };
export default { apiVersion: 1, name: "@fixtures/multi-tool", tools: [first, second] };
```

Make `with-dependency/dist/index.js` import `message` from bare package `plugin-message`; its tool must return that dependency value.

- [ ] **Step 2: Write failing loader tests**

Append to `test/plugins/package-metadata-loader.test.ts`:

```ts
import { InstalledPluginLoader, composePackageRegistry } from "../../src/plugins/installed-loader.js";
import { builtinTools } from "../../src/tools/builtin/index.js";

it("loads single, multi, and dependency-backed package exports", async () => {
  const scope = await copyFixtureRuntime(["single-tool", "multi-tool", "with-dependency"]);
  const result = await new InstalledPluginLoader().loadScope(scope);
  expect(result.failed).toEqual([]);
  expect(result.loaded.map((plugin) => [plugin.packageName, plugin.tools.length])).toEqual([
    ["@fixtures/multi-tool", 2],
    ["@fixtures/single-tool", 1],
    ["@fixtures/with-dependency", 1],
  ]);
  const dependencyTool = result.loaded.find((item) => item.packageName.endsWith("with-dependency"))?.tools[0];
  expect((await dependencyTool?.execute({}, { workspace: "/work", signal: new AbortController().signal }))?.content).toBe("from dependency");
});

it("lets a project package shadow the same global package before tool registration", async () => {
  const global = packageResult("@fixtures/same", "1.0.0", "global_tool");
  const project = packageResult("@fixtures/same", "2.0.0", "project_tool");
  const composed = composePackageRegistry(builtinTools(), [global], [project]);
  expect(composed.registry.get("global_tool")).toBeUndefined();
  expect(composed.registry.get("project_tool")).toBeDefined();
  expect(composed.shadowed).toEqual([{ packageName: "@fixtures/same", globalVersion: "1.0.0", projectVersion: "2.0.0" }]);
});
```

Also test that one invalid package is returned in `failed` without preventing valid siblings, and that two distinct effective packages exporting the same tool produce `plugin.tool_conflict` with package versions.

- [ ] **Step 3: Run the loader tests and verify failure**

Run: `bun run test test/plugins/package-metadata-loader.test.ts`

Expected: FAIL because `InstalledPluginLoader` and composition do not exist.

- [ ] **Step 4: Implement real-path package loading**

Create `src/plugins/installed-loader.ts`:

```ts
export interface LoadedPackagePlugin {
  packageName: string;
  version: string;
  entryPath: string;
  tools: ToolDefinition[];
}

export interface PackagePluginFailure {
  packageName: string;
  path: string;
  message: string;
}

export interface PackagePluginLoadResult {
  loaded: LoadedPackagePlugin[];
  failed: PackagePluginFailure[];
}

export type PackageImporter = (specifier: string) => Promise<{ default?: unknown }>;

export class InstalledPluginLoader {
  constructor(private readonly importer: PackageImporter = (specifier) => import(specifier)) {}
  async loadScope(paths: PluginPaths): Promise<PackagePluginLoadResult>;
}
```

`loadScope()` must sort manifest package names, validate metadata, import `pathToFileURL(entryPath).href` without query/data rewriting, normalize the default export, and isolate each package failure.

- [ ] **Step 5: Implement package precedence and Registry composition**

Add:

```ts
export interface ShadowedPackage {
  packageName: string;
  globalVersion: string;
  projectVersion: string;
}

export function composePackageRegistry(
  builtins: ToolDefinition[],
  globalPlugins: LoadedPackagePlugin[],
  projectPlugins: LoadedPackagePlugin[],
): { registry: ToolRegistry; effective: LoadedPackagePlugin[]; shadowed: ShadowedPackage[] };
```

Build a set of project package names, omit matching globals, then register effective global and project tools with npm `ToolSource`. Convert duplicate `tool.duplicate` errors into `plugin.tool_conflict` while retaining both formatted sources.

- [ ] **Step 6: Run focused tests and typecheck**

Run: `bun run test test/plugins/package-metadata-loader.test.ts test/plugins/api-registry.test.ts`

Expected: PASS.

Run: `bun run typecheck`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/plugins/installed-loader.ts test/plugins/package-metadata-loader.test.ts test/fixtures/npm-plugins
git commit -m "feat: load installed npm plugin packages"
```

---

### Task 5: Transactional Scope Mutation and Crash Recovery

**Files:**
- Create: `src/plugins/transaction.ts`
- Test: `test/plugins/transaction.test.ts`

**Interfaces:**
- Consumes: `PluginPaths`.
- Produces: `PluginTransaction`, `PluginTransactionCandidate`, `TransactionPoint`, `PluginTransaction.run()`, and `PluginTransaction.recover()`.

- [ ] **Step 1: Write failing successful-commit and rollback tests**

Create `test/plugins/transaction.test.ts`:

```ts
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolvePluginPaths } from "../../src/plugins/paths.js";
import { PluginTransaction } from "../../src/plugins/transaction.js";

it("commits a staged manifest and runtime together", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "coden-transaction-"));
  const paths = resolvePluginPaths(workspace, "project", path.join(workspace, "data"));
  await seedCurrent(paths, "old");
  await new PluginTransaction(paths).run(async (candidate) => {
    await writeFile(candidate.manifestPath, '{"value":"new"}\n');
    await mkdir(candidate.runtimeDir, { recursive: true });
    await writeFile(path.join(candidate.runtimeDir, "value"), "new");
    return "committed";
  });
  expect(await readFile(paths.manifestPath, "utf8")).toContain("new");
  expect(await readFile(path.join(paths.runtimeDir, "value"), "utf8")).toBe("new");
});

it("leaves the old environment intact when candidate construction fails", async () => {
  const { paths } = await seededPaths();
  await expect(
    new PluginTransaction(paths).run(async () => {
      throw new Error("build failed");
    }),
  ).rejects.toThrow("build failed");
  await expectCurrent(paths, "old");
});
```

- [ ] **Step 2: Write failing lock and crash-recovery tests**

Use an injectable fault hook:

```ts
it("rejects a concurrent live owner", async () => {
  const { paths } = await seededPaths();
  await mkdir(paths.lockPath);
  await writeFile(path.join(paths.lockPath, "owner.json"), JSON.stringify({ pid: process.pid, createdAt: Date.now() }));
  await expect(new PluginTransaction(paths).run(async () => undefined)).rejects.toThrow(/plugin.install_busy/);
});

it.each(["after-backup", "after-runtime-commit", "after-manifest-commit"] as const)(
  "recovers an interruption at %s",
  async (point) => {
    const { paths } = await seededPaths();
    const interrupted = new PluginTransaction(paths, {
      fault(pointReached) {
        if (pointReached === point) throw new Error(`fault:${point}`);
      },
    });
    await expect(interrupted.run(writeNewCandidate)).rejects.toThrow(`fault:${point}`);
    await new PluginTransaction(paths).recover();
    await expectConsistentOldOrNew(paths);
    expect(await pathExists(paths.transactionPath)).toBe(false);
  },
);
```

`expectConsistentOldOrNew` must reject a mixed old-manifest/new-runtime pair.

- [ ] **Step 3: Run tests and verify missing transaction module fails**

Run: `bun run test test/plugins/transaction.test.ts`

Expected: FAIL because `PluginTransaction` does not exist.

- [ ] **Step 4: Implement lock acquisition and stale-owner cleanup**

Define:

```ts
export type TransactionPoint = "after-backup" | "after-runtime-commit" | "after-manifest-commit";

export interface PluginTransactionCandidate {
  manifestPath: string;
  runtimeDir: string;
}

export interface PluginTransactionOptions {
  fault?: (point: TransactionPoint) => void;
  now?: () => number;
  isProcessAlive?: (pid: number) => boolean;
}
```

Acquire the lock with atomic `mkdir(paths.lockPath)`. Write `owner.json` using mode `0o600`. If a lock exists, read its PID; throw `plugin.install_busy` when alive, otherwise remove the stale lock and retry once. Always remove the owned lock in `finally`.

- [ ] **Step 5: Implement staging, marker phases, commit, and recovery**

Use a marker with exact fields:

```ts
interface TransactionMarker {
  version: 1;
  id: string;
  phase: "prepared" | "backed-up" | "runtime-committed" | "manifest-committed";
  stageDirectory: string;
  backupManifestPath: string;
  backupRuntimeDir: string;
  hadManifest: boolean;
  hadRuntime: boolean;
}
```

`run(builder)` must:

1. acquire the lock and call `recoverLocked()`;
2. create a stage directory under `paths.root`;
3. call `builder({ manifestPath: stage/plugins.json, runtimeDir: stage/runtime })`;
4. verify both candidate paths exist;
5. write marker phase `prepared` atomically through `transactionPath.tmp`;
6. rename old targets to marker backup paths and mark `backed-up`;
7. rename candidate Runtime and mark `runtime-committed`;
8. rename candidate manifest and mark `manifest-committed`;
9. remove backups, stage, and marker;
10. return the builder result.

Recovery rules:

- `prepared`: remove stage/marker; current targets remain authoritative.
- `backed-up`: restore both backups, remove partial targets, stage, and marker.
- `runtime-committed`: remove new Runtime, restore both backups, remove stage/marker.
- `manifest-committed`: treat the new pair as committed; remove backups/stage/marker.

The fault hook runs immediately after persisting each matching phase so tests model process
interruption at stable recovery points. Treat an exception from this test-only hook as a simulated
process death: release only the process-owned lock and leave marker/backups in place for the next
`recover()` call. Ordinary builder, filesystem, and validation errors still trigger immediate
rollback before `run()` rejects.

- [ ] **Step 6: Run transaction tests repeatedly**

Run:

```bash
for run in 1 2 3; do
  bun run test test/plugins/transaction.test.ts || exit 1
done
```

Expected: PASS three times without leaked lock/stage directories.

Run: `bun run typecheck`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/plugins/transaction.ts test/plugins/transaction.test.ts
git commit -m "feat: add transactional plugin runtime updates"
```

---

### Task 6: Plugin Installer Service

**Files:**
- Create: `src/plugins/installer.ts`
- Test: `test/plugins/installer.test.ts`

**Interfaces:**
- Consumes: parser, paths, manifests, `PackageManager`, `PluginTransaction`, `InstalledPluginLoader`, `composePackageRegistry`, and built-ins.
- Produces: `PluginInstaller.install()`, `PluginInstaller.remove()`, `PluginInstaller.sync()`, `PluginInstaller.list()`, and operation result types.

- [ ] **Step 1: Write a fake package manager and failing install test**

Create `test/plugins/installer.test.ts` with a fake that materializes packages from fixtures:

```ts
class FakePackageManager implements PackageManager {
  readonly requests: PackageInstallRequest[] = [];
  failWith?: Error;

  async install(request: PackageInstallRequest): Promise<void> {
    this.requests.push(request);
    if (this.failWith) throw this.failWith;
    const packageJson = JSON.parse(await readFile(path.join(request.cwd, "package.json"), "utf8"));
    await materializeFixtureDependencies(request.cwd, packageJson.dependencies);
    await writeFile(path.join(request.cwd, "bun.lock"), "fixture-lock\n");
  }
}

it("installs an npm plugin into project scope with scripts disabled", async () => {
  const harness = await createInstallerHarness();
  const result = await harness.installer.install("npm:@fixtures/single-tool@^1", {
    scope: "project",
    allowScripts: false,
  });
  expect(result.packageName).toBe("@fixtures/single-tool");
  expect(result.version).toBe("1.0.0");
  expect(result.tools).toEqual(["fixture_single"]);
  expect(harness.manager.requests[0]).toMatchObject({ frozenLockfile: false, allowScripts: false });
  expect(await readManifest(harness.projectPaths.manifestPath)).toMatchObject({
    plugins: { "@fixtures/single-tool": { source: "npm", requested: "^1" } },
  });
});
```

- [ ] **Step 2: Write failing remove, sync, list, and rollback tests**

Add concrete tests:

```ts
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

it("preserves the old pair when package installation fails", async () => {
  const h = await createInstallerHarness();
  await h.installer.install("npm:@fixtures/single-tool", projectOptions);
  const before = await snapshotScope(h.projectPaths);
  h.manager.failWith = new Error("registry unavailable");
  await expect(
    h.installer.install("npm:@fixtures/multi-tool", projectOptions),
  ).rejects.toThrow("registry unavailable");
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
```

Implement `snapshotScope()` by reading `plugins.json`, `bun.lock`, and sorted relative Runtime
file names. The fake manager's `fixtureOverrides` maps package names to fixture directories; it must
never access npmjs.

- [ ] **Step 3: Run installer tests and verify missing service fails**

Run: `bun run test test/plugins/installer.test.ts`

Expected: FAIL because `PluginInstaller` does not exist.

- [ ] **Step 4: Define operation types and constructor dependencies**

Create `src/plugins/installer.ts`:

```ts
export interface PluginOperationOptions {
  scope: PluginScope;
  allowScripts: boolean;
  signal?: AbortSignal;
}

export interface InstalledPluginSummary {
  packageName: string;
  requested: string;
  version: string;
  tools: string[];
  scope: PluginScope;
}

export interface ListedPlugin extends InstalledPluginSummary {
  shadowedByProject: boolean;
}

export class PluginInstaller {
  constructor(
    private readonly workspace: string,
    private readonly dataDir: string,
    private readonly packageManager: PackageManager,
    private readonly loader: InstalledPluginLoader,
    private readonly builtins: ToolDefinition[],
  ) {}

  async install(raw: string, options: PluginOperationOptions): Promise<InstalledPluginSummary>;
  async remove(packageName: string, options: PluginOperationOptions): Promise<void>;
  async sync(options: PluginOperationOptions): Promise<InstalledPluginSummary[]>;
  async list(): Promise<{ project: ListedPlugin[]; global: ListedPlugin[] }>;
}
```

- [ ] **Step 5: Implement deterministic candidate Runtime construction**

Add a private method with this behavior:

```ts
private async buildCandidate(
  candidate: PluginTransactionCandidate,
  manifest: PluginManifest,
  sourcePaths: PluginPaths,
  options: PluginOperationOptions,
  frozenLockfile: boolean,
): Promise<LoadedPackagePlugin[]> {
  await mkdir(candidate.runtimeDir, { recursive: true });
  await writeFile(candidate.manifestPath, serializePluginManifest(manifest));
  await writeFile(
    path.join(candidate.runtimeDir, "package.json"),
    `${JSON.stringify(runtimePackageJson(manifest), null, 2)}\n`,
  );
  if (await pathExists(path.join(sourcePaths.runtimeDir, "bun.lock")))
    await copyFile(path.join(sourcePaths.runtimeDir, "bun.lock"), path.join(candidate.runtimeDir, "bun.lock"));
  await this.packageManager.install({
    cwd: candidate.runtimeDir,
    frozenLockfile,
    allowScripts: options.allowScripts,
    ...(options.signal ? { signal: options.signal } : {}),
  });
  await writeRuntimeGitignore(candidate.runtimeDir, sourcePaths.scope);
  const loaded = await this.loader.loadScope({ ...sourcePaths, manifestPath: candidate.manifestPath, runtimeDir: candidate.runtimeDir });
  if (loaded.failed.length > 0) throw packageLoadFailure(loaded.failed);
  return loaded.loaded;
}
```

For an empty manifest, still create deterministic `package.json`, `bun.lock`, and project Runtime `.gitignore` so transaction invariants remain valid.

- [ ] **Step 6: Implement install/remove/sync/list and cross-scope validation**

Rules:

- `install`: parse `npm:`, update a cloned manifest, no-op only when the same request is installed and loadable, then run a non-frozen candidate transaction.
- `remove`: validate a strict package name, fail clearly if absent, delete it from a cloned manifest, then run a non-frozen candidate transaction.
- `sync`: require project `bun.lock` when the manifest is non-empty, copy it to staging, and use `frozenLockfile: true`.
- `list`: read manifests and installed metadata without importing entry modules; sort by package name.
- Candidate validation: global mutation registers built-ins plus staged globals; project mutation calls `composePackageRegistry(builtins, currentGlobals, stagedProjects)` so package shadowing and cross-scope tool conflicts are checked before commit.

Return `plugin.lock_outdated` when the Bun adapter reports a frozen-lock mismatch; preserve `plugin.install_failed` for other package-manager failures.

- [ ] **Step 7: Run installer, transaction, and loader tests**

Run: `bun run test test/plugins/installer.test.ts test/plugins/transaction.test.ts test/plugins/package-metadata-loader.test.ts`

Expected: PASS.

Run: `bun run typecheck`

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/plugins/installer.ts test/plugins/installer.test.ts
git commit -m "feat: manage project and global plugin installs"
```

---

### Task 7: Plugin CLI Subcommands and Agent CLI Preservation

**Files:**
- Create: `src/cli/agent-command.ts`
- Create: `src/cli/plugin-command.ts`
- Modify: `src/cli/index.ts`
- Test: `test/plugins/plugin-command.test.ts`
- Test: `test/cli.test.ts`

**Interfaces:**
- Consumes: `PluginInstaller`, `BunPackageManager`, `InstalledPluginLoader`, `TrustStore`, `builtinTools`, Commander, and readline.
- Produces: `createCliProgram()`, `registerPluginCommand()`, `PluginCommandDependencies`, and unchanged Agent execution through `runAgentCommand()`.

- [ ] **Step 1: Write failing parser and service-dispatch tests**

Create `test/plugins/plugin-command.test.ts` using an injected fake service:

```ts
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
    "node", "coden", "plugin", "install", "npm:@acme/hello", "--global", "--allow-scripts",
  ]);
  expect(service.install).toHaveBeenCalledWith("npm:@acme/hello", {
    scope: "global",
    allowScripts: true,
  });
});
```

Also assert remove/list/sync dispatch, `--project`/`--global` mutual exclusion for list, and preserved parsing of `coden "fix tests"` and `coden --resume abc`.

- [ ] **Step 2: Write failing confirmation safety tests**

Add tests that assert:

- ordinary install asks once and refusal does not call the service;
- `--yes` skips the ordinary prompt;
- `--allow-scripts` always prints a second script warning and asks for confirmation unless `--yes`
  was supplied;
- `--yes --allow-scripts` still prints the warning but skips its confirmation prompt;
- `--yes` without `--allow-scripts` still passes `allowScripts: false`;
- the ordinary prompt states that validation imports plugin top-level code with full permissions;
- successful install output includes package/version/scope/tools/restart;
- errors set exit code `2` without leaking fake environment secrets.

- [ ] **Step 3: Run CLI tests and verify failure**

Run: `bun run test test/plugins/plugin-command.test.ts test/cli.test.ts`

Expected: FAIL because the root command factory and plugin subcommands do not exist.

- [ ] **Step 4: Extract the existing Agent path without behavior changes**

Move current `CliOptions`, `main`, configuration handling, provider setup, session setup, REPL, and helper functions from `src/cli/index.ts` into `src/cli/agent-command.ts` behind:

```ts
export interface AgentCommandOptions {
  provider?: ProviderName;
  model?: string;
  resume?: string | boolean;
  auto: boolean;
  verbose: boolean;
  maxSteps?: number;
  plugin: string[];
  print: boolean;
}

export async function runAgentCommand(
  initialPrompt: string | undefined,
  options: AgentCommandOptions,
): Promise<void>;
```

Do not alter terminal output, exit codes, resume behavior, or REPL commands in this step.

- [ ] **Step 5: Implement plugin command registration**

Create `src/cli/plugin-command.ts`:

```ts
export interface PluginCommandService {
  install(raw: string, options: PluginOperationOptions): Promise<InstalledPluginSummary>;
  remove(packageName: string, options: PluginOperationOptions): Promise<void>;
  sync(options: PluginOperationOptions): Promise<InstalledPluginSummary[]>;
  list(): Promise<{ project: ListedPlugin[]; global: ListedPlugin[] }>;
}

export interface PluginCommandDependencies {
  service: PluginCommandService;
  confirm(message: string): Promise<boolean>;
  stdout: Pick<NodeJS.WriteStream, "write">;
  stderr: Pick<NodeJS.WriteStream, "write">;
}

export function registerPluginCommand(program: Command, dependencies: PluginCommandDependencies): void;
```

Register exact command signatures:

```text
plugin install <specifier> [--global] [--allow-scripts] [--yes]
plugin remove <package> [--global] [--allow-scripts] [--yes]
plugin list [--project|--global]
plugin sync [--global] [--allow-scripts] [--yes]
```

`remove --allow-scripts` is needed because rebuilding remaining dependencies may require lifecycle scripts. Render deterministic sorted list output and concise operation summaries.

- [ ] **Step 6: Rebuild `src/cli/index.ts` as the composition root**

Export a testable factory:

```ts
export interface CliDependencies {
  pluginService?: PluginCommandService;
  confirm?: (message: string) => Promise<boolean>;
}

export function createCliProgram(dependencies: CliDependencies = {}): Command;
```

Production defaults instantiate `PluginInstaller` with workspace/data paths, `BunPackageManager`, `InstalledPluginLoader`, and built-ins. Preserve the shebang and invoke `parseAsync()` only when the file is the executable entry. Route no-subcommand root arguments/options to `runAgentCommand()`.

Before project `install` or `sync`, resolve `realpath(workspace)`, consult `TrustStore`, and persist trust after affirmative confirmation. Do not trust on refusal or failed confirmation input.

- [ ] **Step 7: Run focused and existing CLI tests**

Run: `bun run test test/plugins/plugin-command.test.ts test/cli.test.ts test/config.test.ts`

Expected: PASS.

Run: `bun run typecheck`

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/cli/index.ts src/cli/agent-command.ts src/cli/plugin-command.ts test/plugins/plugin-command.test.ts test/cli.test.ts
git commit -m "feat: add plugin management commands"
```

---

### Task 8: Runtime Startup Integration, Trust, and Reload Composition

**Files:**
- Modify: `src/tools/plugin-loader.ts`
- Modify: `src/cli/agent-command.ts`
- Modify: `src/config/trust.ts`
- Modify: `test/plugin-terminal.test.ts`
- Test: `test/runtime.integration.test.ts`

**Interfaces:**
- Consumes: installed loader/composition, source-aware Registry, existing `PluginLoader`, `EventBus`, and `TrustStore`.
- Produces: startup composition of effective npm packages plus local plugins, workspace-realpath trust helpers, and atomic `/reload` Registry replacement.

- [ ] **Step 1: Write failing startup composition tests**

Add integration tests that build temporary global/project Runtime fixtures and assert:

```ts
it("loads global and trusted project npm tools into model context", async () => {
  const harness = await runtimeHarnessWithPackages({
    global: ["@fixtures/single-tool"],
    project: ["@fixtures/multi-tool"],
    trusted: true,
  });
  await harness.run("use fixtures");
  expect(harness.provider.requests[0]?.tools.map((tool) => tool.name)).toEqual(
    expect.arrayContaining(["fixture_single", "fixture_first", "fixture_second"]),
  );
});

it("skips untrusted project npm packages but keeps global packages", async () => {
  const harness = await runtimeHarnessWithPackages({
    global: ["@fixtures/single-tool"],
    project: ["@fixtures/multi-tool"],
    trusted: false,
  });
  await harness.run("list tools");
  const names = harness.provider.requests[0]?.tools.map((tool) => tool.name);
  expect(names).toContain("fixture_single");
  expect(names).not.toContain("fixture_first");
  expect(harness.events).toContainEqual(expect.objectContaining({ type: "plugin.unavailable" }));
});
```

Also test project package shadowing, local plugin conflict isolation, missing Runtime diagnostics that suggest `coden plugin sync`, and `/reload` retaining cached npm tools while refreshing a changed local `.ts` tool.

- [ ] **Step 2: Run focused integration tests and verify failure**

Run: `bun run test test/runtime.integration.test.ts test/plugin-terminal.test.ts`

Expected: FAIL because Agent startup does not load installed manifests.

- [ ] **Step 3: Let the local loader extend a candidate Registry**

Change `PluginLoader.load` to:

```ts
async load(
  directories: Array<{ path: string; project: boolean }>,
  baseRegistry?: ToolRegistry,
): Promise<PluginLoadResult> {
  const registry = baseRegistry?.clone() ?? new ToolRegistry(this.builtins);
  // Existing sorted loading, isolation, events, trust, and caching continue.
}
```

Pass `{ kind: "local", path: file }` to `registry.register`. Existing callers that omit `baseRegistry` must behave exactly as before.

- [ ] **Step 4: Add workspace-realpath trust helpers**

Extend `TrustStore` with aliases that make the trust subject explicit without breaking existing path storage:

```ts
async isWorkspaceTrusted(workspace: string): Promise<boolean> {
  return this.isTrusted(await realpath(workspace));
}

async trustWorkspace(workspace: string): Promise<void> {
  return this.trust(await realpath(workspace));
}
```

Use these methods for npm project plugins. Keep the existing local directory trust callback intact to avoid silently broadening prior trust records.

- [ ] **Step 5: Compose installed packages before local plugin reload**

In `runAgentCommand()`:

1. resolve global/project `PluginPaths`;
2. call transaction recovery for both scopes before reading them;
3. always load global installed packages;
4. load project installed packages only when `options.auto` or workspace trust allows it;
5. emit `plugin.loaded`, `plugin.failed`, and `plugin.unavailable` with package/source details;
6. call `composePackageRegistry(builtins, global.loaded, project.loaded)`;
7. pass that Registry into local `PluginLoader.load(pluginDirs, packageRegistry)`;
8. atomically `registry.replaceWith(loaded.registry)` only after candidate completion.

For `/reload`, repeat package manifest discovery but accept that `InstalledPluginLoader` returns Bun-cached modules. Print or emit a restart-required diagnostic if on-disk package metadata differs from the version loaded at process start.

- [ ] **Step 6: Run plugin/runtime/CLI suites**

Run: `bun run test test/runtime.integration.test.ts test/plugin-terminal.test.ts test/plugins test/cli.test.ts`

Expected: PASS.

Run: `bun run typecheck`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/tools/plugin-loader.ts src/cli/agent-command.ts src/config/trust.ts test/plugin-terminal.test.ts test/runtime.integration.test.ts
git commit -m "feat: load installed plugins at runtime"
```

---

### Task 9: Reproducibility Files, Documentation, and End-to-End Verification

**Files:**
- Modify: `.gitignore`
- Modify: `README.md`
- Modify: `src/index.ts`
- Modify: `package.json`
- Test: `test/plugins/plugin-command.test.ts`
- Test: `test/plugin-terminal.test.ts`

**Interfaces:**
- Consumes: all previous tasks.
- Produces: documented package-author/user workflow, trackable project lock artifacts, final public exports, and a clean verified release candidate.

- [ ] **Step 1: Add a failing project artifact integration test**

Add to `test/plugins/plugin-command.test.ts`:

```ts
it("creates the project files intended for version control", async () => {
  const harness = await cliHarnessWithFixturePackage();
  await harness.run(["plugin", "install", "npm:@fixtures/single-tool", "--yes"]);
  expect(await readFile(path.join(harness.workspace, ".coden", "plugins.json"), "utf8")).toContain("@fixtures/single-tool");
  expect(await readFile(path.join(harness.workspace, ".coden", "plugin-runtime", ".gitignore"), "utf8")).toBe(
    "*\n!.gitignore\n!bun.lock\n",
  );
  await expect(access(path.join(harness.workspace, ".coden", "plugin-runtime", "bun.lock"))).resolves.toBeUndefined();
});
```

Add an end-to-end fixture test that spawns the Bun runtime, installs through the fake package-manager seam, starts Agent startup composition, and observes the fixture tool in the Registry. It must remain offline.

- [ ] **Step 2: Run the artifact test and verify the expected gap**

Run: `bun run test test/plugins/plugin-command.test.ts`

Expected: FAIL if Runtime `.gitignore`, lock preservation, or exported composition is incomplete.

- [ ] **Step 3: Update repository ignore rules without exposing local hand-written plugins**

Replace the blanket `.coden/` line in the repository root `.gitignore` with:

```gitignore
.coden/*
!.coden/plugins.json
!.coden/plugin-runtime/
.coden/plugin-runtime/*
!.coden/plugin-runtime/.gitignore
!.coden/plugin-runtime/bun.lock
```

This keeps the existing `.coden/plugins/line-count.ts` ignored while allowing this repository to track the same reproducibility files recommended to users.

- [ ] **Step 4: Finish public exports**

Ensure `src/index.ts` exports stable non-CLI modules:

```ts
export * from "./plugins/api.js";
export * from "./plugins/installer.js";
export * from "./plugins/installed-loader.js";
export * from "./plugins/manifest.js";
export * from "./plugins/paths.js";
export * from "./plugins/specifier.js";
```

Do not export `src/cli/*`, transaction fault hooks, or internal package-manager formatting helpers through the root package.

- [ ] **Step 5: Document user and package-author workflows**

Expand README with exact commands:

```bash
coden plugin install npm:@scope/coden-plugin-example
coden plugin install npm:@scope/coden-plugin-example@^2 --global
coden plugin list
coden plugin sync
coden plugin remove @scope/coden-plugin-example
```

Include:

- project/global paths and files to commit;
- mandatory `package.json#coden` example;
- single-tool and `CodeNPlugin` multi-tool exports;
- requirement to publish `dist/*.js` or `dist/*.mjs`;
- default `--ignore-scripts` behavior and `--allow-scripts` warning;
- public npmjs-only v1 source policy;
- project trust behavior;
- full-process-permission/no-sandbox warning;
- npm changes require restart while local `.ts` `/reload` remains supported.

- [ ] **Step 6: Run formatting and focused tests**

Run: `bun run format`

Expected: Biome formats changed TypeScript/JSON without changing semantics.

Run: `markdownlint-cli2 README.md docs/superpowers/specs/2026-08-28-npm-plugin-install-design.md docs/superpowers/plans/2026-08-28-npm-plugin-install.md`

Expected: 0 issues.

Run: `bun run test test/plugins test/plugin-terminal.test.ts test/cli.test.ts test/runtime.integration.test.ts test/tools.test.ts`

Expected: PASS with no network access.

- [ ] **Step 7: Run the complete project gate**

Run: `just check`

Expected: Biome lint PASS, strict TypeScript PASS, and all offline Vitest tests PASS; live tests remain skipped unless explicitly enabled.

Run: `git diff --check`

Expected: no whitespace errors.

- [ ] **Step 8: Verify CLI help manually**

Run:

```bash
bun run src/cli/index.ts plugin --help
bun run src/cli/index.ts plugin install --help
bun run src/cli/index.ts --help
```

Expected: plugin commands/options are present, `--allow-scripts` warnings are described, and all existing Agent options remain present.

- [ ] **Step 9: Commit**

```bash
git add .gitignore README.md src/index.ts package.json test/plugins/plugin-command.test.ts test/plugin-terminal.test.ts
git commit -m "docs: document npm plugin workflow"
```

- [ ] **Step 10: Confirm a clean final state**

Run: `git status --short`

Expected: no output.
