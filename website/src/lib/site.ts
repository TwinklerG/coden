export const SITE_ORIGIN = "https://twinklerg.github.io";
export const BASE_PATH = "/CodeN";
export const SUPPORTED_LANGUAGES = ["zh", "en"] as const;

export type Language = (typeof SUPPORTED_LANGUAGES)[number];

export function isLanguage(value: unknown): value is Language {
  return typeof value === "string" && SUPPORTED_LANGUAGES.includes(value as Language);
}

export function withBase(pathname: string): string {
  if (pathname === "/" || pathname.length === 0) {
    return `${BASE_PATH}/`;
  }

  const normalized = pathname.startsWith("/") ? pathname : `/${pathname}`;
  if (normalized === BASE_PATH || normalized.startsWith(`${BASE_PATH}/`)) {
    return normalized;
  }

  return `${BASE_PATH}${normalized}`;
}
