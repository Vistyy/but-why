import { Effect } from "effect";
import type { AgentSessionPersistence } from "../../src/agent/agentSession/agentSession.js";
import type { ChangeAgentSessionPort } from "../../src/change/changePorts.js";
import type {
  ActiveValidationRunPort,
  CandidateValidationExecutionPort,
  ChangeValidationReadPort,
  ValidationArtifactLifecyclePort,
  ValidationRunAbandonmentPort,
} from "../../src/change/validation/changeValidationPorts.js";
import { openSqliteActiveValidationRunPort } from "../../src/repositoryRuntime/adapters/sqlite/sqliteActiveValidationRunPersistence.js";
import { openSqliteAgentSessionPersistence } from "../../src/repositoryRuntime/adapters/sqlite/sqliteAgentSessionPersistence.js";
import { openSqliteCandidateValidationExecutionPort } from "../../src/repositoryRuntime/adapters/sqlite/sqliteCandidateValidationExecutionPersistence.js";
import { openSqliteChangeAgentSessionPort } from "../../src/repositoryRuntime/adapters/sqlite/sqliteChangeAgentSessionPersistence.js";
import { openSqliteChangeValidationReadPort } from "../../src/repositoryRuntime/adapters/sqlite/sqliteChangeValidationReadPersistence.js";
import { openSqliteValidationArtifactLifecyclePort } from "../../src/repositoryRuntime/adapters/sqlite/sqliteValidationArtifactLifecyclePersistence.js";
import { openSqliteValidationRunAbandonmentPort } from "../../src/repositoryRuntime/adapters/sqlite/sqliteValidationRunAbandonmentPersistence.js";

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
