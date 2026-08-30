import type { zh } from "./locales/zh.js";

export {
  DEFAULT_LANGUAGE,
  isLanguage,
  type Language,
  SUPPORTED_LANGUAGES,
} from "./language.js";

type Widen<T> = T extends (...args: infer A) => infer R
  ? (...args: A) => R
  : T extends string
    ? string
    : T extends object
      ? { [K in keyof T]: Widen<T[K]> }
      : T;
export type Messages = Widen<typeof zh>;

export { resolveStartupLanguage, saveUserLanguage } from "./config.js";
export { I18n } from "./i18n.js";
