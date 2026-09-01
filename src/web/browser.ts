import { type SpawnOptions, spawn } from "node:child_process";

export interface BrowserCommand {
  command: string;
  args: string[];
  options: SpawnOptions;
}

export function browserCommand(url: string, platform = process.platform): BrowserCommand {
  const options: SpawnOptions = { detached: true, stdio: "ignore", shell: false };
  if (platform === "darwin") return { command: "open", args: [url], options };
  if (platform === "win32") return { command: "cmd", args: ["/c", "start", "", url], options };
  return { command: "xdg-open", args: [url], options };
}

export async function openBrowser(url: string, platform = process.platform): Promise<void> {
  const launch = browserCommand(url, platform);
  await new Promise<void>((resolve, reject) => {
    const child = spawn(launch.command, launch.args, launch.options);
    child.once("error", reject);
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });
}
