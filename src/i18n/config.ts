import { chmod, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { userConfigDir } from "../config/config.js";
import { DEFAULT_LANGUAGE, isLanguage, type Language } from "./language.js";

export interface StartupLanguage {
  language: Language;
  cliValue?: string;
  error?: string;
}

function cliLanguage(argv: readonly string[]): string | undefined {
  for (let index = 2; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === "--") break;
    if (arg === "--lang") return argv[index + 1];
    if (arg?.startsWith("--lang=")) return arg.slice("--lang=".length);
  }
  return undefined;
}

async function readUserRoot(configPath: string): Promise<Record<string, unknown>> {
  try {
    const value: unknown = JSON.parse(await readFile(configPath, "utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new Error("config root must be a JSON object");
    return value as Record<string, unknown>;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
}

export async function resolveStartupLanguage(
  argv: readonly string[] = process.argv,
  configPath = path.join(userConfigDir(), "config.json"),
): Promise<StartupLanguage> {
  const cliValue = cliLanguage(argv);
  let userValue: unknown;
  let configError: string | undefined;
  try {
    userValue = (await readUserRoot(configPath)).language;
    if (userValue !== undefined && !isLanguage(userValue))
      configError = `用户配置 ${configPath} 的 language 无效；仅支持 zh、en`;
  } catch (error) {
    configError = `无法读取用户配置 ${configPath}：${error instanceof Error ? error.message : String(error)}`;
  }
  if (isLanguage(cliValue)) return { language: cliValue, cliValue };
  const language = isLanguage(userValue) ? userValue : DEFAULT_LANGUAGE;
  if (cliValue !== undefined)
    return {
      language,
      cliValue,
      error: `Unsupported language “${cliValue}”; supported values are zh and en.`,
    };
  return { language, ...(configError ? { error: configError } : {}) };
}

export async function saveUserLanguage(
  language: Language,
  configPath = path.join(userConfigDir(), "config.json"),
): Promise<void> {
  if (!isLanguage(language)) throw new Error(`Unsupported language: ${String(language)}`);
  const root = await readUserRoot(configPath);
  const directory = path.dirname(configPath);
  await mkdir(directory, { recursive: true });
  const temporary = path.join(
    directory,
    `.${path.basename(configPath)}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`,
  );
  try {
    await writeFile(temporary, `${JSON.stringify({ ...root, language }, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx",
    });
    await chmod(temporary, 0o600);
    await rename(temporary, configPath);
  } finally {
    await unlink(temporary).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
    });
  }
}
