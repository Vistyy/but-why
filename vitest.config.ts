import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      all: true,
      include: ["src/**/*.ts"],
      provider: "istanbul",
      reporter: ["text", "json", "json-summary"],
      reportsDirectory: "coverage",
    },
    globalSetup: ["./test/globalSetup.ts"],
    pool: "threads",
  },
});
