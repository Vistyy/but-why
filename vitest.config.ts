import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    exclude: [...configDefaults.exclude, ".direnv/**"],
    reporters: ["dot"],
    coverage: {
      all: true,
      include: ["extensions/**/*.ts", "scripts/**/*.{mjs,ts}", "src/**/*.ts"],
      provider: "istanbul",
      reporter: ["json", "json-summary"],
      reportsDirectory: "coverage",
    },
    isolate: false,
    maxWorkers: 3,
    pool: "threads",
  },
});
