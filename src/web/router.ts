import { createReadStream } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { type WebController, WebControllerError } from "./controller.js";
import { parseWebActionBody, WEB_PROTOCOL_VERSION, type WebApiError } from "./protocol.js";
import { securityHeaders, WebSecurityError, type WebSecurityPolicy } from "./security.js";
import { resolveStaticAsset, type WebStaticAssets } from "./static-assets.js";
import type { WebStore } from "./store.js";

const MAX_JSON_BYTES = 1_048_576;
const MAX_SSE_QUEUE_BYTES = 1_048_576;

export interface WebRouterOptions {
  controller: WebController;
  store: WebStore;
  security: WebSecurityPolicy;
  assets: WebStaticAssets;
  onError?: (error: unknown) => void;
}

export interface WebRouter {
  handler(request: IncomingMessage, response: ServerResponse): Promise<void>;
  closeClients(): void;
}

export function createWebRouter(options: WebRouterOptions): WebRouter {
  const clients = new Set<ServerResponse>();
  const closeClients = () => {
    for (const response of clients) response.destroy();
    clients.clear();
  };

  const handler = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    try {
      applyHeaders(response, securityHeaders(request.url?.startsWith("/api/") ?? false));
      options.security.ensureAllowedHost(request);
      const url = new URL(request.url ?? "/", `http://${request.headers.host}`);
      if (request.method === "GET") {
        const exchange = options.security.exchangeQueryToken(url);
        if (exchange) {
          response.writeHead(303, { Location: exchange.location, "Set-Cookie": exchange.cookie });
          response.end();
          return;
        }
      }
      options.security.ensureAuthenticated(request);
      if (request.method === "GET" || request.method === "HEAD") {
        if (url.pathname === "/api/health") {
          json(response, 200, { ok: true, protocolVersion: WEB_PROTOCOL_VERSION });
          return;
        }
        if (url.pathname === "/api/state") {
          const identity = options.security.clientId(request);
          setCookie(response, identity.cookie);
          json(response, 200, stateResponse(options, identity.clientId));
          return;
        }
        if (url.pathname === "/api/sessions") {
          json(response, 200, { sessions: options.store.snapshot().sessions });
          return;
        }
        if (url.pathname === "/api/events") {
          const identity = options.security.clientId(request);
          setCookie(response, identity.cookie);
          const viewer = options.controller.connectClient(identity.clientId);
          response.writeHead(200, {
            "Content-Type": "text/event-stream; charset=utf-8",
            "Cache-Control": "no-store",
            Connection: "keep-alive",
            "X-Accel-Buffering": "no",
          });
          clients.add(response);
          writeSse(response, options.store.snapshot().revision, {
            type: "snapshot",
            revision: options.store.snapshot().revision,
            data: {
              protocolVersion: WEB_PROTOCOL_VERSION,
              snapshot: options.store.snapshot(),
              viewer,
            },
          });
          let queuedBytes = 0;
          const unsubscribe = options.store.subscribe((revision, patch) => {
            const payload = ssePayload(revision, { type: "patch", revision, data: patch });
            queuedBytes += Buffer.byteLength(payload);
            if (queuedBytes > MAX_SSE_QUEUE_BYTES) {
              response.destroy();
              return;
            }
            if (response.write(payload)) queuedBytes = 0;
          });
          response.on("drain", () => {
            queuedBytes = 0;
          });
          const heartbeat = setInterval(() => response.write(": heartbeat\n\n"), 15_000);
          const cleanup = () => {
            clearInterval(heartbeat);
            unsubscribe();
            clients.delete(response);
            options.controller.disconnectClient(identity.clientId);
          };
          request.once("close", cleanup);
          response.once("close", cleanup);
          return;
        }
        const asset = resolveStaticAsset(options.assets, url.pathname);
        if (!asset) {
          apiError(response, 404, "web.not_found", "Resource not found", false);
          return;
        }
        response.writeHead(200, {
          "Content-Type": asset.contentType,
          "Cache-Control": asset.cacheControl,
        });
        if (request.method === "HEAD") response.end();
        else
          createReadStream(asset.filePath)
            .on("error", (error) => response.destroy(error))
            .pipe(response);
        return;
      }
      if (request.method !== "POST") {
        apiError(response, 405, "web.method_not_allowed", "Method not allowed", false);
        return;
      }
      options.security.ensureMutationOrigin(request);
      const identity = options.security.clientId(request);
      setCookie(response, identity.cookie);
      const body = await readJsonBody(request);
      if (url.pathname === "/api/control/takeover") {
        parseWebActionBody("empty", body);
        options.controller.takeover(identity.clientId);
        response.writeHead(204).end();
        return;
      }
      if (url.pathname === "/api/turn") {
        const parsed = parseWebActionBody("turn", body) as { text: string };
        options.controller.submit(identity.clientId, parsed.text);
        response.writeHead(202).end();
        return;
      }
      if (url.pathname === "/api/cancel") {
        parseWebActionBody("empty", body);
        options.controller.cancel(identity.clientId);
        response.writeHead(202).end();
        return;
      }
      const interaction = url.pathname.match(/^\/api\/interactions\/([^/]+)$/);
      if (interaction) {
        const parsed = parseWebActionBody("interaction", body) as {
          decision: Parameters<WebController["answerInteraction"]>[2];
        };
        options.controller.answerInteraction(
          identity.clientId,
          decodeURIComponent(interaction[1] ?? ""),
          parsed.decision,
        );
        response.writeHead(204).end();
        return;
      }
      if (url.pathname === "/api/sessions/new") {
        parseWebActionBody("empty", body);
        await options.controller.newSession(identity.clientId);
        response.writeHead(204).end();
        return;
      }
      if (url.pathname === "/api/sessions/resume") {
        const parsed = parseWebActionBody("resume", body) as { sessionId: string };
        await options.controller.resumeSession(identity.clientId, parsed.sessionId);
        response.writeHead(204).end();
        return;
      }
      apiError(response, 404, "web.not_found", "Resource not found", false);
    } catch (error) {
      options.onError?.(error);
      if (response.headersSent) {
        response.destroy();
        return;
      }
      if (error instanceof BodyError) {
        apiError(response, error.status, error.code, error.message, false);
        return;
      }
      if (error instanceof WebSecurityError || error instanceof WebControllerError) {
        apiError(response, error.status, error.code, error.message, false);
        return;
      }
      if (error instanceof SyntaxError || error instanceof URIError || error instanceof Error) {
        const known =
          error instanceof SyntaxError ||
          error.message.includes("field") ||
          error.message.includes("must be") ||
          error.message.includes("invalid");
        apiError(
          response,
          known ? 400 : 500,
          known ? "web.invalid_request" : "web.internal_error",
          known ? error.message : "Internal server error",
          false,
        );
        return;
      }
      apiError(response, 500, "web.internal_error", "Internal server error", false);
    }
  };
  return { handler, closeClients };
}

class BodyError extends Error {
  constructor(
    readonly status: 400 | 413 | 415,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const contentType = request.headers["content-type"]?.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType !== "application/json")
    throw new BodyError(415, "web.content_type", "Content-Type must be application/json");
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > MAX_JSON_BYTES)
      throw new BodyError(413, "web.body_too_large", "Request body exceeds 1 MiB");
    chunks.push(buffer);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  return JSON.parse(text || "{}");
}

function stateResponse(options: WebRouterOptions, clientId: string) {
  return {
    protocolVersion: WEB_PROTOCOL_VERSION,
    snapshot: options.store.snapshot(),
    viewer: {
      clientId,
      isOwner: options.store.snapshot().control.ownerClientId === clientId,
    },
  };
}

function applyHeaders(response: ServerResponse, headers: Record<string, string>): void {
  for (const [name, value] of Object.entries(headers)) response.setHeader(name, value);
}

function setCookie(response: ServerResponse, cookie: string | undefined): void {
  if (cookie) response.setHeader("Set-Cookie", cookie);
}

function json(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(value));
}

function apiError(
  response: ServerResponse,
  status: number,
  code: string,
  message: string,
  retryable: boolean,
): void {
  const body: WebApiError = { error: { code, message, retryable } };
  json(response, status, body);
}

function ssePayload(revision: number, value: unknown): string {
  return `id: ${revision}\nevent: state\ndata: ${JSON.stringify(value)}\n\n`;
}

function writeSse(response: ServerResponse, revision: number, value: unknown): void {
  response.write(ssePayload(revision, value));
}
