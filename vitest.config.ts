import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    exclude: [...configDefaults.exclude, ".direnv/**"],
    coverage: {
      all: true,
      include: ["src/**/*.ts"],
      provider: "istanbul",
      reporter: ["text", "json", "json-summary"],
      reportsDirectory: "coverage",
    },
    pool: "threads",
  },
});
