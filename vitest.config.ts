import { configDefaults, defineConfig } from "vitest/config";

const sandcastleWorkspaceGlob = ".sandcastle/**";
const manualDiagnosticGlob = "test/agent/herdr-smoke.test.ts";
// The real Herdr smoke check is a manual, non-blocking diagnostic.
// Maintained suites exclude it unless the documented manual command sets
// BY_MANUAL_DIAGNOSTICS=1 so live Herdr is never required by blocking evidence.
const includeManualDiagnostics = process.env.BY_MANUAL_DIAGNOSTICS === "1";
const manualDiagnosticExcludes = includeManualDiagnostics ? [] : [manualDiagnosticGlob];

// Complete-evidence files require the focused external boundaries
// (real SQLite, Git, processes, package, or linked-worktree sentinels).
// The routine quality suite excludes this explicit list; the complete
// evidence suite includes it. Scheduling never derives evidence from a
// filename suffix.
const completeEvidenceFiles = [
  "test/change/artifact-lifecycle.test.ts",
  "test/change/change-candidate-capture.test.ts",
  "test/change/change-cleanup-git.test.ts",
  "test/change/change-implement.test.ts",
  "test/change/change-implement-process.test.ts",
  "test/change/change-inspection.test.ts",
  "test/change/change-reconcile-discard.test.ts",
  "test/change/change-start-managed-worktree.test.ts",
  "test/publication/publication-policy.test.ts",
  "test/repository/cli-loading.test.ts",
  "test/repository/process-isolation.test.ts",
  "test/repository/quality-interface.test.ts",
  "test/repository/repository-storage.test.ts",
  "test/repository/shared-state.test.ts",
  "test/repository/shared-state-snapshot.test.ts",
  "test/repository/source-workflow-isolation.test.ts",
  "test/repository/tooling-diagnostics.test.ts",
  "test/repository/tooling-exclusions.test.ts",
  "test/task/task-cli-process.test.ts",
  "test/validation/candidate-acceptance-review.test.ts",
  "test/validation/candidate-validation.test.ts",
  "test/validation/candidate-validation-inspection.test.ts",
];

const suite = process.env.BY_TEST_SUITE;
const suiteSelection =
  suite === "boundary"
    ? {
        include: completeEvidenceFiles,
        exclude: [...configDefaults.exclude, sandcastleWorkspaceGlob],
      }
    : suite === "routine"
      ? {
          exclude: [
            ...configDefaults.exclude,
            ".direnv/**",
            sandcastleWorkspaceGlob,
            ...completeEvidenceFiles,
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
