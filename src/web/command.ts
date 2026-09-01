import { access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ConfigError } from "../cli/agent-application.js";
import type { AgentCommandOptions } from "../cli/agent-command.js";
import type { I18n } from "../i18n/i18n.js";
import { openBrowser } from "./browser.js";
import { WebController } from "./controller.js";
import { type StartWebServerOptions, startWebServer, type WebServerHandle } from "./server.js";
import { WebStore } from "./store.js";

export interface RunWebCommandDependencies {
  startServer?: (options: StartWebServerOptions) => Promise<WebServerHandle>;
  open?: (url: string) => Promise<void>;
  createController?: (store: WebStore) => WebController;
  stdout?: Pick<NodeJS.WriteStream, "write">;
  stderr?: Pick<NodeJS.WriteStream, "write">;
}

export async function resolveWebAssetsRoot(): Promise<string> {
  const override = process.env.CODEN_WEB_ASSETS_DIR;
  const current = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    ...(override ? [path.resolve(override)] : []),
    path.join(current, "web"),
    path.resolve(current, "../../dist/web"),
  ];
  for (const candidate of candidates) {
    try {
      await access(path.join(candidate, "index.html"));
      return candidate;
    } catch {
      // Try the next source or packaged location.
    }
  }
  throw new ConfigError("Web assets are missing; run `just build` or `just web-check`");
}

export async function runWebCommand(
  initialPrompt: string | undefined,
  command: AgentCommandOptions,
  i18n: I18n,
  dependencies: RunWebCommandDependencies = {},
): Promise<void> {
  const output = dependencies.stdout ?? process.stdout;
  const errors = dependencies.stderr ?? process.stderr;
  const store = new WebStore(i18n.currentLanguage);
  const controller =
    dependencies.createController?.(store) ??
    new WebController({
      workspace: process.cwd(),
      command,
      i18n,
      store,
      onDiagnostic(message) {
        errors.write(`${i18n.messages.cli.error(message)}\n`);
      },
    });
  const start = dependencies.startServer ?? startWebServer;
  const assetsRoot = await resolveWebAssetsRoot();
  const handle = await start({
    host: command.webHost ?? "127.0.0.1",
    port: command.webPort ?? 0,
    assetsRoot,
    controller,
    store,
    onError(error) {
      errors.write(
        `${i18n.messages.cli.error(error instanceof Error ? error.message : String(error))}\n`,
      );
    },
  });
  output.write(`${i18n.messages.cli.webStarted(handle.accessUrl)}\n`);
  if (handle.remote) {
    errors.write(`${i18n.messages.cli.webRemoteToken}\n`);
    errors.write(`${i18n.messages.cli.webNoTls}\n`);
  }
  if (command.open !== false) {
    try {
      await (dependencies.open ?? openBrowser)(handle.accessUrl);
    } catch (error) {
      errors.write(
        `${i18n.messages.cli.webOpenFailed(error instanceof Error ? error.message : String(error))}\n`,
      );
    }
  }

  let resolveStop!: () => void;
  const stopped = new Promise<void>((resolve) => {
    resolveStop = resolve;
  });
  let stopping = false;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    resolveStop();
  };
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) process.once(signal, stop);
  try {
    await controller.bootstrap();
    if (initialPrompt && controller.ready) {
      const client = controller.connectClient("initial-prompt");
      controller.submit(client.clientId, initialPrompt);
    }
    await stopped;
  } finally {
    for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const)
      process.removeListener(signal, stop);
    await handle.close();
  }
}
