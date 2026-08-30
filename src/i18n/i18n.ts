import type { Messages } from "./index.js";
import { DEFAULT_LANGUAGE, isLanguage, type Language, SUPPORTED_LANGUAGES } from "./language.js";
import { en } from "./locales/en.js";
import { zh } from "./locales/zh.js";

const CATALOGS: Record<Language, Messages> = { zh, en };

export class I18n {
  private language: Language;

  constructor(language: Language = DEFAULT_LANGUAGE) {
    if (!isLanguage(language)) throw new Error(`Unsupported language: ${String(language)}`);
    this.language = language;
  }

  get currentLanguage(): Language {
    return this.language;
  }

  get messages(): Messages {
    return CATALOGS[this.language];
  }

  get supportedLanguages(): readonly Language[] {
    return SUPPORTED_LANGUAGES;
  }

  setLanguage(language: Language): void {
    if (!isLanguage(language)) throw new Error(`Unsupported language: ${String(language)}`);
    this.language = language;
  }

  displayName(language: Language): string {
    return this.messages.language.names[language];
  }
}
