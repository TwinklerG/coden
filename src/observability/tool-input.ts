import type { JsonSchema, ToolRisk } from "../core/types.js";
import { sanitizeTerminalText, truncateDisplay } from "./terminal-text.js";

export interface ToolDisplayRequest {
  name: string;
  risk: ToolRisk;
  inputSchema: JsonSchema;
  input: unknown;
}

export interface ToolDisplayLimits {
  maxLines: number;
  maxValueChars: number;
  maxDepth: number;
  maxSummaryColumns: number;
}

export interface ToolInputDisplay {
  lines: string[];
  summary: string;
}

const DEFAULT_LIMITS: ToolDisplayLimits = {
  maxLines: 20,
  maxValueChars: 2_000,
  maxDepth: 4,
  maxSummaryColumns: 120,
};

type SchemaRecord = Record<string, unknown>;

function record(value: unknown): SchemaRecord | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as SchemaRecord)
    : undefined;
}

function orderedKeys(value: Record<string, unknown>, schema: SchemaRecord | undefined): string[] {
  const properties = record(schema?.properties);
  const preferred = properties ? Object.keys(properties).filter((key) => key in value) : [];
  return [...preferred, ...Object.keys(value).filter((key) => !preferred.includes(key))];
}

function childSchema(schema: SchemaRecord | undefined, key: string): SchemaRecord | undefined {
  return record(record(schema?.properties)?.[key]);
}

function boundedString(value: string, maxCharacters: number): string {
  const sanitized = sanitizeTerminalText(value);
  const characters = Array.from(sanitized);
  if (characters.length <= maxCharacters) return sanitized;
  const omitted = characters.length - maxCharacters;
  return `${characters.slice(0, maxCharacters).join("")}… [${omitted} characters omitted]`;
}

function scalar(value: unknown, limits: ToolDisplayLimits): string | undefined {
  if (typeof value === "string") return boundedString(value, limits.maxValueChars);
  if (value === null) return "null";
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint")
    return String(value);
  if (value === undefined) return "undefined";
  return undefined;
}

export function formatToolInput(
  request: ToolDisplayRequest,
  limits: Partial<ToolDisplayLimits> = {},
): ToolInputDisplay {
  const resolved: ToolDisplayLimits = { ...DEFAULT_LIMITS, ...limits };
  const safeName = sanitizeTerminalText(request.name);
  try {
    const generated: string[] = [];
    const seen = new WeakSet<object>();
    const lineLimit = Math.max(0, resolved.maxLines);
    const add = (line: string): void => {
      if (generated.length <= lineLimit) generated.push(line);
    };

    const render = (
      value: unknown,
      schema: SchemaRecord | undefined,
      depth: number,
      indent: string,
      label?: string,
    ): void => {
      if (generated.length > lineLimit) return;
      const safeLabel = label === undefined ? undefined : sanitizeTerminalText(label);
      const simple = scalar(value, resolved);
      if (simple !== undefined) {
        const physical = simple.split("\n");
        if (safeLabel !== undefined && physical.length === 1)
          add(`${indent}${safeLabel}: ${simple}`);
        else if (safeLabel !== undefined) {
          add(`${indent}${safeLabel}:`);
          for (const line of physical) add(`${indent}  ${line}`);
        } else for (const line of physical) add(`${indent}${line}`);
        return;
      }

      if (depth >= resolved.maxDepth) {
        add(`${indent}${safeLabel === undefined ? "" : `${safeLabel}: `}[max depth]`);
        return;
      }
      if (typeof value !== "object" || value === null) {
        add(
          `${indent}${safeLabel === undefined ? "" : `${safeLabel}: `}${sanitizeTerminalText(String(value))}`,
        );
        return;
      }
      if (seen.has(value)) {
        add(`${indent}${safeLabel === undefined ? "" : `${safeLabel}: `}[circular]`);
        return;
      }
      seen.add(value);

      if (Array.isArray(value)) {
        if (value.length === 0) {
          add(`${indent}${safeLabel === undefined ? "" : `${safeLabel}: `}[]`);
          return;
        }
        if (safeLabel !== undefined) add(`${indent}${safeLabel}:`);
        const listIndent = safeLabel === undefined ? indent : `${indent}  `;
        const itemSchema = record(schema?.items);
        for (const item of value) {
          if (generated.length > lineLimit) break;
          const itemScalar = scalar(item, resolved);
          if (itemScalar !== undefined && !itemScalar.includes("\n"))
            add(`${listIndent}- ${itemScalar}`);
          else {
            add(`${listIndent}-`);
            render(item, itemSchema, depth + 1, `${listIndent}  `);
          }
        }
        return;
      }

      const object = value as Record<string, unknown>;
      const keys = orderedKeys(object, schema);
      if (keys.length === 0) {
        add(`${indent}${safeLabel === undefined ? "" : `${safeLabel}: `}{}`);
        return;
      }
      if (safeLabel !== undefined) add(`${indent}${safeLabel}:`);
      const objectIndent = safeLabel === undefined ? indent : `${indent}  `;
      for (const key of keys) {
        if (generated.length > lineLimit) break;
        render(object[key], childSchema(schema, key), depth + 1, objectIndent, key);
      }
    };

    render(request.input, record(request.inputSchema), 0, "");
    let lines = generated;
    if (lines.length > lineLimit) {
      lines =
        lineLimit === 0 ? [] : [...lines.slice(0, lineLimit - 1), "... [1 or more lines omitted]"];
    }

    let summary = safeName;
    const top = record(request.input);
    if (top) {
      for (const key of orderedKeys(top, record(request.inputSchema))) {
        const value = scalar(top[key], resolved);
        if (value !== undefined) {
          summary = `${sanitizeTerminalText(key)}: ${value.split("\n")[0] ?? ""}`;
          break;
        }
      }
    } else {
      const value = scalar(request.input, resolved);
      if (value !== undefined) summary = value.split("\n")[0] ?? safeName;
    }
    return {
      lines,
      summary: truncateDisplay(sanitizeTerminalText(summary), resolved.maxSummaryColumns),
    };
  } catch {
    return {
      lines: ["[unavailable]"],
      summary: truncateDisplay(safeName, resolved.maxSummaryColumns),
    };
  }
}
