import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const webui = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const root = path.resolve(webui, "../..");
const args = process.argv.slice(2);
const run = (command, commandArgs, cwd) =>
  spawn(command, commandArgs, { cwd, stdio: "inherit", shell: false });

const initial = run("bun", ["run", "build"], webui);
const initialCode = await new Promise((resolve) => initial.once("exit", resolve));
if (initialCode !== 0) process.exit(initialCode ?? 1);

const children = [
  run("bun", ["run", "build:watch"], webui),
  run("bun", ["run", "src/cli/index.ts", "--web", ...args], root),
];
let stopping = false;
const stop = (signal = "SIGTERM") => {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill(signal);
};
for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => stop(signal));
for (const child of children) {
  child.once("exit", (code, signal) => {
    stop();
    if (signal) process.kill(process.pid, signal);
    else process.exitCode = code ?? 1;
  });
}
