import path from "node:path";
import { userDataDir } from "../config/config.js";

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
): PluginPaths {
  if (scope === "project") {
    const root = path.join(workspace, ".coden");
    const runtimeDir = path.join(root, "plugin-runtime");
    return {
      scope,
      root,
      manifestPath: path.join(root, "plugins.json"),
      runtimeDir,
      lockPath: path.join(root, "plugin-lock"),
      transactionPath: path.join(runtimeDir, ".transaction.json"),
    };
  }

  const root = path.join(dataDir, "plugins");
  const runtimeDir = path.join(root, "runtime");
  return {
    scope,
    root,
    manifestPath: path.join(root, "plugins.json"),
    runtimeDir,
    lockPath: path.join(root, "plugin-lock"),
    transactionPath: path.join(runtimeDir, ".transaction.json"),
  };
}
