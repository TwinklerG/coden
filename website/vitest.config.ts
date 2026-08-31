import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts", "test/**/*.test.tsx"],
    globals: false,
    setupFiles: ["./test/setup.ts"],
  },
  esbuild: {
    jsx: "automatic",
    jsxImportSource: "react",
  },
});
