import { configDefaults, defineConfig } from "vitest/config";

const boundaryTestGlob = "test/**/*.boundary.test.ts";
const sandcastleWorkspaceGlob = ".sandcastle/**";

const suite = process.env.BY_TEST_SUITE;
const suiteSelection =
  suite === "boundary"
    ? {
        include: [boundaryTestGlob],
        exclude: [...configDefaults.exclude, sandcastleWorkspaceGlob],
      }
    : suite === "routine"
      ? {
          exclude: [
            ...configDefaults.exclude,
            ".direnv/**",
            sandcastleWorkspaceGlob,
            boundaryTestGlob,
          ],
        }
      : { exclude: [...configDefaults.exclude, ".direnv/**", sandcastleWorkspaceGlob] };

export default defineConfig({
  test: {
    ...suiteSelection,
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
