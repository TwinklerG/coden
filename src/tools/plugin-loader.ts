import { createHash, randomUUID } from "node:crypto";
import { readdir, readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { EventBus } from "../core/events.js";
import type { ToolDefinition } from "../core/types.js";
import { ToolRegistry } from "./registry.js";

export type ProjectTrust = (realPluginDirectory: string) => Promise<boolean>;
export interface PluginLoadResult {
  registry: ToolRegistry;
  loaded: string[];
  failed: string[];
}

export type PluginImporter = (specifier: string) => Promise<{ default?: unknown }>;

export class PluginLoader {
  private static readonly defaultImporter: PluginImporter = (specifier) => import(specifier);
  // Bun keys its module and directory caches by real path and ignores query
  // strings, so re-importing a changed plugin file returns the stale module.
  // Content-hash caching plus data: URL imports make /reload deterministic.
  readonly #moduleCache = new Map<string, { hash: string; module: { default?: unknown } }>();
  constructor(
    private readonly builtins: ToolDefinition[],
    private readonly events: EventBus,
    private readonly trust?: ProjectTrust,
    private readonly importer: PluginImporter = PluginLoader.defaultImporter,
  ) {}
  async load(
    directories: Array<{ path: string; project: boolean }>,
    baseRegistry?: ToolRegistry,
  ): Promise<PluginLoadResult> {
    const registry = baseRegistry?.clone() ?? new ToolRegistry(this.builtins);
    const loaded: string[] = [];
    const failed: string[] = [];
    for (const target of directories) {
      try {
        const real = await realpath(target.path);
        const targetStat = await stat(real);
        const trustPath = targetStat.isDirectory() ? real : path.dirname(real);
        if (target.project) {
          const trusted = this.trust ? await this.trust(trustPath) : false;
          if (!trusted) {
            await this.events.emit("plugin.unavailable", {
              path: trustPath,
              reason: "not trusted",
            });
            continue;
          }
        }
        const files = targetStat.isDirectory()
          ? (await readdir(real))
              .filter((entry) => entry.endsWith(".ts"))
              .sort()
              .map((entry) => path.join(real, entry))
          : real.endsWith(".ts")
            ? [real]
            : [];
        for (const file of files) {
          try {
            const module = await this.importPlugin(file);
            if (!isToolDefinition(module.default))
              throw new Error("default export is not a ToolDefinition");
            registry.register(module.default, { kind: "local", path: file });
            loaded.push(module.default.name);
            await this.events.emit("plugin.loaded", { path: file, name: module.default.name });
          } catch (error) {
            failed.push(file);
            await this.events.emit("plugin.failed", {
              path: file,
              message: error instanceof Error ? error.message : String(error),
            });
          }
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
          failed.push(target.path);
          await this.events.emit("plugin.failed", {
            path: target.path,
            message: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }
    return { registry, loaded, failed };
  }

  private async importPlugin(file: string): Promise<{ default?: unknown }> {
    if (this.importer !== PluginLoader.defaultImporter) {
      // Test seam: injected importers receive a file URL with an mtime marker.
      const mtime = (await stat(file)).mtimeMs;
      return this.importer(`${pathToFileURL(file).href}?mtime=${mtime}`);
    }
    const source = await readFile(file, "utf8");
    const hash = createHash("sha256").update(source).digest("hex");
    const cached = this.#moduleCache.get(file);
    if (cached?.hash === hash) return cached.module;
    // Plugins must be single-file and self-contained: relative imports cannot
    // resolve from a data: URL, while bare package imports resolve from the
    // current working directory as usual.
    const stamped = `// coden-source: ${pathToFileURL(file).href}\n// coden-load: ${randomUUID()}\n${source}\n//# sourceURL=${pathToFileURL(file).href}\n`;
    const module = (await this.importer(
      `data:text/typescript;base64,${Buffer.from(stamped).toString("base64")}`,
    )) as { default?: unknown };
    this.#moduleCache.set(file, { hash, module });
    return module;
  }
}

function isToolDefinition(value: unknown): value is ToolDefinition {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<ToolDefinition>;
  return (
    typeof candidate.name === "string" &&
    typeof candidate.description === "string" &&
    (candidate.risk === "read" || candidate.risk === "modify" || candidate.risk === "dangerous") &&
    !!candidate.inputSchema &&
    typeof candidate.execute === "function"
  );
}
