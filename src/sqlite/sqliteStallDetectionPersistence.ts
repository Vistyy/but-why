import type * as SqlClient from "@effect/sql/SqlClient";
import { Effect } from "effect";
import { internalChangeId, publicChangeId } from "../change/changeId.js";
import {
  type StallDetectionAssessmentInput,
  type StallDetectionPersistence,
  toStallDetectionFinding,
} from "../change/stallDetection.js";
import { deriveAcceptanceContext } from "../change/validationRun/acceptanceContextSnapshot.js";
import { RepositoryPersistedDataInvalid } from "../contracts/repositoryStorageError.js";
import { RepositorySql } from "../repositoryRuntime/adapters/sqlite/repositorySql.js";
import { decodePersisted } from "../repositoryRuntime/adapters/sqlite/sqlitePersistedData.js";
import { decodeSqliteAcceptanceContextSnapshot } from "./sqliteAcceptanceContextSnapshot.js";
import {
  decodeImplementationBlockerHistory,
  implementationBlockerReadColumns,
  type StoredImplementationBlockerRow,
} from "./sqliteChangeAuthorityHistory.js";
import { listValidationFindings } from "./sqliteValidationEvidenceStorage.js";

export const openSqliteStallDetectionPersistence = () =>
  Effect.map(
    RepositorySql,
    (repository): StallDetectionPersistence => ({
      getAssessmentInput: (changeId, validationRunId) =>
        repository.transaction("read Stall Detection input", (sql) =>
          getAssessmentInput(sql, changeId, validationRunId, repository.idPrefix),
        ),
      getByValidationRun: (validationRunId) =>
        repository.transaction("read Stall Detection", (sql) =>
          readStallDetection(sql, validationRunId, repository.idPrefix),
        ),
      listForChange: (changeId) =>
        repository.transaction("list Stall Detections", (sql) =>
          listForChange(sql, changeId, repository.idPrefix),
        ),
      record: (input) =>
        repository.transactionImmediate("record Stall Detection", (sql) =>
          recordStallDetection(sql, input, repository.idPrefix),
        ),
    }),
  );

const getAssessmentInput = (
  sql: SqlClient.SqlClient,
  changeId: string,
  validationRunId: number,
  idPrefix: string,
) =>
  Effect.gen(function* () {
    const changeRows = yield* sql<{
      readonly id: number;
      readonly acceptanceContext: string | null;
    }>`
      SELECT id, initial_acceptance_context AS acceptanceContext
      FROM changes
      WHERE id = ${internalChangeId(changeId, idPrefix)}
    `;
    const change = changeRows[0];
    if (change === undefined || publicChangeId(idPrefix, change.id) !== changeId) return undefined;
    if (change.acceptanceContext === null) return undefined;

    const triggerRows = yield* sql<{
      readonly candidateId: number;
      readonly outcome: string | null;
    }>`
      SELECT candidate_id AS candidateId, outcome
      FROM validation_runs
      WHERE id = ${validationRunId}
    `;
    const trigger = triggerRows[0];
    if (trigger?.outcome !== "blocked") return undefined;
    const triggerChangeRows = yield* sql<{ readonly changeId: number }>`
      SELECT change_id AS changeId FROM candidates WHERE id = ${trigger.candidateId}
    `;
    if (triggerChangeRows[0]?.changeId !== change.id) return undefined;

    const passedRows = yield* sql<{ readonly id: number }>`
      SELECT run.id
      FROM validation_runs AS run
      JOIN candidates AS candidate ON candidate.id = run.candidate_id
      WHERE candidate.change_id = ${change.id}
        AND run.outcome = 'passed'
        AND run.id < ${validationRunId}
      ORDER BY run.id DESC
      LIMIT 1
    `;
    const passId = passedRows[0]?.id ?? 0;
    const runRows = yield* sql<{ readonly id: number; readonly outcome: string | null }>`
      SELECT run.id, run.outcome
      FROM validation_runs AS run
      JOIN candidates AS candidate ON candidate.id = run.candidate_id
      WHERE candidate.change_id = ${change.id}
        AND run.id > ${passId}
        AND run.id <= ${validationRunId}
      ORDER BY run.id
    `;

    const qualifyingRuns: Array<StallDetectionAssessmentInput["qualifyingRuns"][number]> = [];
    let triggerQualifies = false;
    for (const run of runRows) {
      if (run.outcome !== "blocked") continue;
      const findings = yield* listValidationFindings(sql, run.id, idPrefix);
      const reviewerFindings = findings
        .filter(
          (finding) =>
            finding.phase === "acceptance_review" || finding.phase === "specialist_review",
        )
        .map(toStallDetectionFinding);
      if (reviewerFindings.length > 0) {
        qualifyingRuns.push({ findings: reviewerFindings });
        if (run.id === validationRunId) triggerQualifies = true;
      }
    }
    if (!triggerQualifies || qualifyingRuns.length < 3) return undefined;

    const currentBlockers = yield* sql.unsafe<StoredImplementationBlockerRow>(
      `SELECT ${implementationBlockerReadColumns}
       FROM implementation_blockers
       WHERE change_id = ?
       ORDER BY id`,
      [change.id],
    );
    const blockerHistory = yield* decodePersisted("read Stall Detection input", () =>
      decodeImplementationBlockerHistory(currentBlockers, changeId, idPrefix),
    );
    const acceptanceContext = deriveAcceptanceContext(
      decodeSqliteAcceptanceContextSnapshot(change.acceptanceContext),
      blockerHistory,
    );
    if (acceptanceContext === null) return undefined;
    return { acceptanceContext, qualifyingRuns } satisfies StallDetectionAssessmentInput;
  });

const listForChange = (sql: SqlClient.SqlClient, changeId: string, idPrefix: string) =>
  Effect.gen(function* () {
    const rows = yield* sql<{ readonly validationRunId: number }>`
      SELECT detection.validation_run_id AS validationRunId
      FROM stall_detections AS detection
      JOIN validation_runs AS run ON run.id = detection.validation_run_id
      JOIN candidates AS candidate ON candidate.id = run.candidate_id
      JOIN changes AS change ON change.id = candidate.change_id
      WHERE change.id = ${internalChangeId(changeId, idPrefix)}
      ORDER BY detection.id
    `;
    return yield* Effect.forEach(rows, ({ validationRunId }) =>
      readStallDetection(sql, validationRunId, idPrefix).pipe(
        Effect.flatMap((record) =>
          record === undefined
            ? invalid("list Stall Detections", "Stall Detection disappeared")
            : Effect.succeed(record),
        ),
      ),
    );
  });

const recordStallDetection = (
  sql: SqlClient.SqlClient,
  input: Parameters<StallDetectionPersistence["record"]>[0],
  idPrefix: string,
) =>
  Effect.gen(function* () {
    const existing = yield* readStallDetection(sql, input.validationRunId, idPrefix);
    if (existing !== undefined) return existing;

    const runRows = yield* sql<{ readonly changeId: number }>`
      SELECT candidate.change_id AS changeId
      FROM validation_runs AS run
      JOIN candidates AS candidate ON candidate.id = run.candidate_id
      WHERE run.id = ${input.validationRunId}
    `;
    const changeId = runRows[0]?.changeId;
    if (changeId === undefined) {
      return yield* invalid("record Stall Detection", "Validation Run has no Change");
    }
    const inserted = yield* sql<{ readonly id: number }>`
      INSERT INTO stall_detections (validation_run_id, agent_session_id, decision, reason)
      VALUES (
        ${input.validationRunId}, ${input.agentSessionId},
        ${input.assessment.decision}, ${input.assessment.reason}
      )
      RETURNING id
    `;
    const detectionId = inserted[0]?.id;
    if (detectionId === undefined) {
      return yield* invalid("record Stall Detection", "Identity was not allocated");
    }
    if (input.assessment.decision === "stop") {
      yield* sql`
        INSERT INTO implementation_blockers (
          change_id, content, resolution_content, source_type, source_id
        ) VALUES (
          ${changeId}, ${input.assessment.reason}, NULL, 'stall_detection', ${detectionId}
        )
      `;
    }
    const record = yield* readStallDetection(sql, input.validationRunId, idPrefix);
    return record === undefined
      ? yield* invalid("record Stall Detection", "Detection disappeared")
      : record;
  });

const readStallDetection = (sql: SqlClient.SqlClient, validationRunId: number, idPrefix: string) =>
  Effect.gen(function* () {
    const rows = yield* sql<{
      readonly id: number;
      readonly validationRunId: number;
      readonly agentSessionId: number;
      readonly decision: string;
      readonly reason: string;
      readonly changeId: number;
    }>`
      SELECT detection.id, detection.validation_run_id AS validationRunId,
        detection.agent_session_id AS agentSessionId, detection.decision, detection.reason,
        candidate.change_id AS changeId
      FROM stall_detections AS detection
      JOIN validation_runs AS run ON run.id = detection.validation_run_id
      JOIN candidates AS candidate ON candidate.id = run.candidate_id
      WHERE detection.validation_run_id = ${validationRunId}
    `;
    const row = rows[0];
    if (row === undefined) return undefined;
    const blockerRows = yield* sql<{ readonly id: number; readonly changeId: number }>`
      SELECT id, change_id AS changeId
      FROM implementation_blockers
      WHERE source_type = 'stall_detection' AND source_id = ${row.id}
    `;
    return yield* decodePersisted("read Stall Detection", () => {
      if (publicChangeId(idPrefix, row.changeId).length === 0) {
        throw new Error("Invalid Change identity");
      }
      if (row.decision !== "continue" && row.decision !== "stop") {
        throw new Error("Invalid Stall Detection decision");
      }
      if (
        (row.decision === "stop" && blockerRows.length !== 1) ||
        (row.decision === "continue" && blockerRows.length !== 0) ||
        blockerRows.some((blocker) => blocker.changeId !== row.changeId)
      ) {
        throw new Error("Stall Detection and sourced Blocker pairing is invalid");
      }
      return {
        id: row.id,
        validationRunId: row.validationRunId,
        agentSessionId: row.agentSessionId,
        decision: row.decision as "continue" | "stop",
        reason: row.reason,
        blockerId: blockerRows[0]?.id ?? null,
      };
    });
  });

const invalid = (operationName: string, message: string) =>
  Effect.fail(new RepositoryPersistedDataInvalid({ operationName, cause: new Error(message) }));
