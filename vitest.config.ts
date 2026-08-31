import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts", "test/**/*.test.tsx"],
    testTimeout: 10_000,
    coverage: { reporter: ["text"] },
    env: {
      NO_COLOR: "1",
    },
  },
});
