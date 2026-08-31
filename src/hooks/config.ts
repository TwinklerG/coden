import {
  type ConfiguredCommandHook,
  HOOK_EVENT_NAMES,
  type HookEventName,
  type HookScope,
} from "./types.js";

export type ParsedCommandHook = Omit<ConfiguredCommandHook, "order">;
const EVENTS = new Set<string>(HOOK_EVENT_NAMES);
const MATCHABLE = new Set<HookEventName>([
  "SessionStart",
  "PreToolUse",
  "PermissionRequest",
  "PostToolUse",
  "PostToolUseFailure",
  "Notification",
]);
function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`${label} must be an object`);
  return value as Record<string, unknown>;
}
function fields(value: Record<string, unknown>, allowed: string[], label: string): void {
  const unknown = Object.keys(value).find((key) => !allowed.includes(key));
  if (unknown) throw new Error(`${label} has unknown field "${unknown}"`);
}
export function parseHookConfig(raw: unknown, scope: HookScope): ParsedCommandHook[] {
  const root = object(raw, "hooks");
  const parsed: ParsedCommandHook[] = [];
  for (const [eventName, groupsValue] of Object.entries(root)) {
    if (!EVENTS.has(eventName)) throw new Error(`unsupported hook event "${eventName}"`);
    const event = eventName as HookEventName;
    if (!Array.isArray(groupsValue)) throw new Error(`${event} hooks must be an array`);
    for (const groupValue of groupsValue) {
      const group = object(groupValue, `${event} hook group`);
      fields(group, ["matcher", "hooks"], `${event} hook group`);
      const matcherSource = group.matcher === undefined ? "*" : group.matcher;
      if (typeof matcherSource !== "string" || !matcherSource)
        throw new Error(`${event} matcher must be a string`);
      if (!MATCHABLE.has(event) && matcherSource !== "*")
        throw new Error(`${event} does not accept a matcher`);
      let matcher: RegExp | undefined;
      if (matcherSource !== "*") {
        try {
          matcher = new RegExp(matcherSource);
        } catch (error) {
          throw new Error(
            `${event} has invalid matcher: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
      if (!Array.isArray(group.hooks))
        throw new Error(`${event} hook group hooks must be an array`);
      for (const itemValue of group.hooks) {
        const item = object(itemValue, `${event} command hook`);
        fields(item, ["type", "command", "timeout"], `${event} command hook`);
        if (item.type !== "command") throw new Error(`${event} hook type must be command`);
        if (typeof item.command !== "string" || !item.command.trim())
          throw new Error(`${event} hook command must be non-empty`);
        const timeout = item.timeout === undefined ? 10 : item.timeout;
        if (!Number.isInteger(timeout) || (timeout as number) < 1 || (timeout as number) > 600)
          throw new Error(`${event} hook timeout must be an integer from 1 to 600`);
        parsed.push({
          event,
          scope,
          matcherSource,
          ...(matcher ? { matcher } : {}),
          command: item.command,
          timeoutMs: (timeout as number) * 1000,
        });
      }
    }
  }
  return parsed;
}
export function mergeConfiguredHooks(
  user: ParsedCommandHook[],
  project: ParsedCommandHook[],
): ConfiguredCommandHook[] {
  const hooks = [...user, ...project].map((hook, order) => ({ ...hook, order }));
  for (const event of HOOK_EVENT_NAMES)
    if (hooks.filter((hook) => hook.event === event).length > 64)
      throw new Error(`${event} config exceeds 64 commands`);
  return hooks;
}
