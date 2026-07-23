import { configDefaults, defineConfig } from "vitest/config";

const boundaryTestFiles = [
  "test/candidate-acceptance-review.integration.test.ts",
  "test/candidate-validation-inspection.integration.test.ts",
  "test/candidate-validation.integration.test.ts",
  "test/change-candidate-capture.test.ts",
  "test/change-inspection.test.ts",
  "test/change-cleanup-git.test.ts",
  "test/change-implement.test.ts",
  "test/change-start-managed-worktree.test.ts",
  "test/publication-policy.test.ts",
  "test/repository-storage.test.ts",
  "test/shared-state.test.ts",
  "test/state-storage-workflow.test.ts",
  "test/task-cli-process.test.ts",
] as const;
const packageTestFiles = ["test/installable-cli.test.ts"] as const;
const slowTestFiles = [...boundaryTestFiles, ...packageTestFiles];

const suite = process.env.BY_TEST_SUITE;
const suiteSelection =
  suite === "boundary"
    ? { include: [...boundaryTestFiles] }
    : suite === "package"
      ? { include: [...packageTestFiles] }
      : suite === "routine"
        ? { exclude: [...configDefaults.exclude, ".direnv/**", ...slowTestFiles] }
        : { exclude: [...configDefaults.exclude, ".direnv/**"] };

export default defineConfig({
  test: {
    ...suiteSelection,
    coverage: {
      all: true,
      include: ["src/**/*.ts"],
      provider: "istanbul",
      reporter: ["json", "json-summary"],
      reportsDirectory: "coverage",
    },
    isolate: false,
    pool: "threads",
  },
});
