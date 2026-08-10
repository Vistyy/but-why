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

export type ChangeValidationTestPorts = CandidateValidationExecutionPort &
  ChangeValidationReadPort &
  ActiveValidationRunPort &
  ValidationRunAbandonmentPort &
  ValidationArtifactLifecyclePort;

export const openSqliteChangeValidationTestPorts = () =>
  Effect.all({
    active: openSqliteActiveValidationRunPort(),
    execution: openSqliteCandidateValidationExecutionPort(),
    reads: openSqliteChangeValidationReadPort(),
    artifacts: openSqliteValidationArtifactLifecyclePort(),
    abandonment: openSqliteValidationRunAbandonmentPort(),
  }).pipe(
    Effect.map(({ active, execution, reads, artifacts, abandonment }) => ({
      ...active,
      ...execution,
      ...reads,
      ...artifacts,
      ...abandonment,
    })),
  );
