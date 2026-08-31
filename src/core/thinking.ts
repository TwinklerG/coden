export const THINKING_LEVELS = ["default", "off", "minimal", "low", "medium", "high"] as const;

export type ThinkingLevel = (typeof THINKING_LEVELS)[number];

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

export interface ProviderMessageState {
  provider: string;
  data: JsonValue;
}

export function isThinkingLevel(value: unknown): value is ThinkingLevel {
  return typeof value === "string" && THINKING_LEVELS.includes(value as ThinkingLevel);
}

export function isProviderMessageState(value: unknown): value is ProviderMessageState {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const state = value as Record<string, unknown>;
  return typeof state.provider === "string" && state.provider.length > 0 && isJsonValue(state.data);
}

export function isJsonValue(value: unknown): value is JsonValue {
  if (value === null) return true;
  if (typeof value === "boolean" || typeof value === "string") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every((item) => isJsonValue(item));
  if (typeof value === "object") {
    const object = value as Record<string, unknown>;
    if (
      Object.getPrototypeOf(object) !== Object.prototype &&
      Object.getPrototypeOf(object) !== null
    )
      return false;
    return Object.values(object).every((item) => isJsonValue(item));
  }
  return false;
}
