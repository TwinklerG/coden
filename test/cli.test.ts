import { spawnSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";

const cli = path.join(process.cwd(), "src", "cli", "index.ts");
const baseEnv = {
  ...process.env,
  OPENAI_API_KEY: "",
  ANTHROPIC_API_KEY: "",
  CODEN_PROVIDER: "",
  CODEN_MODEL: "",
  CODEN_MAX_STEPS: "",
};

describe("CLI exit codes", () => {
  it("exits 2 for configuration errors (missing API key)", () => {
    const result = spawnSync("bun", [cli, "-p", "--provider", "openai", "task"], {
      encoding: "utf8",
      env: baseEnv,
      timeout: 30_000,
    });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("OPENAI_API_KEY");
  });

  it("exits 1 for execution/session failures", () => {
    const result = spawnSync("bun", [cli, "-p", "--resume", "missing-session", "task"], {
      encoding: "utf8",
      env: { ...baseEnv, OPENAI_API_KEY: "test-key" },
      timeout: 30_000,
    });
    expect(result.status).toBe(1);
  });
});
