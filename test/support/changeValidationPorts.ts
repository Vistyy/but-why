import { Effect } from "effect";
import { openSqliteAgentSessionPersistence } from "../../src/agent/agentSession/adapters/sqlite/sqliteAgentSessionPersistence.js";
import type { AgentSessionPersistence } from "../../src/agent/agentSession/agentSession.js";
import type { ChangeAgentSessionPort } from "../../src/change/changePorts.js";
import type {
  ActiveValidationRunPort,
  CandidateValidationExecutionPort,
  ChangeValidationReadPort,
  ValidationArtifactLifecyclePort,
  ValidationRunAbandonmentPort,
} from "../../src/change/validation/changeValidationPorts.js";
import { openSqliteActiveValidationRunPort } from "../../src/sqlite/sqliteActiveValidationRunPersistence.js";
import { openSqliteCandidateValidationExecutionPort } from "../../src/sqlite/sqliteCandidateValidationExecutionPersistence.js";
import { openSqliteChangeAgentSessionPort } from "../../src/sqlite/sqliteChangeAgentSessionPersistence.js";
import { openSqliteChangeValidationReadPort } from "../../src/sqlite/sqliteChangeValidationReadPersistence.js";
import { openSqliteValidationArtifactLifecyclePort } from "../../src/sqlite/sqliteValidationArtifactLifecyclePersistence.js";
import { openSqliteValidationRunAbandonmentPort } from "../../src/sqlite/sqliteValidationRunAbandonmentPersistence.js";

export const openSqliteChangeValidationTestDependencies = () =>
  Effect.all({
    agentPersistence: openSqliteAgentSessionPersistence(),
    agentSessions: openSqliteChangeAgentSessionPort(),
    active: openSqliteActiveValidationRunPort(),
    execution: openSqliteCandidateValidationExecutionPort(),
    reads: openSqliteChangeValidationReadPort(),
    artifacts: openSqliteValidationArtifactLifecyclePort(),
    abandonment: openSqliteValidationRunAbandonmentPort(),
  });

export type ChangeValidationTestDependencies = {
  readonly agentPersistence: AgentSessionPersistence;
  readonly agentSessions: ChangeAgentSessionPort;
  readonly active: ActiveValidationRunPort;
  readonly execution: CandidateValidationExecutionPort;
  readonly reads: ChangeValidationReadPort;
  readonly artifacts: ValidationArtifactLifecyclePort;
  readonly abandonment: ValidationRunAbandonmentPort;
};
