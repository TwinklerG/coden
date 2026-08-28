import { describe, expect, it } from "vitest";
import { builtinTools } from "../../src/tools/builtin/index.js";
import { ToolRegistry } from "../../src/tools/registry.js";
import { normalizePluginExport } from "../../src/plugins/api.js";

const tool = {
  name: "hello",
  description: "Say hello",
  risk: "read" as const,
  inputSchema: { type: "object" },
  async execute() {
    return { content: "hello" };
  },
};

describe("npm plugin API", () => {
  it("normalizes a single tool", () => {
    expect(normalizePluginExport(tool, "@acme/hello")).toEqual([tool]);
  });

  it("normalizes a version-one multi-tool plugin", () => {
    expect(
      normalizePluginExport({ apiVersion: 1, name: "@acme/hello", tools: [tool] }, "@acme/hello"),
    ).toEqual([tool]);
  });

  it("rejects mismatched package identity", () => {
    expect(() =>
      normalizePluginExport({ apiVersion: 1, name: "@other/plugin", tools: [tool] }, "@acme/hello"),
    ).toThrow(/plugin.name_mismatch/);
  });

  it("rejects unsupported API versions and empty tool arrays", () => {
    expect(() =>
      normalizePluginExport({ apiVersion: 2, name: "@acme/hello", tools: [tool] }, "@acme/hello"),
    ).toThrow(/plugin.api_unsupported/);
    expect(() =>
      normalizePluginExport({ apiVersion: 1, name: "@acme/hello", tools: [] }, "@acme/hello"),
    ).toThrow(/plugin.export_invalid/);
  });
});

it("retains source metadata without changing list/get behavior", () => {
  const registry = new ToolRegistry(builtinTools());
  registry.register(tool, {
    kind: "npm",
    pluginName: "@acme/hello",
    pluginVersion: "1.0.0",
    path: "/plugins/hello.js",
  });

  expect(registry.get("hello")).toBe(tool);
  expect(registry.list()).toContain(tool);
  expect(registry.source("hello")).toMatchObject({ kind: "npm", pluginName: "@acme/hello" });
  expect(registry.clone().entries()).toEqual(registry.entries());
});

it("reports both sources when tools conflict", () => {
  const registry = new ToolRegistry(builtinTools());
  registry.register(tool, { kind: "npm", pluginName: "plugin-a", pluginVersion: "1.0.0" });
  expect(() =>
    registry.register(tool, { kind: "npm", pluginName: "plugin-b", pluginVersion: "2.0.0" }),
  ).toThrow(/plugin-a@1.0.0.*plugin-b@2.0.0/s);
});
