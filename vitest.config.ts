import { configDefaults, defineConfig } from "vitest/config";

const sandcastleWorkspaceGlob = ".sandcastle/**";

export default defineConfig({
  test: {
    exclude: [...configDefaults.exclude, ".direnv/**", sandcastleWorkspaceGlob],
    reporters: ["dot"],
    coverage: {
      all: true,
      include: ["src/**/*.ts"],
      provider: "istanbul",
      reporter: ["json", "json-summary"],
      reportsDirectory: "coverage",
    },
    isolate: false,
    maxWorkers: 3,
    pool: "threads",
  },
});
