import { describe, expect, it, vi } from "vitest";
import { CodeNWebApi } from "../src/api.js";

describe("CodeNWebApi", () => {
  it("sends same-origin JSON actions", async () => {
    const fetcher = vi.fn(async () => new Response(null, { status: 202 }));
    const api = new CodeNWebApi(fetcher as typeof fetch);
    await api.submit("fix tests");
    expect(fetcher).toHaveBeenCalledWith("/api/turn", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "fix tests" }),
    });
  });

  it("surfaces stable server errors", async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            error: { code: "web.busy", message: "busy", retryable: false },
          }),
          { status: 409, headers: { "Content-Type": "application/json" } },
        ),
    );
    const api = new CodeNWebApi(fetcher as typeof fetch);
    await expect(api.cancel()).rejects.toEqual(
      expect.objectContaining({
        code: "web.busy",
        message: "busy",
        status: 409,
      }),
    );
  });
});
