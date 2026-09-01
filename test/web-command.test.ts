import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentCommandOptions } from "../src/cli/agent-command.js";
import { I18n } from "../src/i18n/i18n.js";
import { browserCommand } from "../src/web/browser.js";
import { runWebCommand } from "../src/web/command.js";
import type { WebController } from "../src/web/controller.js";
import type { WebServerHandle } from "../src/web/server.js";

const command: AgentCommandOptions = {
  auto: false,
  smartApprove: false,
  allowOutsideWorkspace: false,
  verbose: false,
  plugin: [],
  print: false,
  tui: false,
  cli: false,
  web: true,
  webHost: "127.0.0.1",
  webPort: 0,
  open: false,
};

afterEach(() => {
  delete process.env.CODEN_WEB_ASSETS_DIR;
});

describe("browser command", () => {
  it("uses argument arrays without a shell", () => {
    expect(browserCommand("http://localhost", "darwin")).toMatchObject({
      command: "open",
      args: ["http://localhost"],
      options: { shell: false },
    });
    expect(browserCommand("http://localhost", "linux")).toMatchObject({
      command: "xdg-open",
      args: ["http://localhost"],
    });
    expect(browserCommand("http://localhost", "win32")).toMatchObject({
      command: "cmd",
      args: ["/c", "start", "", "http://localhost"],
      options: { shell: false },
    });
  });
});

describe("Web command", () => {
  it("prints the URL, submits the initial task, and closes once", async () => {
    const assets = path.join(tmpdir(), `coden-command-${crypto.randomUUID()}`);
    await mkdir(assets);
    await writeFile(path.join(assets, "index.html"), "ok");
    process.env.CODEN_WEB_ASSETS_DIR = assets;
    const output: string[] = [];
    const errors: string[] = [];
    const close = vi.fn(async () => {});
    const submit = vi.fn();
    const controller = {
      ready: true,
      bootstrap: vi.fn(async () => {}),
      connectClient: vi.fn(() => ({ clientId: "initial", isOwner: true })),
      submit,
    } as unknown as WebController;
    const handle = {
      origin: "http://127.0.0.1:1234",
      port: 1234,
      accessUrl: "http://127.0.0.1:1234/",
      remote: false,
      controller,
      close,
    } as WebServerHandle;
    const result = runWebCommand("fix", command, new I18n("en"), {
      createController: () => controller,
      startServer: async () => {
        setTimeout(() => process.emit("SIGTERM"), 0);
        return handle;
      },
      stdout: { write: (value: string) => output.push(value) } as unknown as NodeJS.WriteStream,
      stderr: { write: (value: string) => errors.push(value) } as unknown as NodeJS.WriteStream,
    });
    await result;
    expect(output.join("")).toContain(handle.accessUrl);
    expect(errors).toEqual([]);
    expect(submit).toHaveBeenCalledWith("initial", "fix");
    expect(close).toHaveBeenCalledOnce();
  });
});
