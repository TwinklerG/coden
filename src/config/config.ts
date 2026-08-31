import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { isThinkingLevel, type ThinkingLevel } from "../core/thinking.js";
import { DEFAULT_LANGUAGE, isLanguage, type Language } from "../i18n/language.js";

export type ProviderName = "openai" | "anthropic";
export type ApprovalStrictness = "soft" | "medium" | "hard";
export interface CodeNConfig {
  provider: ProviderName;
  model: string;
  approvalModel?: string;
  approvalStrictness: ApprovalStrictness;
  maxSteps: number;
  contextWindow: number;
  reservedOutputTokens: number;
  safetyMargin: number;
  plugins: string[];
  dataDir: string;
  env: Record<string, string>;
  language: Language;
  thinkingLevel: ThinkingLevel;
}
export type ConfigOverrides = Partial<Omit<CodeNConfig, "plugins" | "dataDir" | "env">> & {
  plugins?: string[];
  env?: Record<string, string>;
};

export function userConfigDir(): string {
  return process.env.XDG_CONFIG_HOME
    ? path.join(process.env.XDG_CONFIG_HOME, "coden")
    : path.join(os.homedir(), ".config", "coden");
}
export function userDataDir(): string {
  return process.env.XDG_DATA_HOME
    ? path.join(process.env.XDG_DATA_HOME, "coden")
    : path.join(os.homedir(), ".local", "share", "coden");
}
async function readJson(file: string, includeLanguage = false): Promise<ConfigOverrides> {
  try {
    const value: unknown = JSON.parse(await readFile(file, "utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new Error("config root must be a JSON object");
    return pickOverrides(value as Record<string, unknown>, includeLanguage);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw new Error(
      `Cannot read config ${file}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function pickOverrides(raw: Record<string, unknown>, includeLanguage = false): ConfigOverrides {
  const overrides: ConfigOverrides = {};
  if (includeLanguage && raw.language !== undefined) {
    if (!isLanguage(raw.language)) throw new Error("language must be zh or en");
    overrides.language = raw.language;
  }
  if (raw.provider === "openai" || raw.provider === "anthropic") overrides.provider = raw.provider;
  if (typeof raw.model === "string") overrides.model = raw.model;
  if (raw.approvalModel !== undefined) {
    if (typeof raw.approvalModel !== "string" || !raw.approvalModel.trim())
      throw new Error("approvalModel must be a non-empty string");
    overrides.approvalModel = raw.approvalModel;
  }
  if (raw.approvalStrictness !== undefined) {
    if (!["soft", "medium", "hard"].includes(String(raw.approvalStrictness)))
      throw new Error("approvalStrictness must be soft, medium, or hard");
    overrides.approvalStrictness = raw.approvalStrictness as ApprovalStrictness;
  }
  if (typeof raw.maxSteps === "number") overrides.maxSteps = raw.maxSteps;
  if (typeof raw.contextWindow === "number") overrides.contextWindow = raw.contextWindow;
  if (typeof raw.reservedOutputTokens === "number")
    overrides.reservedOutputTokens = raw.reservedOutputTokens;
  if (typeof raw.safetyMargin === "number") overrides.safetyMargin = raw.safetyMargin;
  if (raw.thinkingLevel !== undefined) {
    if (!isThinkingLevel(raw.thinkingLevel))
      throw new Error("thinkingLevel must be default, off, minimal, low, medium, or high");
    overrides.thinkingLevel = raw.thinkingLevel;
  }
  if (Array.isArray(raw.plugins))
    overrides.plugins = raw.plugins.filter((item): item is string => typeof item === "string");
  if (raw.env !== undefined) {
    if (typeof raw.env !== "object" || raw.env === null || Array.isArray(raw.env))
      throw new Error("env must be an object");
    const env: Record<string, string> = {};
    for (const [entryKey, entryValue] of Object.entries(raw.env)) {
      if (typeof entryValue !== "string") throw new Error(`env "${entryKey}" must be a string`);
      env[entryKey] = entryValue;
    }
    overrides.env = env;
  }
  return overrides;
}

function stripEnv(overrides: ConfigOverrides): ConfigOverrides {
  const { env: _env, ...rest } = overrides;
  return rest;
}

export async function loadConfig(
  workspace: string,
  cli: ConfigOverrides = {},
): Promise<CodeNConfig> {
  const defaults: CodeNConfig = {
    provider: "openai",
    model: "gpt-5-mini",
    approvalStrictness: "medium",
    maxSteps: 20,
    contextWindow: 128000,
    reservedOutputTokens: 8192,
    safetyMargin: 4096,
    plugins: [],
    dataDir: userDataDir(),
    env: {},
    language: DEFAULT_LANGUAGE,
    thinkingLevel: "default",
  };
  const user = await readJson(
    path.join(userConfigDir(), "config.json"),
    cli.language === undefined,
  );
  const project = await readJson(path.join(workspace, ".coden", "config.json"));
  const env: ConfigOverrides = {};
  if (process.env.CODEN_PROVIDER === "openai" || process.env.CODEN_PROVIDER === "anthropic")
    env.provider = process.env.CODEN_PROVIDER;
  if (process.env.CODEN_MODEL) env.model = process.env.CODEN_MODEL;
  if (process.env.CODEN_MAX_STEPS) env.maxSteps = Number(process.env.CODEN_MAX_STEPS);
  if (process.env.CODEN_THINKING_LEVEL) {
    if (!isThinkingLevel(process.env.CODEN_THINKING_LEVEL))
      throw new Error("CODEN_THINKING_LEVEL must be default, off, minimal, low, medium, or high");
    env.thinkingLevel = process.env.CODEN_THINKING_LEVEL;
  }
  const mergedEnv = { ...(user.env ?? {}), ...(project.env ?? {}) };
  for (const [k, v] of Object.entries(mergedEnv)) {
    if (process.env[k] === undefined) process.env[k] = v;
  }
  const merged = {
    ...defaults,
    ...stripEnv(user),
    ...stripEnv(project),
    ...env,
    ...cli,
    env: mergedEnv,
  };
  merged.plugins = [...(user.plugins ?? []), ...(project.plugins ?? []), ...(cli.plugins ?? [])];
  if (merged.provider !== "openai" && merged.provider !== "anthropic")
    throw new Error("provider must be openai or anthropic");
  if (typeof merged.model !== "string" || !merged.model.trim())
    throw new Error("model must be a non-empty string");
  if (!Number.isInteger(merged.maxSteps) || merged.maxSteps < 1)
    throw new Error("maxSteps must be a positive integer");
  for (const key of ["contextWindow", "reservedOutputTokens", "safetyMargin"] as const) {
    if (!Number.isInteger(merged[key]) || merged[key] < 0)
      throw new Error(`${key} must be a non-negative integer`);
  }
  if (merged.contextWindow === 0 || merged.reservedOutputTokens === 0)
    throw new Error("contextWindow and reservedOutputTokens must be positive");
  if (merged.contextWindow <= merged.reservedOutputTokens + merged.safetyMargin)
    throw new Error("contextWindow must exceed reservedOutputTokens plus safetyMargin");
  if (!Array.isArray(merged.plugins) || merged.plugins.some((item) => typeof item !== "string"))
    throw new Error("plugins must be an array of paths");
  if (!isThinkingLevel(merged.thinkingLevel))
    throw new Error("thinkingLevel must be default, off, minimal, low, medium, or high");
  return merged;
}
