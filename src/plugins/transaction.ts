import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { access, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { CodeNError } from "../core/types.js";
import type { PluginPaths } from "./paths.js";

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

interface LockOwner {
  pid: number;
  createdAt: number;
}

class FaultInterruption extends Error {
  constructor(cause: unknown) {
    super(
      cause instanceof Error ? cause.message : String(cause),
      cause instanceof Error ? { cause } : undefined,
    );
    this.name = "FaultInterruption";
  }
}

export class PluginTransaction {
  constructor(
    private readonly paths: PluginPaths,
    private readonly options: PluginTransactionOptions = {},
  ) {}

  async run<T>(builder: (candidate: PluginTransactionCandidate) => Promise<T>): Promise<T> {
    let ownsLock = false;
    let marker: TransactionMarker | undefined;
    try {
      await this.acquireLock();
      ownsLock = true;
      await this.recoverLocked();

      const id = randomUUID();
      const stageDirectory = path.join(this.paths.root, `.transaction-${id}-stage`);
      marker = {
        version: 1,
        id,
        phase: "prepared",
        stageDirectory,
        backupManifestPath: path.join(this.paths.root, `.transaction-${id}-plugins.json.bak`),
        backupRuntimeDir: path.join(this.paths.root, `.transaction-${id}-runtime.bak`),
        hadManifest: await pathExists(this.paths.manifestPath),
        hadRuntime: await pathExists(this.paths.runtimeDir),
      };

      await mkdir(stageDirectory, { recursive: true });
      const candidate = {
        manifestPath: path.join(stageDirectory, "plugins.json"),
        runtimeDir: path.join(stageDirectory, "runtime"),
      };
      const result = await builder(candidate);
      await this.verifyCandidate(candidate);

      await this.writeMarker(marker);
      await this.backupCurrent(marker);
      marker = { ...marker, phase: "backed-up" };
      await this.writeMarker(marker);
      this.fault("after-backup");

      await rename(candidate.runtimeDir, this.paths.runtimeDir);
      marker = { ...marker, phase: "runtime-committed" };
      await this.writeMarker(marker);
      this.fault("after-runtime-commit");

      await rename(candidate.manifestPath, this.paths.manifestPath);
      marker = { ...marker, phase: "manifest-committed" };
      await this.writeMarker(marker);
      this.fault("after-manifest-commit");

      await this.cleanupCommitted(marker);
      return result;
    } catch (error) {
      if (error instanceof FaultInterruption) throw error.cause ?? error;
      await this.rollbackAfterError(marker);
      throw error;
    } finally {
      if (ownsLock) await this.releaseLock();
    }
  }

  async recover(): Promise<void> {
    let ownsLock = false;
    try {
      await this.acquireLock();
      ownsLock = true;
      await this.recoverLocked();
    } finally {
      if (ownsLock) await this.releaseLock();
    }
  }

  private async acquireLock(): Promise<void> {
    await mkdir(this.paths.root, { recursive: true });
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        await mkdir(this.paths.lockPath);
      } catch (error) {
        if (!isFileSystemError(error, "EEXIST")) throw error;
        const owner = await this.readLockOwner();
        if (owner && this.isProcessAlive(owner.pid)) {
          throw new CodeNError(
            "plugin",
            "plugin.install_busy",
            `plugin.install_busy: ${this.paths.scope} plugin installation is already running`,
            true,
            { scope: this.paths.scope },
          );
        }
        if (attempt === 1) {
          throw new CodeNError(
            "plugin",
            "plugin.install_busy",
            `plugin.install_busy: could not acquire ${this.paths.scope} plugin lock`,
            true,
            { scope: this.paths.scope },
          );
        }
        await rm(this.paths.lockPath, { recursive: true, force: true });
        continue;
      }

      try {
        await writeFile(
          path.join(this.paths.lockPath, "owner.json"),
          `${JSON.stringify({ pid: process.pid, createdAt: this.now() } satisfies LockOwner)}\n`,
          { mode: 0o600 },
        );
        return;
      } catch (error) {
        await rm(this.paths.lockPath, { recursive: true, force: true });
        throw error;
      }
    }
  }

  private async readLockOwner(): Promise<LockOwner | undefined> {
    try {
      const owner = JSON.parse(
        await readFile(path.join(this.paths.lockPath, "owner.json"), "utf8"),
      ) as Partial<LockOwner>;
      if (typeof owner.pid === "number" && Number.isInteger(owner.pid) && owner.pid > 0) {
        return {
          pid: owner.pid,
          createdAt: typeof owner.createdAt === "number" ? owner.createdAt : 0,
        };
      }
      return undefined;
    } catch {
      return undefined;
    }
  }

  private async releaseLock(): Promise<void> {
    await rm(this.paths.lockPath, { recursive: true, force: true });
  }

  private async verifyCandidate(candidate: PluginTransactionCandidate): Promise<void> {
    if (!(await pathExists(candidate.manifestPath)) || !(await pathExists(candidate.runtimeDir))) {
      throw new CodeNError(
        "plugin",
        "plugin.transaction_recovery_failed",
        "plugin.transaction_recovery_failed: candidate manifest and runtime are required",
        false,
        { scope: this.paths.scope },
      );
    }
  }

  private async backupCurrent(marker: TransactionMarker): Promise<void> {
    await rm(marker.backupManifestPath, { force: true });
    await rm(marker.backupRuntimeDir, { recursive: true, force: true });
    if (marker.hadManifest) await rename(this.paths.manifestPath, marker.backupManifestPath);
    if (marker.hadRuntime) await rename(this.paths.runtimeDir, marker.backupRuntimeDir);
  }

  private async rollbackAfterError(marker: TransactionMarker | undefined): Promise<void> {
    if (!marker) return;
    try {
      if (marker.phase === "manifest-committed") {
        await this.cleanupCommitted(marker);
        return;
      }
      await this.restoreBackupPairBestEffort(marker);
      await this.cleanupRecoveryArtifacts(marker);
    } catch (error) {
      throw new CodeNError(
        "plugin",
        "plugin.transaction_recovery_failed",
        `plugin.transaction_recovery_failed: could not roll back ${this.paths.scope} plugin transaction`,
        false,
        { scope: this.paths.scope },
        error instanceof Error ? { cause: error } : undefined,
      );
    }
  }

  private async recoverLocked(): Promise<void> {
    const marker = await this.readMarker();
    if (!marker) return;

    try {
      if (marker.phase === "prepared") {
        await rm(marker.stageDirectory, { recursive: true, force: true });
        await rm(this.paths.transactionPath, { force: true });
        return;
      }

      if (marker.phase === "backed-up" || marker.phase === "runtime-committed") {
        await this.removeCurrentTargets();
        await this.restoreBackups(marker);
        await this.cleanupRecoveryArtifacts(marker);
        return;
      }

      await rm(marker.backupManifestPath, { force: true });
      await rm(marker.backupRuntimeDir, { recursive: true, force: true });
      await this.cleanupRecoveryArtifacts(marker);
    } catch (error) {
      throw new CodeNError(
        "plugin",
        "plugin.transaction_recovery_failed",
        `plugin.transaction_recovery_failed: could not recover ${this.paths.scope} plugin transaction`,
        false,
        { scope: this.paths.scope },
        error instanceof Error ? { cause: error } : undefined,
      );
    }
  }

  private async readMarker(): Promise<TransactionMarker | undefined> {
    try {
      const marker = JSON.parse(
        await readFile(this.paths.transactionPath, "utf8"),
      ) as Partial<TransactionMarker>;
      if (!isTransactionMarker(marker)) throw new Error("invalid transaction marker");
      return marker;
    } catch (error) {
      if (isFileSystemError(error, "ENOENT")) return undefined;
      throw new CodeNError(
        "plugin",
        "plugin.transaction_recovery_failed",
        `plugin.transaction_recovery_failed: invalid ${this.paths.scope} plugin transaction marker`,
        false,
        { scope: this.paths.scope },
        error instanceof Error ? { cause: error } : undefined,
      );
    }
  }

  private async writeMarker(marker: TransactionMarker): Promise<void> {
    await mkdir(path.dirname(this.paths.transactionPath), { recursive: true });
    const temporaryPath = `${this.paths.transactionPath}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(marker, null, 2)}\n`, { mode: 0o600 });
    await rename(temporaryPath, this.paths.transactionPath);
  }

  private async cleanupCommitted(marker: TransactionMarker): Promise<void> {
    await rm(marker.backupManifestPath, { force: true });
    await rm(marker.backupRuntimeDir, { recursive: true, force: true });
    await rm(marker.stageDirectory, { recursive: true, force: true });
    await rm(this.paths.transactionPath, { force: true });
    await rm(`${this.paths.transactionPath}.tmp`, { force: true });
  }

  private async cleanupRecoveryArtifacts(marker: TransactionMarker): Promise<void> {
    await rm(marker.stageDirectory, { recursive: true, force: true });
    await rm(this.paths.transactionPath, { force: true });
    await rm(`${this.paths.transactionPath}.tmp`, { force: true });
  }

  private async removeCurrentTargets(): Promise<void> {
    await rm(this.paths.manifestPath, { force: true });
    await rm(this.paths.runtimeDir, { recursive: true, force: true });
  }

  private async restoreBackups(marker: TransactionMarker): Promise<void> {
    if (marker.hadManifest) await rename(marker.backupManifestPath, this.paths.manifestPath);
    if (marker.hadRuntime) await rename(marker.backupRuntimeDir, this.paths.runtimeDir);
  }

  private async restoreBackupPairBestEffort(marker: TransactionMarker): Promise<void> {
    await this.restoreSingleBackup({
      hadTarget: marker.hadManifest,
      backupPath: marker.backupManifestPath,
      targetPath: this.paths.manifestPath,
      directory: false,
    });
    await this.restoreSingleBackup({
      hadTarget: marker.hadRuntime,
      backupPath: marker.backupRuntimeDir,
      targetPath: this.paths.runtimeDir,
      directory: true,
    });
  }

  private async restoreSingleBackup(options: {
    hadTarget: boolean;
    backupPath: string;
    targetPath: string;
    directory: boolean;
  }): Promise<void> {
    if (await pathExists(options.backupPath)) {
      await rm(options.targetPath, { recursive: options.directory, force: true });
      await rename(options.backupPath, options.targetPath);
      return;
    }
    if (!options.hadTarget)
      await rm(options.targetPath, { recursive: options.directory, force: true });
  }

  private fault(point: TransactionPoint): void {
    try {
      this.options.fault?.(point);
    } catch (error) {
      throw new FaultInterruption(error);
    }
  }

  private now(): number {
    return this.options.now?.() ?? Date.now();
  }

  private isProcessAlive(pid: number): boolean {
    if (this.options.isProcessAlive) return this.options.isProcessAlive(pid);
    try {
      process.kill(pid, 0);
      return true;
    } catch (error) {
      return !isFileSystemError(error, "ESRCH");
    }
  }
}

function isTransactionMarker(value: Partial<TransactionMarker>): value is TransactionMarker {
  return (
    value.version === 1 &&
    typeof value.id === "string" &&
    ["prepared", "backed-up", "runtime-committed", "manifest-committed"].includes(
      String(value.phase),
    ) &&
    typeof value.stageDirectory === "string" &&
    typeof value.backupManifestPath === "string" &&
    typeof value.backupRuntimeDir === "string" &&
    typeof value.hadManifest === "boolean" &&
    typeof value.hadRuntime === "boolean"
  );
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
