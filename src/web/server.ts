import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { WebController } from "./controller.js";
import { createWebRouter } from "./router.js";
import { WebSecurityPolicy } from "./security.js";
import { loadStaticAssets } from "./static-assets.js";
import type { WebStore } from "./store.js";

export interface StartWebServerOptions {
  host: string;
  port: number;
  assetsRoot: string;
  controller: WebController;
  store: WebStore;
  onError?: (error: unknown) => void;
}

export interface WebServerHandle {
  origin: string;
  port: number;
  accessUrl: string;
  remote: boolean;
  accessToken?: string;
  controller: WebController;
  close(): Promise<void>;
}

export async function startWebServer(options: StartWebServerOptions): Promise<WebServerHandle> {
  const assets = await loadStaticAssets(options.assetsRoot);
  let router: ReturnType<typeof createWebRouter> | undefined;
  const server = createServer((request, response) => {
    if (!router) {
      response.writeHead(503).end();
      return;
    }
    void router.handler(request, response);
  });
  await listen(server, options.host, options.port);
  const address = server.address() as AddressInfo;
  const policy = new WebSecurityPolicy({ bindHost: options.host, port: address.port });
  router = createWebRouter({
    controller: options.controller,
    store: options.store,
    security: policy,
    assets,
    ...(options.onError ? { onError: options.onError } : {}),
  });
  const displayHost =
    options.host === "::" || options.host === "0.0.0.0" ? "127.0.0.1" : options.host;
  const formattedHost = displayHost.includes(":") ? `[${displayHost}]` : displayHost;
  const origin = `http://${formattedHost}:${address.port}`;
  const accessUrl = policy.accessToken ? `${origin}/?token=${policy.accessToken}` : `${origin}/`;
  let closed = false;
  return {
    origin,
    port: address.port,
    accessUrl,
    remote: policy.remote,
    ...(policy.accessToken ? { accessToken: policy.accessToken } : {}),
    controller: options.controller,
    async close() {
      if (closed) return;
      closed = true;
      router?.closeClients();
      await options.controller.shutdown();
      await closeServer(server);
    },
  };
}

function listen(server: Server, host: string, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const fail = (error: Error) => reject(error);
    server.once("error", fail);
    server.listen(port, host, () => {
      server.off("error", fail);
      resolve();
    });
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
    server.closeIdleConnections();
    server.closeAllConnections();
  });
}
