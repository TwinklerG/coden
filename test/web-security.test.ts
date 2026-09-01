import type { IncomingMessage } from "node:http";
import { describe, expect, it } from "vitest";
import {
  ACCESS_COOKIE,
  createAccessToken,
  isLoopbackHost,
  secureTokenEqual,
  securityHeaders,
  WebSecurityPolicy,
} from "../src/web/security.js";

function request(headers: Record<string, string>): IncomingMessage {
  return { headers } as unknown as IncomingMessage;
}

describe("Web security", () => {
  it("classifies loopback hosts strictly", () => {
    expect(isLoopbackHost("127.0.0.1")).toBe(true);
    expect(isLoopbackHost("127.99.2.3")).toBe(true);
    expect(isLoopbackHost("::1")).toBe(true);
    expect(isLoopbackHost("localhost")).toBe(true);
    expect(isLoopbackHost("0.0.0.0")).toBe(false);
    expect(isLoopbackHost("::")).toBe(false);
    expect(isLoopbackHost("192.168.1.10")).toBe(false);
  });

  it("creates and compares process access tokens", () => {
    const token = createAccessToken();
    expect(token).toMatch(/^[a-f0-9]{64}$/);
    expect(secureTokenEqual(token, token)).toBe(true);
    expect(secureTokenEqual(token, `${token}0`)).toBe(false);
    expect(secureTokenEqual(token, "x".repeat(64))).toBe(false);
  });

  it("requires exact Host and Origin for mutations", () => {
    const policy = new WebSecurityPolicy({ bindHost: "127.0.0.1", port: 4567 });
    const valid = request({ host: "127.0.0.1:4567", origin: "http://127.0.0.1:4567" });
    expect(() => policy.ensureAllowedHost(valid)).not.toThrow();
    expect(() => policy.ensureMutationOrigin(valid)).not.toThrow();
    expect(() =>
      policy.ensureMutationOrigin(
        request({ host: "127.0.0.1:4567", origin: "https://attacker.example" }),
      ),
    ).toThrow("Origin");
    expect(() => policy.ensureAllowedHost(request({ host: "attacker.example:4567" }))).toThrow(
      "Host",
    );
  });

  it("exchanges a remote query token for an HttpOnly cookie", () => {
    const policy = new WebSecurityPolicy({
      bindHost: "0.0.0.0",
      port: 4567,
      interfaceAddresses: ["192.168.1.5"],
      accessToken: "a".repeat(64),
    });
    expect(() => policy.ensureAuthenticated(request({ host: "192.168.1.5:4567" }))).toThrow(
      "Authentication",
    );
    const exchanged = policy.exchangeQueryToken(
      new URL(`http://192.168.1.5:4567/?token=${"a".repeat(64)}`),
    );
    expect(exchanged).toMatchObject({ location: "/" });
    expect(exchanged?.cookie).toContain(`${ACCESS_COOKIE}=`);
    expect(exchanged?.cookie).toContain("HttpOnly; SameSite=Strict; Path=/");
    expect(() =>
      policy.ensureAuthenticated(
        request({
          host: "192.168.1.5:4567",
          cookie: `${ACCESS_COOKIE}=${"a".repeat(64)}`,
        }),
      ),
    ).not.toThrow();
  });

  it("returns restrictive browser headers without CORS", () => {
    const headers = securityHeaders(true);
    expect(headers["Content-Security-Policy"]).toContain("default-src 'self'");
    expect(headers).toMatchObject({
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
      "Cache-Control": "no-store",
    });
    expect(Object.keys(headers).some((name) => name.toLowerCase().includes("cors"))).toBe(false);
    expect(headers["Access-Control-Allow-Origin"]).toBeUndefined();
  });
});
