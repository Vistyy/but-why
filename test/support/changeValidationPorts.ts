import { Effect } from "effect";
import type {
  ActiveValidationRunPort,
  CandidateValidationExecutionPort,
  ChangeValidationReadPort,
  ValidationArtifactLifecyclePort,
  ValidationRunAbandonmentPort,
} from "../../src/change/validation/changeValidationPorts.js";
import { openSqliteActiveValidationRunPort } from "../../src/sqlite/sqliteActiveValidationRunPersistence.js";
import { openSqliteCandidateValidationExecutionPort } from "../../src/sqlite/sqliteCandidateValidationExecutionPersistence.js";
import { openSqliteChangeValidationReadPort } from "../../src/sqlite/sqliteChangeValidationReadPersistence.js";
import { openSqliteValidationArtifactLifecyclePort } from "../../src/sqlite/sqliteValidationArtifactLifecyclePersistence.js";
import { openSqliteValidationRunAbandonmentPort } from "../../src/sqlite/sqliteValidationRunAbandonmentPersistence.js";

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
