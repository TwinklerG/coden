import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { EventBus } from "../../src/core/events.js";
import { builtinTools } from "../../src/tools/builtin/index.js";
import { PluginLoader } from "../../src/tools/plugin-loader.js";

const [v1Path, v2Path] = process.argv.slice(2);
if (!v1Path || !v2Path) throw new Error("usage: plugin-reload.ts <v1-plugin.ts> <v2-plugin.ts>");
const v1 = await readFile(v1Path, "utf8");
const v2 = await readFile(v2Path, "utf8");

const workspace = await mkdtemp(path.join(os.tmpdir(), "coden-plugin-"));
const pluginDir = path.join(workspace, "plugins");
await mkdir(pluginDir);
const pluginFile = path.join(pluginDir, "hello.ts");
await writeFile(pluginFile, v1);

const loader = new PluginLoader(builtinTools(), new EventBus());
const first = await loader.load([{ path: pluginDir, project: false }]);
const firstResult = await first.registry
  .get("hello")
  ?.execute({}, { workspace, signal: new AbortController().signal });

await new Promise((resolve) => setTimeout(resolve, 20));
await writeFile(pluginFile, v2);

const second = await loader.load([{ path: pluginDir, project: false }]);
const secondResult = await second.registry
  .get("hello")
  ?.execute({}, { workspace, signal: new AbortController().signal });

console.log(
  JSON.stringify({
    first: firstResult?.content,
    second: secondResult?.content,
    loaded: second.loaded,
  }),
);
