import { Effect } from "effect";
import { openSqliteActiveValidationRunPort } from "../../src/change/adapters/sqlite/sqliteActiveValidationRunPersistence.js";
import { openSqliteCandidateValidationExecutionPort } from "../../src/change/adapters/sqlite/sqliteCandidateValidationExecutionPersistence.js";
import { openSqliteChangeAgentSessionPort } from "../../src/change/adapters/sqlite/sqliteChangeAgentSessionPersistence.js";
import { openSqliteChangeValidationReadPort } from "../../src/change/adapters/sqlite/sqliteChangeValidationReadPersistence.js";
import { openSqliteValidationArtifactLifecyclePort } from "../../src/change/adapters/sqlite/sqliteValidationArtifactLifecyclePersistence.js";
import { openSqliteValidationRunAbandonmentPort } from "../../src/change/adapters/sqlite/sqliteValidationRunAbandonmentPersistence.js";
import type { ChangeAgentSessionPort } from "../../src/change/changePorts.js";
import type {
  ActiveValidationRunPort,
  CandidateValidationExecutionPort,
  ChangeValidationReadPort,
  ValidationArtifactLifecyclePort,
  ValidationRunAbandonmentPort,
} from "../../src/change/validation/changeValidationPorts.js";

export const openSqliteChangeValidationTestDependencies = () =>
  Effect.all({
    agentSessions: openSqliteChangeAgentSessionPort(),
    active: openSqliteActiveValidationRunPort(),
    execution: openSqliteCandidateValidationExecutionPort(),
    reads: openSqliteChangeValidationReadPort(),
    artifacts: openSqliteValidationArtifactLifecyclePort(),
    abandonment: openSqliteValidationRunAbandonmentPort(),
  });

export type ChangeValidationTestDependencies = {
  readonly agentSessions: ChangeAgentSessionPort;
  readonly active: ActiveValidationRunPort;
  readonly execution: CandidateValidationExecutionPort;
  readonly reads: ChangeValidationReadPort;
  readonly artifacts: ValidationArtifactLifecyclePort;
  readonly abandonment: ValidationRunAbandonmentPort;
};
