import { mkdirSync } from "node:fs";
import { access, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { type PluginPaths, resolvePluginPaths } from "../../src/plugins/paths.js";
import { PluginTransaction, type TransactionPoint } from "../../src/plugins/transaction.js";

it("commits a staged manifest and runtime together", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "coden-transaction-"));
  const paths = resolvePluginPaths(workspace, "project", path.join(workspace, "data"));
  await seedCurrent(paths, "old");

  const result = await new PluginTransaction(paths).run(async (candidate) => {
    await writeFile(candidate.manifestPath, '{"value":"new"}\n');
    await mkdir(candidate.runtimeDir, { recursive: true });
    await writeFile(path.join(candidate.runtimeDir, "value"), "new");
    return "committed";
  });

  expect(result).toBe("committed");
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

it("rejects a concurrent live owner", async () => {
  const { paths } = await seededPaths();
  await mkdir(paths.lockPath);
  await writeFile(
    path.join(paths.lockPath, "owner.json"),
    JSON.stringify({ pid: process.pid, createdAt: Date.now() }),
    { mode: 0o600 },
  );

  await expect(new PluginTransaction(paths).run(async () => undefined)).rejects.toThrow(
    /plugin.install_busy/,
  );
});

it("treats a missing lock owner as busy without removing the lock", async () => {
  const { paths } = await seededPaths();
  await mkdir(paths.lockPath);

  await expect(new PluginTransaction(paths).run(async () => undefined)).rejects.toThrow(
    /plugin.install_busy/,
  );

  expect(await pathExists(paths.lockPath)).toBe(true);
  await expectCurrent(paths, "old");
});

it("treats an invalid lock owner as busy without removing the lock", async () => {
  const { paths } = await seededPaths();
  await mkdir(paths.lockPath);
  await writeFile(path.join(paths.lockPath, "owner.json"), "not json", { mode: 0o600 });

  await expect(
    new PluginTransaction(paths, {
      isProcessAlive() {
        throw new Error("invalid owner must not be checked as stale");
      },
    }).run(async () => undefined),
  ).rejects.toThrow(/plugin.install_busy/);

  expect(await pathExists(paths.lockPath)).toBe(true);
  await expectCurrent(paths, "old");
});

it("removes a stale owner and retries the lock once", async () => {
  const { paths } = await seededPaths();
  await mkdir(paths.lockPath);
  await writeFile(
    path.join(paths.lockPath, "owner.json"),
    JSON.stringify({ pid: 999_999, createdAt: Date.now() }),
    {
      mode: 0o600,
    },
  );

  await new PluginTransaction(paths, { isProcessAlive: () => false }).run(writeNewCandidate);

  await expectCurrent(paths, "new");
  expect(await pathExists(paths.lockPath)).toBe(false);
});

it.each(["after-backup", "after-runtime-commit", "after-manifest-commit"] as const)(
  "recovers an interruption at %s",
  async (point) => {
    const { paths } = await seededPaths();
    const interrupted = new PluginTransaction(paths, {
      fault(pointReached: TransactionPoint) {
        if (pointReached === point) throw new Error(`fault:${point}`);
      },
    });

    await expect(interrupted.run(writeNewCandidate)).rejects.toThrow(`fault:${point}`);
    await new PluginTransaction(paths).recover();

    await expectConsistentOldOrNew(paths);
    expect(await pathExists(paths.transactionPath)).toBe(false);
    expect(await pathExists(paths.lockPath)).toBe(false);
  },
);

it("rolls back when persisting the manifest-committed marker fails", async () => {
  const { paths } = await seededPaths();

  await expect(
    new PluginTransaction(paths, {
      fault(point) {
        if (point === "after-runtime-commit") mkdirSync(`${paths.transactionPath}.tmp`);
      },
    }).run(writeNewCandidate),
  ).rejects.toThrow();

  await expectCurrent(paths, "old");
  expect(await pathExists(paths.transactionPath)).toBe(false);
  expect(await pathExists(`${paths.transactionPath}.tmp`)).toBe(false);
});

it("rolls back immediately when candidate paths are incomplete", async () => {
  const { paths } = await seededPaths();

  await expect(
    new PluginTransaction(paths).run(async (candidate) => {
      await writeFile(candidate.manifestPath, '{"value":"new"}\n');
    }),
  ).rejects.toThrow(/plugin.transaction_recovery_failed|candidate/i);

  await expectCurrent(paths, "old");
  expect(await pathExists(paths.transactionPath)).toBe(false);
});

async function seededPaths(): Promise<{ workspace: string; paths: PluginPaths }> {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "coden-transaction-"));
  const paths = resolvePluginPaths(workspace, "project", path.join(workspace, "data"));
  await seedCurrent(paths, "old");
  return { workspace, paths };
}

async function seedCurrent(paths: PluginPaths, value: string): Promise<void> {
  await rm(paths.root, { recursive: true, force: true });
  await mkdir(paths.runtimeDir, { recursive: true });
  await writeFile(paths.manifestPath, `{"value":"${value}"}\n`);
  await writeFile(path.join(paths.runtimeDir, "value"), value);
}

async function writeNewCandidate(candidate: {
  manifestPath: string;
  runtimeDir: string;
}): Promise<string> {
  await writeFile(candidate.manifestPath, '{"value":"new"}\n');
  await mkdir(candidate.runtimeDir, { recursive: true });
  await writeFile(path.join(candidate.runtimeDir, "value"), "new");
  return "new";
}

async function expectCurrent(paths: PluginPaths, value: string): Promise<void> {
  expect(await readFile(paths.manifestPath, "utf8")).toContain(value);
  expect(await readFile(path.join(paths.runtimeDir, "value"), "utf8")).toBe(value);
}

async function expectConsistentOldOrNew(paths: PluginPaths): Promise<void> {
  const manifest = await readFile(paths.manifestPath, "utf8");
  const runtimeValue = await readFile(path.join(paths.runtimeDir, "value"), "utf8");
  if (manifest.includes("old")) {
    expect(runtimeValue).toBe("old");
  } else if (manifest.includes("new")) {
    expect(runtimeValue).toBe("new");
  } else {
    throw new Error(`unexpected manifest content: ${manifest}`);
  }
  expect(await leftoverTransactionEntries(paths)).toEqual([]);
}

async function leftoverTransactionEntries(paths: PluginPaths): Promise<string[]> {
  const names = await readdir(paths.root);
  return names.filter((name) => name.startsWith(".transaction-") || name === "plugin-lock");
}

async function pathExists(file: string): Promise<boolean> {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}
