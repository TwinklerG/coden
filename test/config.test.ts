import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadConfig } from "../src/config/config.js";

afterEach(() => vi.unstubAllEnvs());

async function makeTmpConfigs(
  userEnv: Record<string, unknown>,
  projectEnv: Record<string, unknown>,
): Promise<{ workspace: string }> {
  const root = await mkdtemp(path.join(os.tmpdir(), "coden-config-"));
  const workspace = path.join(root, "workspace");
  const configHome = path.join(root, "config");
  await mkdir(path.join(workspace, ".coden"), { recursive: true });
  await mkdir(path.join(configHome, "coden"), { recursive: true });
  await writeFile(path.join(configHome, "coden", "config.json"), JSON.stringify({ env: userEnv }));
  await writeFile(
    path.join(workspace, ".coden", "config.json"),
    JSON.stringify({ env: projectEnv }),
  );
  vi.stubEnv("XDG_CONFIG_HOME", configHome);
  vi.stubEnv("XDG_DATA_HOME", path.join(root, "data"));
  return { workspace };
}

describe("configuration", () => {
  it("merges defaults, user, project, environment, and CLI in order", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "coden-config-"));
    const workspace = path.join(root, "workspace");
    const configHome = path.join(root, "config");
    await mkdir(path.join(workspace, ".coden"), { recursive: true });
    await mkdir(path.join(configHome, "coden"), { recursive: true });
    await writeFile(
      path.join(configHome, "coden", "config.json"),
      JSON.stringify({ model: "user-model", maxSteps: 4, plugins: ["user.ts"] }),
    );
    await writeFile(
      path.join(workspace, ".coden", "config.json"),
      JSON.stringify({
        model: "project-model",
        plugins: ["project.ts"],
        dataDir: path.join(workspace, "leak"),
      }),
    );
    vi.stubEnv("XDG_CONFIG_HOME", configHome);
    vi.stubEnv("XDG_DATA_HOME", path.join(root, "data"));
    vi.stubEnv("CODEN_MODEL", "env-model");
    const config = await loadConfig(workspace, { model: "cli-model", plugins: ["cli.ts"] });
    expect(config.model).toBe("cli-model");
    expect(config.maxSteps).toBe(4);
    expect(config.plugins).toEqual(["user.ts", "project.ts", "cli.ts"]);
    expect(config.dataDir).toBe(path.join(root, "data", "coden"));
  });

  it("merges project env over user env", async () => {
    const { workspace } = await makeTmpConfigs(
      { CODEN_TEST_USER: "u", CODEN_TEST_PROJECT: "user-key" },
      { CODEN_TEST_PROJECT: "project-key", CODEN_TEST_NEW: "n" },
    );
    const config = await loadConfig(workspace);
    expect(config.env).toEqual({
      CODEN_TEST_USER: "u",
      CODEN_TEST_PROJECT: "project-key",
      CODEN_TEST_NEW: "n",
    });
  });

  it("does not override an existing process.env key", async () => {
    const key = "CODEN_TEST_EXISTING";
    vi.stubEnv(key, "shell-value");
    const { workspace } = await makeTmpConfigs({ [key]: "config-value" }, {});
    const config = await loadConfig(workspace);
    expect(process.env[key]).toBe("shell-value");
    expect(config.env[key]).toBe("config-value");
  });

  it("injects a config env key missing from process.env", async () => {
    const key = "CODEN_TEST_INJECT";
    delete process.env[key];
    const { workspace } = await makeTmpConfigs({ [key]: "injected" }, {});
    await loadConfig(workspace);
    expect(process.env[key]).toBe("injected");
    delete process.env[key];
  });

  it("rejects a non-string env value", async () => {
    const { workspace } = await makeTmpConfigs({ CODEN_TEST_BOOL: true }, {});
    await expect(loadConfig(workspace)).rejects.toThrow("must be a string");
  });

  it("rejects impossible context budgets", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "coden-config-"));
    vi.stubEnv("XDG_CONFIG_HOME", path.join(workspace, "missing"));
    await expect(
      loadConfig(workspace, {
        contextWindow: 100,
        reservedOutputTokens: 80,
        safetyMargin: 20,
      }),
    ).rejects.toThrow("contextWindow must exceed");
  });
});
