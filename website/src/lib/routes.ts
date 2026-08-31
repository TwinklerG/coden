import { BASE_PATH, type Language, SUPPORTED_LANGUAGES, withBase } from "./site";

export type ProductSection = "home" | "docs" | "plugins";

function normalizeSlug(slug: string): string {
  return slug
    .split("/")
    .map((part) => part.trim())
    .filter(Boolean)
    .join("/");
}

export function routeFor(language: Language, section: ProductSection, slug = ""): string {
  const normalizedSlug = normalizeSlug(slug);

  if (section === "home") {
    return withBase(`/${language}/`);
  }

  const prefix = `/${language}/${section}/`;
  return normalizedSlug.length > 0 ? withBase(`${prefix}${normalizedSlug}/`) : withBase(prefix);
}

export function alternateLanguagePath(pathname: string, target: Language): string {
  const normalized = pathname.endsWith("/") ? pathname : `${pathname}/`;
  if (!normalized.startsWith(`${BASE_PATH}/`)) {
    return routeFor(target, "home");
  }

  const segments = normalized
    .slice(BASE_PATH.length + 1)
    .split("/")
    .filter(Boolean);
  if (segments.length === 0 || !SUPPORTED_LANGUAGES.includes(segments[0] as Language)) {
    return routeFor(target, "home");
  }

  segments[0] = target;
  return withBase(`/${segments.join("/")}/`);
}

export function preferredLanguage(languages: readonly string[]): Language {
  const zhIndex = languages.findIndex((language) => language.toLowerCase().startsWith("zh"));
  const enIndex = languages.findIndex((language) => language.toLowerCase().startsWith("en"));

  if (zhIndex !== -1 && (enIndex === -1 || zhIndex < enIndex)) {
    return "zh";
  }

  return "en";
}
