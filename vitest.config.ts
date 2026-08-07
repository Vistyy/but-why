import { configDefaults, defineConfig } from "vitest/config";

import { completeOnlyTestFiles } from "./test/suiteSchedule.js";

const sandcastleWorkspaceGlob = ".sandcastle/**";
// Complete-only files require focused external evidence.
// The routine quality suite excludes this explicit list; the complete
// quality suite includes it. Scheduling never derives evidence from a
// filename suffix.
const suite = process.env.BY_TEST_SUITE;
const suiteSelection =
  suite === "complete"
    ? {
        include: completeOnlyTestFiles,
        exclude: [...configDefaults.exclude, sandcastleWorkspaceGlob],
      }
    : suite === "routine"
      ? {
          exclude: [
            ...configDefaults.exclude,
            ".direnv/**",
            sandcastleWorkspaceGlob,
            ...completeOnlyTestFiles,
          ],
        }
      : {
          exclude: [...configDefaults.exclude, ".direnv/**", sandcastleWorkspaceGlob],
        };

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
