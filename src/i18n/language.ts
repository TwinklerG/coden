export const SUPPORTED_LANGUAGES = ["zh", "en"] as const;
export type Language = (typeof SUPPORTED_LANGUAGES)[number];
export const DEFAULT_LANGUAGE: Language = "zh";

export function isLanguage(value: unknown): value is Language {
  return value === "zh" || value === "en";
}
