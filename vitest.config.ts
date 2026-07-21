import { defineConfig } from "vitest/config";

// TypeScript erases these modules before Istanbul can instrument them.
const declarationOnlyModules = [
  "src/agent/agentProfileErrors.ts",
  "src/candidate/candidate.ts",
  "src/candidate/candidateStore.ts",
  "src/candidateValidation/candidateValidationRunStore.ts",
  "src/change/changeStartStore.ts",
  "src/change/changeStore.ts",
  "src/change/interactiveSessionHost.ts",
  "src/change/ownedPullRequestGateway.ts",
  "src/changeCandidateCapture/changeCandidateCaptureStore.ts",
  "src/contracts/configErrors.ts",
  "src/submit/submitRejectionErrors.ts",
  "src/task/taskStore.ts",
  "src/validation/validationWorkspace.ts",
  "src/validationRun/cleanup.ts",
  "src/validationRun/taskContextSnapshot.ts",
  "src/validationRun/toolingErrorKind.ts",
];

export default defineConfig({
  test: {
    coverage: {
      all: true,
      exclude: declarationOnlyModules,
      include: ["src/**/*.ts"],
      provider: "istanbul",
      reporter: ["text", "json", "json-summary"],
      reportsDirectory: "coverage",
    },
    globalSetup: ["./test/globalSetup.ts"],
    pool: "threads",
  },
});
