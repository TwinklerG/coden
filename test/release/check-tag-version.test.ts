import { describe, it, expect } from "vitest";
import { versionMismatch } from "../../src/release/check-tag-version.js";

describe("versionMismatch", () => {
  it("returns null when tag matches version", () => {
    expect(versionMismatch("v0.1.8", "0.1.8")).toBeNull();
  });

  it("rejects non-semver tag", () => {
    expect(versionMismatch("v0.1", "0.1.8")).not.toBeNull();
    expect(versionMismatch("0.1.8", "0.1.8")).not.toBeNull();
  });

  it("rejects a tag that does not match the version", () => {
    expect(versionMismatch("v0.1.7", "0.1.8")).not.toBeNull();
  });
});
