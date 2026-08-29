import { describe, expect, it } from "vitest";
import { sanitizeTerminalText, truncateDisplay } from "../src/observability/terminal-text.js";
import { formatToolInput } from "../src/observability/tool-input.js";

const request = (input: unknown, inputSchema: Record<string, unknown> = { type: "object" }) => ({
  name: "third_party_tool",
  risk: "modify" as const,
  inputSchema,
  input,
});

describe("tool input display", () => {
  it("uses schema property order and renders multiline strings as real lines", () => {
    const result = formatToolInput(
      request(
        {
          content: "line 1\nline 2",
          path: "src/a.ts",
          target: { environment: "production", regions: ["ap-east-1", "eu-west-1"] },
        },
        {
          type: "object",
          properties: {
            path: { type: "string" },
            content: { type: "string" },
            target: {
              type: "object",
              properties: {
                environment: { type: "string" },
                regions: { type: "array", items: { type: "string" } },
              },
            },
          },
        },
      ),
    );

    expect(result.lines).toEqual([
      "path: src/a.ts",
      "content:",
      "  line 1",
      "  line 2",
      "target:",
      "  environment: production",
      "  regions:",
      "    - ap-east-1",
      "    - eu-west-1",
    ]);
    expect(result.lines.join("\n")).not.toContain("\\n");
    expect(result.summary).toContain("path: src/a.ts");
  });

  it("renders arrays, null, booleans, and empty collections without JSON noise", () => {
    const result = formatToolInput(
      request({ values: [1, null, true, { key: "value" }], empty: [], none: {} }),
    );
    expect(result.lines).toContain("values:");
    expect(result.lines).toContain("  - 1");
    expect(result.lines).toContain("  - null");
    expect(result.lines).toContain("  - true");
    expect(result.lines).toContain("empty: []");
    expect(result.lines).toContain("none: {}");
  });

  it("bounds value size, depth, total lines, and circular references", () => {
    const circular: Record<string, unknown> = {
      text: "x".repeat(30),
      deep: { a: { b: { c: 1 } } },
    };
    circular.self = circular;
    const result = formatToolInput(request(circular), {
      maxLines: 6,
      maxValueChars: 10,
      maxDepth: 2,
      maxSummaryColumns: 18,
    });

    expect(result.lines.length).toBeLessThanOrEqual(6);
    expect(result.lines.join("\n")).toContain("omitted");
    expect(result.lines.join("\n")).toMatch(/\[max depth\]|\[circular\]/);
    expect(result.summary.length).toBeLessThanOrEqual(18);
  });

  it("removes terminal controls and truncates wide text by display columns", () => {
    expect(sanitizeTerminalText("safe\u001b[31mred\u001b[0m\u0007\nnext")).toBe("safered\nnext");
    expect(truncateDisplay("ab中文cd", 7)).toBe("ab中文…");
    expect(truncateDisplay("abcdef", 4, "tail")).toBe("…def");
  });
});
