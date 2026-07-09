import type {
  ValidationRunArtifactRecord,
  ValidationRunFindingRecord,
  ValidationRunPhaseStatusRecord,
  ValidationRunRecord,
  ValidationRunRoundRecord,
} from "./validationRun.js";
import type { ValidationRunStore, ValidationRunToolingErrorRecord } from "./validationRunStore.js";
import type { TaskContextSnapshotV1 } from "./taskContextSnapshot.js";

export type ValidationRunUseCases = {
  readonly getValidationRunDetails: (validationRunId: string) => ValidationRunDetails | undefined;
};

export type ValidationRunDetails = {
  readonly validationRun: ValidationRunRecord;
  readonly taskContextSnapshot: TaskContextSnapshotV1 | null;
  readonly phases: readonly ValidationRunPhaseStatusRecord[];
  readonly rounds: readonly ValidationRunRoundRecord[];
  readonly findings: readonly ValidationRunFindingRecord[];
  readonly toolingFailures: readonly ValidationRunToolingErrorRecord[];
  readonly artifacts: readonly ValidationRunArtifactRecord[];
};

export const openValidationRunUseCases = (stores: {
  readonly validationRunStore: ValidationRunStore;
}): ValidationRunUseCases => ({
  getValidationRunDetails: (validationRunId) =>
    getValidationRunDetails(stores.validationRunStore, validationRunId),
});

const getValidationRunDetails = (
  validationRunStore: ValidationRunStore,
  validationRunId: string,
): ValidationRunDetails | undefined => {
  const validationRun = validationRunStore.getValidationRunById(validationRunId);

  if (validationRun === undefined) {
    return undefined;
  }

  return {
    validationRun,
    taskContextSnapshot: validationRunStore.getTaskContextSnapshot(validationRunId),
    phases: validationRunStore.listValidationRunPhaseStatuses(validationRunId),
    rounds: validationRunStore.listValidationRunRounds(validationRunId),
    findings: validationRunStore.listValidationRunFindings(validationRunId),
    toolingFailures: validationRunStore.listValidationRunToolingErrors(validationRunId),
    artifacts: validationRunStore.listValidationRunArtifacts(validationRunId),
  };
};
