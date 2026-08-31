import { describe, expect, it, vi } from "vitest";
import { loadPlugin, normalizeRepositoryUrl, registryUrls } from "../src/lib/npm-registry";

describe("npm registry adapter", () => {
  it("encodes package names for both npm endpoints", () => {
    expect(registryUrls("@scope/plugin")).toEqual({
      metadata: "https://registry.npmjs.org/%40scope%2Fplugin/latest",
      downloads: "https://api.npmjs.org/downloads/point/last-month/%40scope%2Fplugin",
    });
  });

  it("normalizes only secure repository links", () => {
    expect(normalizeRepositoryUrl({ url: "git+https://github.com/acme/plugin.git" })).toBe(
      "https://github.com/acme/plugin",
    );
    expect(normalizeRepositoryUrl("javascript:alert(1)")).toBeUndefined();
  });

  it("flags incompatible coden metadata without rejecting display data", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            name: "coden-msb",
            version: "0.1.0",
            description: "Sandbox plugin",
            coden: { apiVersion: 2 },
          }),
        ),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ downloads: 132 })));
    const result = await loadPlugin("coden-msb", fetcher);
    expect(result.compatible).toBe(false);
    expect(result.error).toBeUndefined();
    expect(result.downloads).toBe(132);
  });
});
