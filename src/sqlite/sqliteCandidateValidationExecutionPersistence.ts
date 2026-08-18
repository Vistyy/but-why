import type * as SqlClient from "@effect/sql/SqlClient";
import { Effect } from "effect";

import type {
  CandidateValidationFinding,
  RecordCandidateValidationPhaseResultInput,
  StartCandidateValidationRunInput,
  StartCandidateValidationRunResult,
} from "../change/candidateValidation/candidateValidationRunStore.js";
import { internalChangeId, publicChangeId } from "../change/changeId.js";
import type { CandidateValidationExecutionPort } from "../change/validation/changeValidationPorts.js";
import { validationPhase } from "../change/validationRun/validationRun.js";
import { RepositoryPersistedDataInvalid } from "../contracts/repositoryStorageError.js";
import { RepositorySql } from "./repositorySql.js";
import { decodeSqliteAcceptanceContextSnapshot } from "./sqliteAcceptanceContextSnapshot.js";
import {
  compareCandidatesAscending,
  readCandidateById,
  readCurrentCandidateForChange,
} from "./sqliteCandidateStorage.js";
import { encodeSqliteCandidateValidationPolicy } from "./sqliteCandidateValidationPolicy.js";
import {
  decodeImplementationBlockerHistory,
  decodeImplementationDecisions,
  implementationBlockerReadColumns,
  type StoredImplementationBlockerRow,
  type StoredImplementationDecisionRow,
} from "./sqliteChangeAuthorityHistory.js";
import { deriveAcceptanceContext, latestResolvedBlockerId } from "./sqliteChangeReadModel.js";
import { decodePersisted } from "./sqliteTaskReadModel.js";
import {
  listValidationArtifacts,
  listValidationFindings,
  listValidationPhaseResults,
  listValidationToolingFailures,
} from "./sqliteValidationEvidenceStorage.js";
import {
  readActiveValidationRunForChange,
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
          complete(sql, input),
        ),
      recordWorkspaceCleanup: (input) =>
        repository.transactionImmediate("record Validation Run cleanup", (sql) =>
          recordWorkspaceCleanup(sql, input.validationRunId, input.cleanupWorkspace),
        ),
      recordToolingFailure: (input) =>
        repository.transactionImmediate("record Candidate validation Tooling Failure", (sql) =>
          Effect.asVoid(sql`
            UPDATE validation_runs
            SET run_tooling_failure = ${JSON.stringify(toolingFailureValue(input))}
            WHERE id = ${input.validationRunId} AND outcome IS NULL
          `),
        ),
      recordPrepareResult: (input) =>
        repository.transactionImmediate("record Candidate validation Prepare Result", (sql) =>
          recordPhaseResult(sql, { ...input, phase: validationPhase.prepare, producer: "prepare" }),
        ),
      recordCheckResult: (input) =>
        repository.transactionImmediate("record Candidate validation Check Result", (sql) =>
          recordPhaseResult(sql, { ...input, phase: validationPhase.checks }),
        ),
      recordAcceptanceResult: (input) =>
        repository.transactionImmediate("record Candidate Acceptance Review Result", (sql) =>
          recordPhaseResult(sql, {
            ...input,
            phase: validationPhase.acceptanceReview,
            producer: "acceptance",
          }),
        ),
      recordSpecialistResult: (input) =>
        repository.transactionImmediate("record Candidate Specialist Review Result", (sql) =>
          recordPhaseResult(sql, { ...input, phase: validationPhase.specialistReview }),
        ),
      settleAgentInvocationResult: (input) => (sql) =>
        recordPhaseResult(sql, {
          validationRunId: input.validationRunId,
          phase: input.phase,
          producer: input.producer,
          outcome: input.outcome,
          artifactRecords: input.artifactRecords,
          findings: input.findings,
          ...(input.toolingFailure === undefined ? {} : { toolingFailure: input.toolingFailure }),
          now: input.now,
        }),
      listPhaseResults: (validationRunId) =>
        repository.transaction("list Validation Phase Results", (sql) =>
          listValidationPhaseResults(sql, validationRunId, repository.idPrefix),
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
    const decisionRows = yield* sql<StoredImplementationDecisionRow>`
      SELECT id, change_id AS changeId, choice, rationale
      FROM implementation_decisions
      WHERE change_id = ${internalChangeId(candidate.changeId, idPrefix)}
      ORDER BY id
    `;
    const implementationDecisions = yield* decodePersisted(operationName, () =>
      decodeImplementationDecisions(decisionRows, candidate.changeId, idPrefix),
    );
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
    const highestDecisionId = implementationDecisions.at(-1)?.id ?? null;
    const highestBlockerId = blockerHistory.blockers.at(-1)?.id ?? null;
    const acceptanceContext = deriveAcceptanceContext(
      changeAuthority.acceptanceContext,
      blockerHistory,
    );
    const policy = {
      ...input.policy,
      ...(acceptanceContext === null ? {} : { acceptanceContext }),
    };
    const policySnapshot = yield* Effect.try({
      try: () => encodeSqliteCandidateValidationPolicy(policy),
      catch: (cause) => new RepositoryPersistedDataInvalid({ operationName, cause }),
    });
    const authority = {
      candidate,
      policy,
      implementationDecisions,
      blockerHistory,
      latestResolvedBlockerId: latestResolvedBlockerId(blockerHistory),
    };

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
      return {
        reused: true,
        validationRunId: decoded.id,
        outcome: "passed",
        authority,
      } satisfies StartCandidateValidationRunResult;
    }

    const inserted = yield* sql<{ readonly id: number }>`
      INSERT INTO validation_runs (
        candidate_id, policy_snapshot, highest_decision_id, highest_blocker_id,
        outcome, run_tooling_failure, cleanup_pending, cleanup_blocking_reason
      ) VALUES (
        ${candidate.id}, ${policySnapshot}, ${highestDecisionId}, ${highestBlockerId},
        NULL, NULL, 1, NULL
      )
      RETURNING id
    `;
    const validationRunId = inserted[0]?.id;
    if (validationRunId === undefined) {
      return yield* invalidData(operationName, "Validation Run identity was not allocated");
    }
    return {
      reused: false,
      validationRunId,
      authority,
    } satisfies StartCandidateValidationRunResult;
  });

const complete = (
  sql: SqlClient.SqlClient,
  input: { readonly validationRunId: number; readonly outcome: string; readonly now: string },
) =>
  Effect.gen(function* () {
    const updated = yield* sql<{ readonly id: number }>`
      UPDATE validation_runs SET outcome = ${input.outcome}
      WHERE id = ${input.validationRunId} AND outcome IS NULL AND cleanup_pending = 0
      RETURNING id
    `;
    if (updated[0]?.id !== input.validationRunId) {
      return yield* invalidData(
        "complete Candidate Validation Run",
        "Validation Run cannot complete before cleanup succeeds.",
      );
    }
  }).pipe(Effect.asVoid);

const recordWorkspaceCleanup = (
  sql: SqlClient.SqlClient,
  validationRunId: number,
  cleanupWorkspace: "removed" | "not_created" | "failed",
) =>
  Effect.gen(function* () {
    const pending = cleanupWorkspace === "failed" ? 1 : 0;
    const reason = cleanupWorkspace === "failed" ? "Snapshot Workspace cleanup failed." : null;
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
) => {
  const findings = input.findings ?? (input.finding === undefined ? [] : [input.finding]);
  const artifacts = input.artifactRecords.map((artifact) => ({
    path: artifact.path,
    originalBytes: artifact.originalBytes,
    storedBytes: artifact.storedBytes,
  }));
  return Effect.asVoid(sql`
    INSERT INTO validation_phase_results (
      validation_run_id, phase, producer, outcome, findings, artifacts, tooling_failure
    ) VALUES (
      ${input.validationRunId}, ${input.phase}, ${input.producer}, ${input.outcome},
      ${JSON.stringify(findings.map(findingValue))}, ${JSON.stringify(artifacts)},
      ${input.toolingFailure === undefined ? null : JSON.stringify(toolingFailureValue(input.toolingFailure))}
    )
  `);
};

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
    return yield* decodePersisted("list previous Candidate reviewer Findings", () => {
      const value: unknown = JSON.parse(selected.findings) as unknown;
      if (!Array.isArray(value)) throw new Error("Stored Findings are not an array");
      return value.map((item) => {
        if (typeof item !== "object" || item === null || Array.isArray(item)) {
          throw new Error("Stored Finding is invalid");
        }
        const finding = item as Record<string, unknown>;
        const field = (name: string) => finding[name];
        return {
          validationRunId: selected.validationRunId,
          phase: input.phase,
          producer: input.producer,
          title: requiredString(field("title")),
          description: requiredString(field("description")),
          evidence: requiredString(field("evidence")),
          files: requiredStringArray(field("files")),
          artifactRefs: requiredStringArray(field("artifactRefs")),
        } satisfies CandidateValidationFinding;
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
const requiredString = (value: unknown): string => {
  if (typeof value !== "string") throw new Error("Stored Finding field is invalid");
  return value;
};
const requiredStringArray = (value: unknown): readonly string[] => {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error("Stored Finding string array is invalid");
  }
  return value as readonly string[];
};
const invalidData = (operationName: string, message: string) =>
  Effect.fail(new RepositoryPersistedDataInvalid({ operationName, cause: new Error(message) }));
