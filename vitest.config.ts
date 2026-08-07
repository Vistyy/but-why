import { configDefaults, defineConfig } from "vitest/config";

import { completeOnlyTestFiles, smokeOrManualTestFiles } from "./test/suiteSchedule.js";

const sandcastleWorkspaceGlob = ".sandcastle/**";
const manualDiagnosticGlob = smokeOrManualTestFiles[0];
// The real Herdr smoke check is a manual, non-blocking diagnostic.
// Maintained suites exclude it unless the documented manual command sets
// BY_MANUAL_DIAGNOSTICS=1 so live Herdr is never required by blocking evidence.
const includeManualDiagnostics = process.env.BY_MANUAL_DIAGNOSTICS === "1";
const manualDiagnosticExcludes = includeManualDiagnostics ? [] : [manualDiagnosticGlob];

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
            ...manualDiagnosticExcludes,
          ],
        }
      : {
          exclude: [
            ...configDefaults.exclude,
            ".direnv/**",
            sandcastleWorkspaceGlob,
            ...manualDiagnosticExcludes,
          ],
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
