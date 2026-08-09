export const completeOnlyTestFiles = [
  "test/agent/reviewer-agent-runtime-process.test.ts",
  "test/change/artifact-lifecycle.test.ts",
  "test/change/change-candidate-capture.test.ts",
  "test/change/change-cleanup-git.test.ts",
  "test/change/change-implement-main-checkout-failure.test.ts",
  "test/change/change-implement.test.ts",
  "test/change/change-implement-process.test.ts",
  "test/change/change-inspection.test.ts",
  "test/change/change-reconcile-discard.test.ts",
  "test/change/change-start-managed-worktree.test.ts",
  "test/publication/publication-policy.test.ts",
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
] as const;

export const approvedCompleteOnlyTestFiles = [
  "test/agent/reviewer-agent-runtime-process.test.ts",
  "test/change/change-implement-main-checkout-failure.test.ts",
] as const;

type ScheduleInput = {
  readonly maintainedTestFiles: readonly string[];
  readonly completeOnlyTestFiles: readonly string[];
  readonly approvedCompleteOnlyTestFiles: readonly string[];
};

export const scheduleErrors = (input: ScheduleInput): readonly string[] => {
  const errors: string[] = [];
  const maintained = new Set(input.maintainedTestFiles);
  const completeOnly = new Set(input.completeOnlyTestFiles);
  const duplicateEntries = (entries: readonly string[], owner: string): void => {
    const duplicates = entries.filter((entry, index) => entries.indexOf(entry) !== index);
    for (const duplicate of new Set(duplicates))
      errors.push(`${owner} contains duplicate ${duplicate}`);
  };

  duplicateEntries(input.completeOnlyTestFiles, "complete-only registry");

  for (const file of completeOnly) {
    if (!maintained.has(file))
      errors.push(`schedule references nonexistent maintained test ${file}`);
  }
  for (const file of input.approvedCompleteOnlyTestFiles) {
    if (!completeOnly.has(file)) errors.push(`approved complete-only test is omitted ${file}`);
  }

  return errors;
};

export const assertValidSchedule = (input: ScheduleInput): void => {
  const errors = scheduleErrors(input);
  if (errors.length > 0) throw new Error(errors.join("; "));
};
