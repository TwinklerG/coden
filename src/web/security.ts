import { randomBytes, timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { isIP } from "node:net";
import { networkInterfaces } from "node:os";

export const ACCESS_COOKIE = "coden_access";
export const CLIENT_COOKIE = "coden_client";

export class WebSecurityError extends Error {
  constructor(
    readonly status: 400 | 401 | 403,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "WebSecurityError";
  }
}

export function isLoopbackHost(host: string): boolean {
  const normalized = normalizeHostname(host);
  if (normalized === "localhost" || normalized === "::1") return true;
  if (isIP(normalized) === 4) return normalized.split(".")[0] === "127";
  return false;
}

export function createAccessToken(): string {
  return randomBytes(32).toString("hex");
}

export function secureTokenEqual(expected: string, supplied: string): boolean {
  const left = Buffer.from(expected, "utf8");
  const right = Buffer.from(supplied, "utf8");
  return left.length === right.length && timingSafeEqual(left, right);
}

export interface WebSecurityPolicyOptions {
  bindHost: string;
  port: number;
  interfaceAddresses?: string[];
  accessToken?: string;
}

export class WebSecurityPolicy {
  readonly bindHost: string;
  readonly port: number;
  readonly remote: boolean;
  readonly accessToken: string | undefined;
  readonly #allowedHosts: Set<string>;

  constructor(options: WebSecurityPolicyOptions) {
    this.bindHost = normalizeHostname(options.bindHost);
    this.port = options.port;
    this.remote = !isLoopbackHost(this.bindHost);
    this.accessToken = this.remote ? (options.accessToken ?? createAccessToken()) : undefined;
    const addresses = options.interfaceAddresses ?? localInterfaceAddresses();
    this.#allowedHosts = new Set<string>();
    const add = (host: string) =>
      this.#allowedHosts.add(formatHost(normalizeHostname(host), this.port));
    if (this.bindHost === "0.0.0.0" || this.bindHost === "::") {
      add("127.0.0.1");
      add("localhost");
      add("::1");
      for (const address of addresses) add(address);
    } else {
      add(this.bindHost);
      if (isLoopbackHost(this.bindHost)) {
        add("127.0.0.1");
        add("localhost");
        add("::1");
      }
    }
  }

  ensureAllowedHost(request: IncomingMessage): void {
    const host = request.headers.host?.toLowerCase();
    if (!host || !this.#allowedHosts.has(host))
      throw new WebSecurityError(403, "web.host_denied", "Host is not allowed");
  }

  ensureAuthenticated(request: IncomingMessage): void {
    if (!this.remote) return;
    const supplied = parseCookies(request.headers.cookie)[ACCESS_COOKIE];
    if (!this.accessToken || !supplied || !secureTokenEqual(this.accessToken, supplied))
      throw new WebSecurityError(401, "web.authentication_required", "Authentication is required");
  }

  ensureMutationOrigin(request: IncomingMessage): void {
    this.ensureAllowedHost(request);
    const origin = request.headers.origin;
    const expected = `http://${request.headers.host}`;
    if (!origin || origin !== expected)
      throw new WebSecurityError(403, "web.origin_denied", "Origin is not allowed");
  }

  exchangeQueryToken(url: URL): { location: string; cookie: string } | undefined {
    if (!this.remote || !this.accessToken) return undefined;
    const supplied = url.searchParams.get("token");
    if (!supplied || !secureTokenEqual(this.accessToken, supplied)) return undefined;
    url.searchParams.delete("token");
    const search = url.searchParams.toString();
    return {
      location: `${url.pathname}${search ? `?${search}` : ""}${url.hash}` || "/",
      cookie: cookieHeader(ACCESS_COOKIE, this.accessToken),
    };
  }

  clientId(request: IncomingMessage): { clientId: string; cookie?: string } {
    const existing = parseCookies(request.headers.cookie)[CLIENT_COOKIE];
    if (existing && /^[a-f0-9]{64}$/.test(existing)) return { clientId: existing };
    const clientId = createAccessToken();
    return { clientId, cookie: cookieHeader(CLIENT_COOKIE, clientId) };
  }
}

export function securityHeaders(api = false): Record<string, string> {
  return {
    "Content-Security-Policy":
      "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    ...(api ? { "Cache-Control": "no-store" } : {}),
  };
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const result: Record<string, string> = {};
  if (!header) return result;
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 1) continue;
    const key = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (key) result[key] = value;
  }
  return result;
}

export function cookieHeader(name: string, value: string): string {
  return `${name}=${value}; HttpOnly; SameSite=Strict; Path=/`;
}

function normalizeHostname(host: string): string {
  const normalized = host.trim().toLowerCase();
  return normalized.startsWith("[") && normalized.endsWith("]")
    ? normalized.slice(1, -1)
    : normalized;
}

function formatHost(host: string, port: number): string {
  return `${isIP(host) === 6 ? `[${host}]` : host}:${port}`;
}

function localInterfaceAddresses(): string[] {
  const result: string[] = [];
  for (const entries of Object.values(networkInterfaces())) {
    for (const entry of entries ?? []) result.push(entry.address);
  }
  return result;
}
