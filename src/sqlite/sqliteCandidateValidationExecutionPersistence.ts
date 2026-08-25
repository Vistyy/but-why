import type * as SqlClient from "@effect/sql/SqlClient";
import { Effect } from "effect";
import {
  assertValidationArtifactRecord,
  assertValidationFindingEvidence,
  assertValidationToolingFailureEvidence,
  decodeValidationFindingEvidence,
} from "../change/candidateValidation/candidateValidationEvidence.js";
import type {
  CandidateValidationFinding,
  RecordCandidateValidationPhaseResultInput,
  StartCandidateValidationRunInput,
  StartCandidateValidationRunResult,
} from "../change/candidateValidation/candidateValidationRunStore.js";
import { internalChangeId, publicChangeId } from "../change/changeId.js";
import { latestResolvedBlockerId } from "../change/implementationBlocker.js";
import type { CandidateValidationExecutionPort } from "../change/validation/changeValidationPorts.js";
import { deriveAcceptanceContext } from "../change/validationRun/acceptanceContextSnapshot.js";
import {
  isValidationRunEligibleForCurrentChangeAuthority,
  validationPhase,
} from "../change/validationRun/validationRun.js";
import { RepositoryPersistedDataInvalid } from "../contracts/repositoryStorageError.js";
import { RepositorySql } from "../repositoryRuntime/adapters/sqlite/repositorySql.js";
import { decodePersisted } from "../repositoryRuntime/adapters/sqlite/sqlitePersistedData.js";
import { decodeSqliteAcceptanceContextSnapshot } from "./sqliteAcceptanceContextSnapshot.js";
import {
  compareCandidatesAscending,
  readCandidateById,
  readCurrentCandidateForChange,
} from "./sqliteCandidateStorage.js";
import {
  decodeImplementationBlockerHistory,
  decodeImplementationDecisions,
  implementationBlockerReadColumns,
  type StoredImplementationBlockerRow,
  type StoredImplementationDecisionRow,
} from "./sqliteChangeAuthorityHistory.js";
import { requireCoherentValidationCompletion } from "./sqliteValidationCompletion.js";
import {
  listValidationArtifacts,
  listValidationFindings,
  listValidationPhaseResults,
  listValidationToolingFailures,
} from "./sqliteValidationEvidenceStorage.js";
import { encodeSqliteValidationInputSnapshot } from "./sqliteValidationInputSnapshot.js";
import { requireValidationPosition } from "./sqliteValidationPosition.js";
import {
  readActiveValidationRunForChange,
  readValidationExecutionAuthorityById,
  readValidationRunById,
  type StoredValidationRunRow,
  validationRunReadColumns,
} from "./sqliteValidationRunStorage.js";

export const openSqliteCandidateValidationExecutionPort = () =>
  Effect.map(
    RepositorySql,
    (repository): CandidateValidationExecutionPort => ({
      startOrReuse: (input) =>
        repository.transactionImmediate("start Candidate Validation Run", (sql) =>
          startOrReuse(sql, input, repository.idPrefix),
        ),
      complete: (input) =>
        repository.transactionImmediate("complete Candidate Validation Run", (sql) =>
          complete(sql, input, repository.idPrefix),
        ),
      recordWorkspaceCleanup: (input) =>
        repository.transactionImmediate("record Validation Run cleanup", (sql) =>
          recordWorkspaceCleanup(
            sql,
            input.validationRunId,
            input.cleanupWorkspace,
            input.cleanupBlockingReason,
          ),
        ),
      recordToolingFailure: (input) =>
        repository.transactionImmediate("record Candidate validation Tooling Failure", (sql) =>
          Effect.gen(function* () {
            const operationName = "record Candidate validation Tooling Failure";
            const failure = toolingFailureValue(input);
            yield* requireValidToolingFailure(failure, operationName);
            yield* sql`
              UPDATE validation_runs
              SET run_tooling_failure = ${JSON.stringify(failure)}
              WHERE id = ${input.validationRunId} AND outcome IS NULL
            `;
          }).pipe(Effect.asVoid),
        ),
      recordPrepareResult: (input) =>
        repository.transactionImmediate("record Candidate validation Prepare Result", (sql) =>
          recordPhaseResult(
            sql,
            { ...input, phase: validationPhase.prepare, producer: "prepare" },
            repository.idPrefix,
          ),
        ),
      recordCheckResult: (input) =>
        repository.transactionImmediate("record Candidate validation Check Result", (sql) =>
          recordPhaseResult(sql, { ...input, phase: validationPhase.checks }, repository.idPrefix),
        ),
      recordAcceptanceResult: (input) =>
        repository.transactionImmediate("record Candidate Acceptance Review Result", (sql) =>
          Effect.gen(function* () {
            yield* requirePreDispatchReviewerIntegrityFailure(
              sql,
              input,
              validationPhase.acceptanceReview,
              "acceptance",
              "record Candidate Acceptance Review Result",
            );
            yield* recordPhaseResult(
              sql,
              {
                ...input,
                phase: validationPhase.acceptanceReview,
                producer: "acceptance",
              },
              repository.idPrefix,
            );
          }),
        ),
      recordSpecialistResult: (input) =>
        repository.transactionImmediate("record Candidate Specialist Review Result", (sql) =>
          Effect.gen(function* () {
            yield* requirePreDispatchReviewerIntegrityFailure(
              sql,
              input,
              validationPhase.specialistReview,
              input.producer,
              "record Candidate Specialist Review Result",
            );
            yield* recordPhaseResult(
              sql,
              { ...input, phase: validationPhase.specialistReview },
              repository.idPrefix,
            );
          }),
        ),
      settleAgentInvocationResult: (input) => (sql, invocationId) =>
        Effect.gen(function* () {
          const operationName = "settle Candidate validation Agent Invocation";
          const links = yield* sql<{
            readonly invocationId: number;
            readonly settledAt: string | null;
            readonly settlementKind: string | null;
          }>`
            SELECT link.agent_invocation_id AS invocationId,
              invocation.settled_at AS settledAt,
              invocation.settlement_kind AS settlementKind
            FROM validation_phase_agent_invocations AS link
            JOIN agent_invocations AS invocation ON invocation.id = link.agent_invocation_id
            WHERE link.validation_run_id = ${input.validationRunId}
              AND link.phase = ${input.phase}
              AND link.producer = ${input.producer}
            ORDER BY link.agent_invocation_id
          `;
          const terminal = links.at(-1);
          if (terminal?.invocationId !== invocationId) {
            return yield* invalidData(
              operationName,
              "Only the terminal linked Invocation can settle the Validation position",
            );
          }
          if (links.some((link) => link.settledAt === null || link.settlementKind === null)) {
            return yield* invalidData(
              operationName,
              "Every linked reviewer Invocation must be settled before the final Result",
            );
          }
          const hasFindings = input.findings.length > 0;
          if (
            (input.outcome === "passed" || hasFindings) &&
            terminal.settlementKind !== "returned"
          ) {
            return yield* invalidData(
              operationName,
              "Reviewer Findings and passing Results require a returned terminal Invocation",
            );
          }
          if (
            (input.outcome === "passed" && (hasFindings || input.toolingFailure !== undefined)) ||
            (input.outcome === "failed" && hasFindings === (input.toolingFailure !== undefined))
          ) {
            return yield* invalidData(operationName, "Reviewer Result evidence is incoherent");
          }
          yield* recordPhaseResult(
            sql,
            {
              validationRunId: input.validationRunId,
              phase: input.phase,
              producer: input.producer,
              outcome: input.outcome,
              artifactRecords: input.artifactRecords,
              findings: input.findings,
              ...(input.toolingFailure === undefined
                ? {}
                : { toolingFailure: input.toolingFailure }),
            },
            repository.idPrefix,
            "settle Candidate validation Agent Invocation",
          );
        }),
      listPhaseResults: (validationRunId) =>
        repository.transaction("list Validation Phase Results", (sql) =>
          listValidationPhaseResults(sql, validationRunId, repository.idPrefix),
        ),
      listRunsForChange: (changeId) =>
        repository.transaction("list Change Validation Runs", (sql) =>
          listRunsForChange(sql, changeId, repository.idPrefix),
        ),
      listFindings: (validationRunId) =>
        repository.transaction("list Candidate validation Findings", (sql) =>
          listValidationFindings(sql, validationRunId, repository.idPrefix),
        ),
      listPreviousCandidateReviewerFindings: (input) =>
        repository.transaction("list previous Candidate reviewer Findings", (sql) =>
          listPreviousCandidateReviewerFindings(sql, input, repository.idPrefix),
        ),
      listToolingFailures: (validationRunId) =>
        repository.transaction("list Candidate validation Tooling Failures", (sql) =>
          listValidationToolingFailures(sql, validationRunId, repository.idPrefix),
        ),
      listArtifacts: (validationRunId) =>
        repository.transaction("list Candidate validation Artifacts", (sql) =>
          listValidationArtifacts(sql, validationRunId, repository.idPrefix),
        ),
    }),
  );

const startOrReuse = (
  sql: SqlClient.SqlClient,
  input: StartCandidateValidationRunInput,
  idPrefix: string,
) =>
  Effect.gen(function* () {
    const operationName = "start Candidate Validation Run";
    const candidate = yield* readCandidateById(sql, input.candidateId, operationName, idPrefix);
    if (
      candidate === undefined ||
      candidate.headSha !== input.headSha ||
      (input.changeBaseSha !== undefined && candidate.changeBaseSha !== input.changeBaseSha)
    ) {
      return yield* invalidData(
        operationName,
        "Candidate validation requires the exact stored Candidate identity.",
      );
    }
    const currentCandidate = yield* readCurrentCandidateForChange(
      sql,
      candidate.changeId,
      operationName,
      idPrefix,
    );
    if (currentCandidate?.id !== candidate.id) {
      return yield* invalidData(
        operationName,
        "Candidate validation requires the current Candidate for its Change.",
      );
    }
    const active = yield* readActiveValidationRunForChange(
      sql,
      candidate.changeId,
      operationName,
      idPrefix,
    );
    if (active !== undefined) {
      return {
        reused: false,
        active: true,
        validationRunId: active.validationRunId,
      } satisfies StartCandidateValidationRunResult;
    }

    const changeRows = yield* sql<{
      readonly id: number;
      readonly closeReason: string | null;
      readonly acceptanceContext: string | null;
    }>`
      SELECT id, close_reason AS closeReason,
        initial_acceptance_context AS acceptanceContext
      FROM changes WHERE id = ${internalChangeId(candidate.changeId, idPrefix)}
    `;
    const changeAuthority = yield* decodePersisted(operationName, () => {
      const row = changeRows[0];
      if (row === undefined || publicChangeId(idPrefix, row.id) !== candidate.changeId) {
        throw new Error("Candidate validation requires the current owning Change");
      }
      if (row.closeReason !== null) throw new Error("Candidate validation requires an open Change");
      return {
        acceptanceContext:
          row.acceptanceContext === null
            ? null
            : decodeSqliteAcceptanceContextSnapshot(row.acceptanceContext),
      };
    });
    const blockerRows = yield* sql.unsafe<StoredImplementationBlockerRow>(
      `SELECT ${implementationBlockerReadColumns}
       FROM implementation_blockers WHERE change_id = ? ORDER BY id`,
      [internalChangeId(candidate.changeId, idPrefix)],
    );
    const blockerHistory = yield* decodePersisted(operationName, () =>
      decodeImplementationBlockerHistory(blockerRows, candidate.changeId, idPrefix),
    );
    if (blockerHistory.active !== null) {
      return { reused: false, blocked: true } satisfies StartCandidateValidationRunResult;
    }
    const latestRows = yield* sql.unsafe<StoredValidationRunRow>(
      `SELECT ${validationRunReadColumns}
       FROM validation_runs WHERE candidate_id = ? ORDER BY id DESC LIMIT 1`,
      [candidate.id],
    );
    const latest = latestRows[0];
    if (latest?.outcome === "passed") {
      const decoded = yield* readValidationRunById(sql, latest.id, operationName, idPrefix);
      if (
        decoded === undefined ||
        decoded.candidateId !== candidate.id ||
        decoded.outcome !== "passed"
      ) {
        return yield* invalidData(
          operationName,
          "Reusable Validation Run does not match its Candidate and passing outcome",
        );
      }
      const currentHighestBlockerId = latestResolvedBlockerId(blockerHistory);
      if (
        isValidationRunEligibleForCurrentChangeAuthority({
          hasAcceptanceContext: changeAuthority.acceptanceContext !== null,
          runHighestBlockerId: latest.highestBlockerId,
          currentHighestBlockerId,
        })
      ) {
        return {
          reused: true,
          validationRunId: decoded.id,
          outcome: "passed",
        } satisfies StartCandidateValidationRunResult;
      }
    }

    const decisionRows = yield* sql<StoredImplementationDecisionRow>`
      SELECT id, change_id AS changeId, choice, rationale
      FROM implementation_decisions
      WHERE change_id = ${internalChangeId(candidate.changeId, idPrefix)}
      ORDER BY id
    `;
    const implementationDecisions = yield* decodePersisted(operationName, () =>
      decodeImplementationDecisions(decisionRows, candidate.changeId, idPrefix),
    );
    const highestDecisionId = implementationDecisions.at(-1)?.id ?? null;
    const highestBlockerId = blockerHistory.blockers.at(-1)?.id ?? null;
    const acceptanceContext = deriveAcceptanceContext(
      changeAuthority.acceptanceContext,
      blockerHistory,
    );
    const validationInput = {
      ...(acceptanceContext === null ? {} : { acceptanceContext }),
    };
    const validationInputSnapshot = yield* Effect.try({
      try: () => encodeSqliteValidationInputSnapshot(validationInput),
      catch: (cause) => new RepositoryPersistedDataInvalid({ operationName, cause }),
    });

    const inserted = yield* sql<{ readonly id: number }>`
      INSERT INTO validation_runs (
        candidate_id, validation_input_snapshot, highest_decision_id, highest_blocker_id,
        outcome, run_tooling_failure, cleanup_pending, cleanup_blocking_reason
      ) VALUES (
        ${candidate.id}, ${validationInputSnapshot}, ${highestDecisionId}, ${highestBlockerId},
        NULL, NULL, 1, NULL
      )
      RETURNING id
    `;
    const validationRunId = inserted[0]?.id;
    if (validationRunId === undefined) {
      return yield* invalidData(operationName, "Validation Run identity was not allocated");
    }
    const executionAuthority = yield* readValidationExecutionAuthorityById(
      sql,
      validationRunId,
      operationName,
      idPrefix,
    );
    if (executionAuthority === undefined) {
      return yield* invalidData(operationName, "Validation Run disappeared after creation");
    }
    return {
      reused: false,
      validationRunId,
      authority: {
        candidate,
        changePolicy: executionAuthority.changePolicy,
        validationInput: executionAuthority.run.validationInput,
        implementationDecisions,
        blockerHistory,
      },
    } satisfies StartCandidateValidationRunResult;
  });

const complete = (
  sql: SqlClient.SqlClient,
  input: {
    readonly validationRunId: number;
    readonly outcome: "passed" | "blocked" | "tooling_failed";
  },
  idPrefix: string,
) =>
  Effect.gen(function* () {
    const operationName = "complete Candidate Validation Run";
    yield* requireCoherentValidationCompletion(
      sql,
      input.validationRunId,
      input.outcome,
      operationName,
      idPrefix,
    );
    const updated = yield* sql<{ readonly id: number }>`
      UPDATE validation_runs SET outcome = ${input.outcome}
      WHERE id = ${input.validationRunId} AND outcome IS NULL AND cleanup_pending = 0
      RETURNING id
    `;
    if (updated[0]?.id !== input.validationRunId) {
      return yield* invalidData(
        operationName,
        "Validation Run cannot complete before cleanup succeeds.",
      );
    }
  }).pipe(Effect.asVoid);

const recordWorkspaceCleanup = (
  sql: SqlClient.SqlClient,
  validationRunId: number,
  cleanupWorkspace: "removed" | "not_created" | "failed",
  cleanupBlockingReason?: string,
) =>
  Effect.gen(function* () {
    const pending = cleanupWorkspace === "failed" ? 1 : 0;
    const reason =
      cleanupWorkspace === "failed"
        ? (cleanupBlockingReason ?? "Snapshot Workspace cleanup failed.")
        : null;
    const updated = yield* sql<{ readonly id: number }>`
      UPDATE validation_runs
      SET cleanup_pending = ${pending}, cleanup_blocking_reason = ${reason}
      WHERE id = ${validationRunId} AND outcome IS NULL
      RETURNING id
    `;
    if (updated[0]?.id !== validationRunId) {
      return yield* invalidData("record Validation Run cleanup", "Validation Run was not active");
    }
  }).pipe(Effect.asVoid);

const recordPhaseResult = (
  sql: SqlClient.SqlClient,
  input: RecordCandidateValidationPhaseResultInput,
  idPrefix: string,
  operationName = "record Candidate Validation Phase Result",
) =>
  Effect.gen(function* () {
    yield* requireValidationPosition(sql, {
      validationRunId: input.validationRunId,
      phase: input.phase,
      producer: input.producer,
      operationName,
      idPrefix,
      active: true,
    });
    const findings = input.findings ?? (input.finding === undefined ? [] : [input.finding]);
    if (
      findings.some(
        (finding) =>
          finding.validationRunId !== input.validationRunId ||
          finding.phase !== input.phase ||
          finding.producer !== input.producer,
      ) ||
      input.artifactRecords.some(
        (artifact) =>
          artifact.validationRunId !== input.validationRunId ||
          artifact.phase !== input.phase ||
          artifact.producer !== input.producer,
      ) ||
      (input.toolingFailure !== undefined &&
        input.toolingFailure.validationRunId !== input.validationRunId)
    ) {
      return yield* invalidData(operationName, "Validation evidence does not match its position");
    }
    yield* Effect.try({
      try: () => {
        for (const artifact of input.artifactRecords) {
          assertValidationArtifactRecord(artifact);
        }
        if (input.toolingFailure !== undefined) {
          assertValidationToolingFailureEvidence(toolingFailureValue(input.toolingFailure));
        }
      },
      catch: (cause) => new RepositoryPersistedDataInvalid({ operationName, cause }),
    });
    const persistedArtifacts = yield* listValidationArtifacts(sql, input.validationRunId, idPrefix);
    const availableArtifactRefs = new Set([
      ...persistedArtifacts.map((artifact) => artifact.ref),
      ...input.artifactRecords.map((artifact) => artifact.ref),
    ]);
    yield* Effect.try({
      try: () => {
        for (const finding of findings) {
          assertValidationFindingEvidence(finding, availableArtifactRefs);
        }
      },
      catch: (cause) => new RepositoryPersistedDataInvalid({ operationName, cause }),
    });
    const artifacts = input.artifactRecords.map((artifact) => ({
      path: artifact.path,
      originalBytes: artifact.originalBytes,
      storedBytes: artifact.storedBytes,
    }));
    yield* sql`
      INSERT INTO validation_phase_results (
        validation_run_id, phase, producer, outcome, findings, artifacts, tooling_failure
      ) VALUES (
        ${input.validationRunId}, ${input.phase}, ${input.producer}, ${input.outcome},
        ${JSON.stringify(findings.map(findingValue))}, ${JSON.stringify(artifacts)},
        ${input.toolingFailure === undefined ? null : JSON.stringify(toolingFailureValue(input.toolingFailure))}
      )
    `;
  }).pipe(Effect.asVoid);

const requirePreDispatchReviewerIntegrityFailure = (
  sql: SqlClient.SqlClient,
  input: Pick<
    RecordCandidateValidationPhaseResultInput,
    "validationRunId" | "outcome" | "findings" | "artifactRecords" | "toolingFailure"
  >,
  phase: typeof validationPhase.acceptanceReview | typeof validationPhase.specialistReview,
  producer: string,
  operationName: string,
) =>
  Effect.gen(function* () {
    const linked = yield* sql<{ readonly count: number }>`
    SELECT COUNT(*) AS count
    FROM validation_phase_agent_invocations
    WHERE validation_run_id = ${input.validationRunId}
      AND phase = ${phase}
      AND producer = ${producer}
  `;
    const failure = input.toolingFailure;
    const expectedInfrastructureOperation =
      phase === validationPhase.acceptanceReview
        ? "verify_acceptance_candidate"
        : "verify_specialist_candidate";
    const isIntegrityFailure =
      failure !== undefined &&
      ((failure.errorKind === "git_tooling_failed" &&
        failure.operationName === "verify_candidate_head") ||
        (failure.errorKind === "infrastructure_tooling_failed" &&
          failure.operationName === expectedInfrastructureOperation));
    if (
      (linked[0]?.count ?? 0) > 0 ||
      input.outcome !== "failed" ||
      (input.findings ?? []).length !== 0 ||
      input.artifactRecords.length !== 0 ||
      !isIntegrityFailure
    ) {
      return yield* invalidData(
        operationName,
        "A direct reviewer Result requires pre-dispatch Candidate integrity failure evidence",
      );
    }
  }).pipe(Effect.asVoid);

const listRunsForChange = (sql: SqlClient.SqlClient, changeId: string, idPrefix: string) =>
  Effect.gen(function* () {
    const selected = yield* sql<{ readonly id: number }>`
      SELECT run.id
      FROM validation_runs AS run
      JOIN candidates AS candidate ON candidate.id = run.candidate_id
      WHERE candidate.change_id = ${internalChangeId(changeId, idPrefix)}
      ORDER BY run.id
    `;
    return yield* Effect.forEach(selected, ({ id }) =>
      readValidationRunById(sql, id, "decode Change Validation Run", idPrefix).pipe(
        Effect.flatMap((run) => {
          if (run === undefined) {
            return invalidData(
              "decode Change Validation Run",
              "Validation Run history contains an unknown Run",
            );
          }
          return Effect.succeed(run);
        }),
      ),
    );
  });

const listPreviousCandidateReviewerFindings = (
  sql: SqlClient.SqlClient,
  input: {
    readonly candidateId: number;
    readonly phase: CandidateValidationFinding["phase"];
    readonly producer: string;
  },
  idPrefix: string,
) =>
  Effect.gen(function* () {
    const current = yield* readCandidateById(
      sql,
      input.candidateId,
      "list previous Candidate reviewer Findings",
      idPrefix,
    );
    if (current === undefined) return [];
    const rows = yield* sql<{
      readonly candidateId: number;
      readonly validationRunId: number;
      readonly findings: string;
    }>`
      SELECT candidate.id AS candidateId, result.validation_run_id AS validationRunId,
        result.findings
      FROM candidates AS candidate
      JOIN validation_runs AS run ON run.candidate_id = candidate.id
      JOIN validation_phase_results AS result ON result.validation_run_id = run.id
      WHERE candidate.change_id = ${internalChangeId(current.changeId, idPrefix)}
        AND candidate.id < ${current.id}
        AND result.phase = ${input.phase} AND result.producer = ${input.producer}
      ORDER BY candidate.id DESC, run.id DESC
      LIMIT 1
    `;
    const selected = rows[0];
    if (selected === undefined) return [];
    const candidate = yield* readCandidateById(
      sql,
      selected.candidateId,
      "list previous Candidate reviewer Findings",
      idPrefix,
    );
    if (
      candidate === undefined ||
      candidate.changeId !== current.changeId ||
      compareCandidatesAscending(candidate, current) >= 0
    ) {
      return yield* invalidData(
        "list previous Candidate reviewer Findings",
        "Selected reviewer history belongs to an unrelated Candidate",
      );
    }
    const artifacts = yield* listValidationArtifacts(sql, selected.validationRunId, idPrefix);
    const availableArtifactRefs = new Set(artifacts.map((artifact) => artifact.ref));
    return yield* decodePersisted("list previous Candidate reviewer Findings", () => {
      const value: unknown = JSON.parse(selected.findings) as unknown;
      if (!Array.isArray(value)) throw new Error("Stored Findings are not an array");
      return value.map((item) => {
        const finding = {
          ...decodeValidationFindingEvidence(item, availableArtifactRefs),
          validationRunId: selected.validationRunId,
          phase: input.phase,
          producer: input.producer,
        } satisfies CandidateValidationFinding;
        assertValidationFindingEvidence(finding, availableArtifactRefs);
        return finding;
      });
    });
  });

const findingValue = (finding: CandidateValidationFinding) => ({
  title: finding.title,
  description: finding.description,
  evidence: finding.evidence,
  files: finding.files,
  artifactRefs: finding.artifactRefs,
});
const toolingFailureValue = (failure: {
  readonly errorKind: string;
  readonly operationName: string;
  readonly errorMessage: string;
}) => ({
  errorKind: failure.errorKind,
  operationName: failure.operationName,
  errorMessage: failure.errorMessage,
});
const requireValidToolingFailure = (
  failure: Parameters<typeof assertValidationToolingFailureEvidence>[0],
  operationName: string,
) =>
  Effect.try({
    try: () => assertValidationToolingFailureEvidence(failure),
    catch: (cause) => new RepositoryPersistedDataInvalid({ operationName, cause }),
  });
const invalidData = (operationName: string, message: string) =>
  Effect.fail(new RepositoryPersistedDataInvalid({ operationName, cause: new Error(message) }));
