import { Effect } from "effect";
import type {
  ActiveValidationRunPort,
  CandidateValidationExecutionPort,
  ChangeValidationReadPort,
  ValidationArtifactLifecyclePort,
  ValidationRunAbandonmentPort,
} from "../../src/change/validation/changeValidationPorts.js";
import {
  openSqliteActiveValidationRunPort,
  openSqliteCandidateValidationExecutionPort,
  openSqliteChangeValidationReadPort,
  openSqliteValidationArtifactLifecyclePort,
  openSqliteValidationRunAbandonmentPort,
} from "../../src/sqlite/sqliteChangeValidationPersistence.js";

export const openSqliteChangeValidationTestDependencies = () =>
  Effect.all({
    active: openSqliteActiveValidationRunPort(),
    execution: openSqliteCandidateValidationExecutionPort(),
    reads: openSqliteChangeValidationReadPort(),
    artifacts: openSqliteValidationArtifactLifecyclePort(),
    abandonment: openSqliteValidationRunAbandonmentPort(),
  });

export type ChangeValidationTestDependencies = {
  readonly active: ActiveValidationRunPort;
  readonly execution: CandidateValidationExecutionPort;
  readonly reads: ChangeValidationReadPort;
  readonly artifacts: ValidationArtifactLifecyclePort;
  readonly abandonment: ValidationRunAbandonmentPort;
};
