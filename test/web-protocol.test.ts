import { describe, expect, it } from "vitest";
import { parseWebActionBody, WEB_PROTOCOL_VERSION } from "../src/web/protocol.js";

describe("Web protocol", () => {
  it("accepts bounded action bodies", () => {
    expect(WEB_PROTOCOL_VERSION).toBe(1);
    expect(parseWebActionBody("turn", { text: "fix tests" })).toEqual({ text: "fix tests" });
    expect(parseWebActionBody("interaction", { decision: "allow_once" })).toEqual({
      decision: "allow_once",
    });
    expect(parseWebActionBody("resume", { sessionId: "session-1" })).toEqual({
      sessionId: "session-1",
    });
    expect(parseWebActionBody("empty", {})).toEqual({});
  });

  it("rejects malformed action bodies", () => {
    expect(() => parseWebActionBody("turn", { text: "   " })).toThrow("non-empty");
    expect(() => parseWebActionBody("turn", { text: "x".repeat(100_001) })).toThrow("100000");
    expect(() => parseWebActionBody("turn", { text: "ok", extra: true })).toThrow("unknown");
    expect(() => parseWebActionBody("interaction", { decision: "always" })).toThrow();
    expect(() => parseWebActionBody("resume", { sessionId: "../escape" })).toThrow();
    expect(() => parseWebActionBody("empty", { unexpected: true })).toThrow("unknown");
  });
});
