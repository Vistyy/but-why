import type * as SqlClient from "@effect/sql/SqlClient";
import { Effect, Schema } from "effect";
import { resolvedReviewerPiAgentProfileSchema } from "../agent/agentProfiles.js";
import type { AgentInvocationPersistenceRow } from "../agent/agentSession/agentInvocationPersistenceCodec.js";
import { decodeAgentInvocation } from "../agent/agentSession/agentInvocationPersistenceCodec.js";
import { internalChangeId, publicChangeId } from "../change/changeId.js";
import type {
  StallDetectionAssessmentInput,
  StallDetectionPersistence,
} from "../change/stallDetection.js";
import {
  type AcceptanceContextSnapshotV1,
  acceptanceContextSnapshotSchema,
  deriveAcceptanceContext,
} from "../change/validationRun/acceptanceContextSnapshot.js";
import type { ValidationRunFindingRecord } from "../change/validationRun/validationRun.js";
import { RepositoryPersistedDataInvalid } from "../contracts/repositoryStorageError.js";
import { RepositorySql } from "../repositoryRuntime/adapters/sqlite/repositorySql.js";
import { decodePersisted } from "../repositoryRuntime/adapters/sqlite/sqlitePersistedData.js";
import { decodeSqliteAcceptanceContextSnapshot } from "./sqliteAcceptanceContextSnapshot.js";
import {
  decodeImplementationBlockerHistory,
  implementationBlockerReadColumns,
  readImplementationBlockerPrefix,
  type StoredImplementationBlockerRow,
} from "./sqliteChangeAuthorityHistory.js";
import { listValidationFindings } from "./sqliteValidationEvidenceStorage.js";

export const openSqliteStallDetectionPersistence = () =>
  Effect.map(
    RepositorySql,
    (repository): StallDetectionPersistence => ({
      linkInvocation: (validationRunId) => (sql, invocationId) =>
        sql`
          INSERT INTO stall_detection_run_invocations (validation_run_id, agent_invocation_id)
          VALUES (${validationRunId}, ${invocationId})
        `.pipe(Effect.asVoid),
      getAttemptByValidationRun: (validationRunId) =>
        repository.transaction("read Stall Detection attempt", (sql) =>
          getAttemptByValidationRun(sql, validationRunId),
        ),
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
      recordAttempt: (input) =>
        repository.transactionImmediate("record Stall Detection attempt", (sql) =>
          recordStallDetectionAttempt(sql, input, repository.idPrefix),
        ),
      record: (input) =>
        repository.transactionImmediate("record Stall Detection", (sql) =>
          recordStallDetection(sql, input, repository.idPrefix),
        ),
    }),
  );

const getAttemptByValidationRun = (sql: SqlClient.SqlClient, validationRunId: number) =>
  Effect.gen(function* () {
    const rows = yield* sql<{ readonly diagnostic: string }>`
      SELECT diagnostic FROM stall_detection_attempts
      WHERE validation_run_id = ${validationRunId}
    `;
    const diagnostic = rows[0]?.diagnostic;
    return diagnostic === undefined
      ? undefined
      : ({ code: "stall_detection_unavailable", message: diagnostic } as const);
  });

const listForChange = (sql: SqlClient.SqlClient, changeId: string, idPrefix: string) =>
  Effect.gen(function* () {
    const rows = yield* sql<{ readonly validationRunId: number }>`
      SELECT validation_run_id AS validationRunId FROM stall_detections
      WHERE change_id = ${internalChangeId(changeId, idPrefix)} ORDER BY id
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
      FROM changes WHERE id = ${internalChangeId(changeId, idPrefix)}
    `;
    const change = changeRows[0];
    if (change === undefined || publicChangeId(idPrefix, change.id) !== changeId) return undefined;
    if (change.acceptanceContext === null) return undefined;

    const runRows = yield* sql<{
      readonly candidateId: number;
      readonly outcome: string | null;
      readonly highestBlockerId: number | null;
    }>`
      SELECT run.candidate_id AS candidateId, run.outcome, run.highest_blocker_id AS highestBlockerId
      FROM validation_runs AS run WHERE run.id = ${validationRunId}
    `;
    const trigger = runRows[0];
    if (trigger?.outcome !== "blocked") return undefined;
    const candidateRows = yield* sql<{ readonly changeId: number }>`
      SELECT change_id AS changeId FROM candidates WHERE id = ${trigger.candidateId}
    `;
    if (candidateRows[0]?.changeId !== change.id) return undefined;

    const passed = yield* sql<{ readonly id: number; readonly highestBlockerId: number | null }>`
      SELECT run.id, run.highest_blocker_id AS highestBlockerId
      FROM validation_runs AS run
      JOIN candidates AS candidate ON candidate.id = run.candidate_id
      WHERE candidate.change_id = ${change.id} AND run.outcome = 'passed' AND run.id < ${validationRunId}
      ORDER BY run.id DESC LIMIT 1
    `;
    const passId = passed[0]?.id ?? 0;
    const rows = yield* sql<{
      readonly id: number;
      readonly candidateId: number;
      readonly outcome: string | null;
      readonly highestBlockerId: number | null;
    }>`
      SELECT run.id, run.candidate_id AS candidateId, run.outcome,
        run.highest_blocker_id AS highestBlockerId
      FROM validation_runs AS run
      JOIN candidates AS candidate ON candidate.id = run.candidate_id
      WHERE candidate.change_id = ${change.id} AND run.id > ${passId} AND run.id <= ${validationRunId}
      ORDER BY run.id
    `;
    const qualifying: {
      readonly validationRunId: number;
      readonly acceptanceContext: AcceptanceContextSnapshotV1 | null;
      readonly resolutionPrefix: readonly string[];
      readonly findings: readonly ValidationRunFindingRecord[];
    }[] = [];
    for (const row of rows) {
      if (row.outcome !== "blocked") continue;
      const findings = yield* listValidationFindings(sql, row.id, idPrefix);
      const reviewerFindings = findings.filter(
        (finding) => finding.phase === "acceptance_review" || finding.phase === "specialist_review",
      );
      if (reviewerFindings.length === 0) continue;
      const prefixes = yield* readImplementationBlockerPrefix(
        sql,
        changeId,
        row.highestBlockerId,
        "read Stall Detection input",
        idPrefix,
      );
      const contextRows = yield* sql<{ readonly snapshot: string }>`
        SELECT validation_input_snapshot AS snapshot FROM validation_runs WHERE id = ${row.id}
      `;
      const context = yield* decodePersisted("read Stall Detection input", () => {
        const value: unknown = JSON.parse(contextRows[0]?.snapshot ?? "{}") as unknown;
        if (typeof value !== "object" || value === null)
          throw new Error("Validation input is invalid");
        const encoded = (value as { readonly acceptanceContext?: unknown }).acceptanceContext;
        return encoded === undefined
          ? null
          : Schema.decodeUnknownSync(acceptanceContextSnapshotSchema)(encoded);
      });
      qualifying.push({
        validationRunId: row.id,
        acceptanceContext: context,
        resolutionPrefix: prefixes.resolutions.map((resolution) => resolution.content),
        findings: reviewerFindings,
      });
    }
    if (qualifying.at(-1)?.validationRunId !== validationRunId || qualifying.length < 3) {
      return undefined;
    }
    const currentBlockers = yield* sql.unsafe<StoredImplementationBlockerRow>(
      `SELECT ${implementationBlockerReadColumns} FROM implementation_blockers WHERE change_id = ? ORDER BY id`,
      [change.id],
    );
    const fullBlockerHistory = yield* decodePersisted("read Stall Detection input", () =>
      decodeImplementationBlockerHistory(currentBlockers, changeId, idPrefix),
    );
    const passBlockerId = passed[0]?.highestBlockerId ?? 0;
    const blockerHistory = yield* decodePersisted("read Stall Detection input", () =>
      decodeImplementationBlockerHistory(
        currentBlockers.filter((blocker) => blocker.id > passBlockerId),
        changeId,
        idPrefix,
      ),
    );
    const initial = decodeSqliteAcceptanceContextSnapshot(change.acceptanceContext);
    const currentContext = deriveAcceptanceContext(initial, fullBlockerHistory);
    if (currentContext === null) return undefined;
    return {
      changeId,
      triggeringValidationRunId: validationRunId,
      acceptanceContext: currentContext,
      qualifyingRuns: qualifying,
      blockerHistory,
    };
  });

const recordStallDetectionAttempt = (
  sql: SqlClient.SqlClient,
  input: Parameters<StallDetectionPersistence["recordAttempt"]>[0],
  idPrefix: string,
) =>
  Effect.gen(function* () {
    const existing = yield* getAttemptByValidationRun(
      sql,
      input.assessmentInput.triggeringValidationRunId,
    );
    if (existing !== undefined) return existing;
    if (input.invocationIds.length === 0)
      return yield* invalid(
        "record Stall Detection attempt",
        "No Stall Detector Invocation was retained",
      );
    if (new Set(input.invocationIds).size !== input.invocationIds.length)
      return yield* invalid(
        "record Stall Detection attempt",
        "Stall Detector Invocation identities are duplicated",
      );
    const invocationOwners = yield* sql.unsafe<{ readonly agentSessionId: number }>(
      `SELECT continuation.agent_session_id AS agentSessionId
       FROM agent_invocations AS invocation
       JOIN agent_continuations AS continuation ON continuation.id = invocation.continuation_id
       WHERE invocation.id IN (${input.invocationIds.map(() => "?").join(", ")})`,
      input.invocationIds,
    );
    if (
      invocationOwners.length !== input.invocationIds.length ||
      invocationOwners.some((owner) => owner.agentSessionId !== input.agentSessionId)
    ) {
      return yield* invalid(
        "record Stall Detection attempt",
        "Stall Detector Invocation ownership is invalid",
      );
    }
    const inserted = yield* sql<{ readonly id: number }>`
      INSERT INTO stall_detection_attempts (
        change_id, validation_run_id, agent_session_id, diagnostic, created_at
      ) VALUES (
        ${internalChangeId(input.assessmentInput.changeId, idPrefix)},
        ${input.assessmentInput.triggeringValidationRunId}, ${input.agentSessionId},
        ${input.diagnostic.message}, ${input.now}
      ) RETURNING id
    `;
    const attemptId = inserted[0]?.id;
    if (attemptId === undefined)
      return yield* invalid("record Stall Detection attempt", "Identity was not allocated");
    for (const invocationId of input.invocationIds) {
      yield* sql`
        INSERT INTO stall_detection_attempt_invocations (
          stall_detection_attempt_id, validation_run_id, agent_invocation_id
        ) VALUES (${attemptId}, ${input.assessmentInput.triggeringValidationRunId}, ${invocationId})
      `;
    }
    return input.diagnostic;
  });

const recordStallDetection = (
  sql: SqlClient.SqlClient,
  input: Parameters<StallDetectionPersistence["record"]>[0],
  idPrefix: string,
) =>
  Effect.gen(function* () {
    const attempt = yield* getAttemptByValidationRun(
      sql,
      input.assessmentInput.triggeringValidationRunId,
    );
    if (attempt !== undefined)
      return yield* invalid(
        "record Stall Detection",
        "A failed Stall Detection attempt already exists for this Validation Run",
      );
    const existing = yield* readStallDetection(
      sql,
      input.assessmentInput.triggeringValidationRunId,
      idPrefix,
    );
    if (existing !== undefined) return existing;
    if (input.invocationIds.length === 0)
      return yield* invalid("record Stall Detection", "No Stall Detector Invocation was retained");
    const invocationOwners = yield* sql.unsafe<{ readonly agentSessionId: number }>(
      `SELECT continuation.agent_session_id AS agentSessionId
       FROM agent_invocations AS invocation
       JOIN agent_continuations AS continuation ON continuation.id = invocation.continuation_id
       WHERE invocation.id IN (${input.invocationIds.map(() => "?").join(", ")})`,
      input.invocationIds,
    );
    if (
      invocationOwners.length !== input.invocationIds.length ||
      invocationOwners.some((owner) => owner.agentSessionId !== input.agentSessionId)
    ) {
      return yield* invalid(
        "record Stall Detection",
        "Stall Detector Invocation ownership is invalid",
      );
    }
    const inserted = yield* sql<{ readonly id: number }>`
      INSERT INTO stall_detections (
        change_id, validation_run_id, agent_session_id, decision, reason,
        configuration, input_snapshot, created_at
      ) VALUES (
        ${internalChangeId(input.assessmentInput.changeId, idPrefix)},
        ${input.assessmentInput.triggeringValidationRunId},
        ${input.agentSessionId}, ${input.assessment.decision}, ${input.assessment.reason},
        ${JSON.stringify(input.configuration)}, ${JSON.stringify(input.assessmentInput)}, ${input.now}
      ) RETURNING id
    `;
    const detectionId = inserted[0]?.id;
    if (detectionId === undefined)
      return yield* invalid("record Stall Detection", "Identity was not allocated");
    for (const invocationId of input.invocationIds) {
      yield* sql`
        INSERT INTO stall_detection_agent_invocations (
          stall_detection_id, validation_run_id, agent_invocation_id
        ) VALUES (${detectionId}, ${input.assessmentInput.triggeringValidationRunId}, ${invocationId})
      `;
    }
    if (input.assessment.decision === "stop") {
      yield* sql`
        INSERT INTO implementation_blockers (
          change_id, content, resolution_content, source_type, source_id
        ) VALUES (
          ${internalChangeId(input.assessmentInput.changeId, idPrefix)},
          ${stallBlockerContent(
            input.assessment.reason,
            input.assessmentInput.triggeringValidationRunId,
          )}, NULL, 'stall_detection', ${detectionId}
        )
      `;
    }
    const record = yield* readStallDetection(
      sql,
      input.assessmentInput.triggeringValidationRunId,
      idPrefix,
    );
    if (record === undefined)
      return yield* invalid("record Stall Detection", "Detection disappeared");
    return record;
  });

const readStallDetection = (sql: SqlClient.SqlClient, validationRunId: number, idPrefix: string) =>
  Effect.gen(function* () {
    const rows = yield* sql<{
      readonly id: number;
      readonly changeId: number;
      readonly validationRunId: number;
      readonly agentSessionId: number;
      readonly decision: string;
      readonly reason: string;
      readonly configuration: string;
      readonly inputSnapshot: string;
      readonly createdAt: string;
    }>`
      SELECT id, change_id AS changeId, validation_run_id AS validationRunId,
        agent_session_id AS agentSessionId, decision, reason, configuration,
        input_snapshot AS inputSnapshot, created_at AS createdAt
      FROM stall_detections WHERE validation_run_id = ${validationRunId}
    `;
    const row = rows[0];
    if (row === undefined) return undefined;
    const blockerRows = yield* sql<{
      readonly id: number;
      readonly sourceType: string;
      readonly sourceId: number | null;
      readonly changeId: number;
    }>`
      SELECT id, source_type AS sourceType, source_id AS sourceId, change_id AS changeId
      FROM implementation_blockers WHERE source_type = 'stall_detection' AND source_id = ${row.id}
    `;
    const invocationRows = yield* sql<
      AgentInvocationPersistenceRow & { readonly validationRunId: number }
    >`
      SELECT link.validation_run_id AS validationRunId,
        invocation.id, invocation.continuation_id AS continuationId,
        continuation.agent_session_id AS agentSessionId, invocation.created_at AS createdAt,
        invocation.settled_at AS settledAt, invocation.settlement_kind AS settlementKind,
        continuation.harness, continuation.provider, continuation.model, continuation.thinking,
        continuation.transcript_path AS transcriptPath, continuation.unusable_reason AS unusableReason,
        invocation.input_tokens AS inputTokens, invocation.cached_input_tokens AS cachedInputTokens,
        invocation.cache_write_tokens AS cacheWriteTokens, invocation.output_tokens AS outputTokens,
        invocation.total_tokens AS totalTokens
      FROM stall_detection_run_invocations AS link
      JOIN agent_invocations AS invocation ON invocation.id = link.agent_invocation_id
      JOIN agent_continuations AS continuation ON continuation.id = invocation.continuation_id
      WHERE link.validation_run_id = ${row.validationRunId} ORDER BY invocation.id
    `;
    return yield* decodePersisted("read Stall Detection", () => {
      if (publicChangeId(idPrefix, row.changeId) === "") throw new Error("Invalid Change identity");
      if (row.decision !== "continue" && row.decision !== "stop")
        throw new Error("Invalid Stall Detection decision");
      if (
        (row.decision === "stop" && blockerRows.length !== 1) ||
        (row.decision === "continue" && blockerRows.length !== 0) ||
        blockerRows.some(
          (blocker) =>
            blocker.changeId !== row.changeId ||
            blocker.sourceType !== "stall_detection" ||
            blocker.sourceId !== row.id,
        )
      ) {
        throw new Error("Stall Detection and sourced Blocker pairing is invalid");
      }
      const configuration = Schema.decodeUnknownSync(resolvedReviewerPiAgentProfileSchema)(
        JSON.parse(row.configuration) as unknown,
      );
      const assessmentInput = decodeAssessmentInput(JSON.parse(row.inputSnapshot) as unknown);
      if (
        assessmentInput.changeId !== publicChangeId(idPrefix, row.changeId) ||
        assessmentInput.triggeringValidationRunId !== row.validationRunId ||
        invocationRows.length === 0
      ) {
        throw new Error("Stall Detection input or Invocation evidence is invalid");
      }
      if (
        invocationRows.some(
          (invocation) =>
            invocation.validationRunId !== row.validationRunId ||
            invocation.agentSessionId !== row.agentSessionId,
        )
      ) {
        throw new Error("Stall Detection Invocation link is invalid");
      }
      const invocations = invocationRows.map(decodeAgentInvocation);
      return {
        id: row.id,
        changeId: publicChangeId(idPrefix, row.changeId),
        validationRunId: row.validationRunId,
        agentSessionId: row.agentSessionId,
        decision: row.decision as "continue" | "stop",
        reason: row.reason,
        configuration,
        input: assessmentInput,
        invocations,
        blockerId: blockerRows[0]?.id ?? null,
        createdAt: row.createdAt,
      };
    });
  });

const positiveIntegerSchema = Schema.Number.pipe(
  Schema.filter((value) => Number.isSafeInteger(value) && value > 0, {
    message: () => "Expected a positive safe integer",
  }),
);

const nonBlankStringSchema = Schema.String.pipe(
  Schema.filter((value) => value.trim().length > 0, {
    message: () => "Expected a non-blank string",
  }),
);

const findingSchema = Schema.Struct({
  validationRunId: positiveIntegerSchema,
  phase: Schema.Literal("prepare", "checks", "acceptance_review", "specialist_review"),
  producer: nonBlankStringSchema,
  title: nonBlankStringSchema,
  description: Schema.String,
  evidence: Schema.String,
  files: Schema.Array(Schema.String),
  artifactRefs: Schema.Array(Schema.String),
});

const blockerResolutionSchema = Schema.Struct({
  blockerId: positiveIntegerSchema,
  content: nonBlankStringSchema,
});

const blockerSchema = Schema.Struct({
  id: positiveIntegerSchema,
  changeId: nonBlankStringSchema,
  content: nonBlankStringSchema,
  source: Schema.Union(
    Schema.Struct({ type: Schema.Literal("implementer") }),
    Schema.Struct({
      type: Schema.Literal("stall_detection"),
      stallDetectionId: positiveIntegerSchema,
    }),
  ),
  resolution: Schema.NullOr(blockerResolutionSchema),
});

const blockerHistorySchema = Schema.Struct({
  blockers: Schema.Array(blockerSchema),
  resolutions: Schema.Array(blockerResolutionSchema),
  active: Schema.NullOr(blockerSchema),
});

const qualifyingRunSchema = Schema.Struct({
  validationRunId: positiveIntegerSchema,
  acceptanceContext: Schema.NullOr(acceptanceContextSnapshotSchema),
  resolutionPrefix: Schema.Array(Schema.String),
  findings: Schema.Array(findingSchema),
});

const assessmentInputSchema = Schema.Struct({
  changeId: nonBlankStringSchema,
  triggeringValidationRunId: positiveIntegerSchema,
  acceptanceContext: acceptanceContextSnapshotSchema,
  qualifyingRuns: Schema.Array(qualifyingRunSchema),
  blockerHistory: blockerHistorySchema,
});

const decodeAssessmentInput = (value: unknown): StallDetectionAssessmentInput =>
  Schema.decodeUnknownSync(assessmentInputSchema, { onExcessProperty: "error" })(value);

const stallBlockerContent = (reason: string, validationRunId: number) =>
  `Stall Detector stopped this Change after Validation Run ${validationRunId} and requests Operator direction. ${reason}`;

const invalid = (operationName: string, message: string) =>
  Effect.fail(new RepositoryPersistedDataInvalid({ operationName, cause: new Error(message) }));
