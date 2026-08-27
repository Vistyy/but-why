import type * as SqlClient from "@effect/sql/SqlClient";
import { Effect } from "effect";

import {
  decodeSqliteAgentInvocation,
  type SqliteAgentInvocationRow,
} from "../../../agent/agentSession/adapters/sqlite/sqliteAgentInvocation.js";
import { RepositoryPersistedDataInvalid } from "../../../contracts/repositoryStorageError.js";
import { decodePersisted } from "../../../repositoryRuntime/adapters/sqlite/sqlitePersistedData.js";
import {
  assertValidationArtifactRecord,
  assertValidationToolingFailureEvidence,
  decodeValidationFindingEvidence,
} from "../../candidateValidation/candidateValidationEvidence.js";
import type {
  CandidateValidationArtifact,
  CandidateValidationFinding,
  CandidateValidationPhaseResult,
  CandidateValidationToolingFailure,
} from "../../candidateValidation/candidateValidationRunStore.js";
import { internalChangeId } from "../../changeId.js";
import type { ChangePolicy } from "../../changePolicy.js";
import { validationPhase } from "../../validationRun/validationRun.js";
import { readCandidateById } from "./sqliteCandidateStorage.js";
import { configuredValidationPosition, decodeValidationPhase } from "./sqliteValidationPosition.js";
import { readValidationExecutionAuthorityById } from "./sqliteValidationRunStorage.js";

type StoredPhaseResultRow = {
  readonly validationRunId: number;
  readonly phase: string;
  readonly producer: string;
  readonly outcome: string;
  readonly findings: string;
  readonly artifacts: string;
  readonly toolingFailure: string | null;
};

type StoredValidationAgentInvocationRow = SqliteAgentInvocationRow & {
  readonly phase: string;
  readonly producer: string;
};

export const listValidationPhaseResults = (
  sql: SqlClient.SqlClient,
  validationRunId: number,
  idPrefix: string,
) =>
  Effect.gen(function* () {
    const rows = yield* readOrderedPhaseResults(
      sql,
      validationRunId,
      "list Validation Phase Results",
      idPrefix,
    );
    return yield* decodePersisted("list Validation Phase Results", () =>
      rows.map((row) => ({
        validationRunId: assertRunId(row.validationRunId, validationRunId),
        phase: decodePhase(row.phase),
        producer: row.producer,
        outcome: decodeOutcome(row.outcome),
      })),
    );
  });

export const listValidationAgentInvocations = (
  sql: SqlClient.SqlClient,
  validationRunId: number,
  idPrefix: string,
) =>
  Effect.gen(function* () {
    const rows = yield* sql<StoredValidationAgentInvocationRow>`
      SELECT link.phase, link.producer,
        invocation.id, continuation.agent_session_id AS agentSessionId,
        invocation.continuation_id AS continuationId,
        invocation.created_at AS createdAt, invocation.settled_at AS settledAt,
        invocation.settlement_kind AS settlementKind,
        invocation.input_tokens AS inputTokens,
        invocation.cached_input_tokens AS cachedInputTokens,
        invocation.cache_write_tokens AS cacheWriteTokens,
        invocation.output_tokens AS outputTokens,
        invocation.total_tokens AS totalTokens,
        continuation.harness, continuation.provider, continuation.model,
        continuation.thinking, continuation.transcript_path AS transcriptPath,
        continuation.unusable_reason AS unusableReason
      FROM validation_phase_agent_invocations AS link
      JOIN agent_invocations AS invocation ON invocation.id = link.agent_invocation_id
      JOIN agent_continuations AS continuation ON continuation.id = invocation.continuation_id
      WHERE link.validation_run_id = ${validationRunId}
      ORDER BY invocation.id
    `;
    if (rows.length === 0) return [];
    const authority = yield* requireValidationExecutionAuthority(
      sql,
      validationRunId,
      "list Candidate Agent Invocations",
      idPrefix,
    );
    return yield* decodePersisted("list Candidate Agent Invocations", () =>
      rows.map((row) => {
        configuredValidationPosition(row.phase, row.producer, authority.changePolicy);
        return {
          ...decodeSqliteAgentInvocation(row),
          phase: decodeValidationPhase(row.phase),
          producer: row.producer,
        };
      }),
    );
  });

export const listValidationFindings = (
  sql: SqlClient.SqlClient,
  validationRunId: number,
  idPrefix: string,
) =>
  Effect.gen(function* () {
    const rows = yield* readOrderedPhaseResults(
      sql,
      validationRunId,
      "list Candidate validation Findings",
      idPrefix,
    );
    return yield* decodePersisted("list Candidate validation Findings", () => {
      const artifacts = decodeArtifacts(rows, validationRunId);
      return decodeFindings(rows, artifacts, validationRunId);
    });
  });

export const listValidationFindingsForRuns = (
  sql: SqlClient.SqlClient,
  changeId: string,
  validationRunIds: readonly number[],
  idPrefix: string,
) =>
  Effect.gen(function* () {
    const firstValidationRunId = validationRunIds[0];
    if (firstValidationRunId === undefined) return [];
    const operationName = "list Stall Detection Findings";
    const authority = yield* requireValidationExecutionAuthority(
      sql,
      firstValidationRunId,
      operationName,
      idPrefix,
    );
    const candidate = yield* readCandidateById(
      sql,
      authority.run.candidateId,
      operationName,
      idPrefix,
    );
    if (candidate?.changeId !== changeId) {
      return yield* invalidData(operationName, "Validation Run history belongs to another Change");
    }
    const rows = yield* sql<StoredPhaseResultRow>`
      SELECT result.validation_run_id AS validationRunId, result.phase, result.producer,
        result.outcome, result.findings, result.artifacts,
        result.tooling_failure AS toolingFailure
      FROM validation_phase_results AS result
      JOIN validation_runs AS run ON run.id = result.validation_run_id
      JOIN candidates AS candidate ON candidate.id = run.candidate_id
      WHERE ${sql.in("result.validation_run_id", validationRunIds)}
        AND candidate.change_id = ${internalChangeId(changeId, idPrefix)}
    `;
    return yield* decodePersisted(operationName, () => {
      const orderedRows = orderPhaseResultRows(rows, authority.changePolicy);
      const artifacts = decodeArtifacts(orderedRows);
      return decodeFindings(orderedRows, artifacts);
    });
  });

export const listValidationToolingFailures = (
  sql: SqlClient.SqlClient,
  validationRunId: number,
  idPrefix: string,
) =>
  Effect.gen(function* () {
    const phaseRows = yield* readOrderedPhaseResults(
      sql,
      validationRunId,
      "list Candidate validation Tooling Failures",
      idPrefix,
    );
    const runRows = yield* sql<{ readonly toolingFailure: string | null }>`
      SELECT run_tooling_failure AS toolingFailure
      FROM validation_runs WHERE id = ${validationRunId}
    `;
    return yield* decodePersisted("list Candidate validation Tooling Failures", () => {
      const encoded = [
        ...phaseRows.flatMap((row) => (row.toolingFailure === null ? [] : [row.toolingFailure])),
        ...(runRows[0]?.toolingFailure === null || runRows[0]?.toolingFailure === undefined
          ? []
          : [runRows[0].toolingFailure]),
      ];
      return encoded.map((source, index) => ({
        sequence: index + 1,
        validationRunId,
        ...decodeSqliteValidationToolingFailure(source),
      }));
    });
  });

export const listValidationArtifacts = (
  sql: SqlClient.SqlClient,
  validationRunId: number,
  idPrefix: string,
) =>
  Effect.gen(function* () {
    const rows = yield* readOrderedPhaseResults(
      sql,
      validationRunId,
      "list Candidate validation Artifacts",
      idPrefix,
    );
    return yield* decodePersisted("list Candidate validation Artifacts", () =>
      decodeArtifacts(rows, validationRunId),
    );
  });

const readOrderedPhaseResults = (
  sql: SqlClient.SqlClient,
  validationRunId: number,
  operationName: string,
  idPrefix: string,
) =>
  Effect.gen(function* () {
    const rows = yield* sql<StoredPhaseResultRow>`
      SELECT validation_run_id AS validationRunId, phase, producer, outcome,
        findings, artifacts, tooling_failure AS toolingFailure
      FROM validation_phase_results
      WHERE validation_run_id = ${validationRunId}
    `;
    if (rows.length === 0) return rows;
    const authority = yield* requireValidationExecutionAuthority(
      sql,
      validationRunId,
      operationName,
      idPrefix,
    );
    return yield* decodePersisted(operationName, () =>
      orderPhaseResultRows(rows, authority.changePolicy),
    );
  });

const orderPhaseResultRows = (
  rows: readonly StoredPhaseResultRow[],
  changePolicy: ChangePolicy,
): readonly StoredPhaseResultRow[] =>
  rows
    .map((row) => ({
      row,
      phasePosition: phasePosition(row.phase),
      producerPosition: configuredValidationPosition(row.phase, row.producer, changePolicy),
    }))
    .sort(
      (left, right) =>
        left.row.validationRunId - right.row.validationRunId ||
        left.phasePosition - right.phasePosition ||
        left.producerPosition - right.producerPosition,
    )
    .map(({ row }) => row);

const decodeArtifacts = (
  rows: readonly StoredPhaseResultRow[],
  expectedRunId?: number,
): readonly CandidateValidationArtifact[] =>
  rows.flatMap((row) =>
    parseArtifacts(row.artifacts).map((artifact) => {
      const record = {
        ...artifact,
        ref: `artifact:${artifact.path}`,
        truncated: artifact.storedBytes < artifact.originalBytes,
        validationRunId:
          expectedRunId === undefined
            ? row.validationRunId
            : assertRunId(row.validationRunId, expectedRunId),
        phase: decodePhase(row.phase),
        producer: row.producer,
      };
      assertValidationArtifactRecord(record);
      return record;
    }),
  );

const decodeFindings = (
  rows: readonly StoredPhaseResultRow[],
  artifacts: readonly CandidateValidationArtifact[],
  expectedRunId?: number,
): readonly CandidateValidationFinding[] => {
  const artifactRefsByRun = new Map<number, Set<string>>();
  for (const artifact of artifacts) {
    const refs = artifactRefsByRun.get(artifact.validationRunId) ?? new Set<string>();
    refs.add(artifact.ref);
    artifactRefsByRun.set(artifact.validationRunId, refs);
  }
  return rows.flatMap((row) => {
    const validationRunId =
      expectedRunId === undefined
        ? row.validationRunId
        : assertRunId(row.validationRunId, expectedRunId);
    return parseFindings(
      row.findings,
      artifactRefsByRun.get(validationRunId) ?? new Set<string>(),
    ).map((finding) => ({
      ...finding,
      validationRunId,
      phase: decodePhase(row.phase),
      producer: row.producer,
    }));
  });
};

const parseFindings = (
  source: string,
  availableArtifactRefs: ReadonlySet<string>,
): readonly Omit<CandidateValidationFinding, "validationRunId" | "phase" | "producer">[] =>
  parseArray(source).map((value) => decodeValidationFindingEvidence(value, availableArtifactRefs));

const parseArtifacts = (
  source: string,
): readonly Pick<CandidateValidationArtifact, "path" | "originalBytes" | "storedBytes">[] =>
  parseArray(source).map((value) => {
    const row = objectValue(value, "Artifact");
    const artifact = {
      path: stringValue(field(row, "path"), "Artifact path"),
      originalBytes: numberValue(field(row, "originalBytes"), "Artifact original bytes"),
      storedBytes: numberValue(field(row, "storedBytes"), "Artifact stored bytes"),
    };
    return artifact;
  });

export const decodeSqliteValidationToolingFailure = (
  source: string,
): Omit<CandidateValidationToolingFailure, "sequence" | "validationRunId"> => {
  const row = objectValue(JSON.parse(source) as unknown, "Tooling Failure");
  requireExactFields(row, ["errorKind", "operationName", "errorMessage"], "Tooling Failure");
  const failure = {
    errorKind: stringValue(
      field(row, "errorKind"),
      "Tooling Failure kind",
    ) as CandidateValidationToolingFailure["errorKind"],
    operationName: stringValue(field(row, "operationName"), "Tooling Failure operation"),
    errorMessage: stringValue(field(row, "errorMessage"), "Tooling Failure message"),
  };
  assertValidationToolingFailureEvidence(failure);
  return failure;
};

const phasePosition = (phase: string): number => {
  switch (decodePhase(phase)) {
    case validationPhase.prepare:
      return 0;
    case validationPhase.checks:
      return 1;
    case validationPhase.acceptanceReview:
      return 2;
    case validationPhase.specialistReview:
      return 3;
  }
};

const requireValidationExecutionAuthority = (
  sql: SqlClient.SqlClient,
  validationRunId: number,
  operationName: string,
  idPrefix: string,
) =>
  Effect.flatMap(
    readValidationExecutionAuthorityById(sql, validationRunId, operationName, idPrefix),
    (authority) =>
      authority === undefined
        ? invalidData(operationName, "Validation evidence belongs to an unknown Run")
        : Effect.succeed(authority),
  );

const decodePhase = decodeValidationPhase;
const decodeOutcome = (value: string): CandidateValidationPhaseResult["outcome"] => {
  if (value === "passed" || value === "failed") return value;
  throw new Error("Validation Phase Result outcome is unsupported");
};
const assertRunId = (actual: number, expected: number): number => {
  if (actual !== expected) throw new Error("Validation evidence belongs to another Run");
  return actual;
};
const parseArray = (source: string): readonly unknown[] => {
  const value: unknown = JSON.parse(source) as unknown;
  if (!Array.isArray(value)) throw new Error("Stored evidence is not an array");
  return value;
};
const objectValue = (value: unknown, name: string): Record<string, unknown> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${name} is not an object`);
  }
  return value as Record<string, unknown>;
};
const field = (value: Record<string, unknown>, name: string): unknown => value[name];
const stringValue = (value: unknown, name: string): string => {
  if (typeof value !== "string") throw new Error(`${name} is not a string`);
  return value;
};
const requireExactFields = (
  value: Record<string, unknown>,
  fields: readonly string[],
  name: string,
): void => {
  const keys = Object.keys(value);
  if (keys.length !== fields.length || fields.some((fieldName) => !(fieldName in value))) {
    throw new Error(`${name} fields are invalid`);
  }
};
const numberValue = (value: unknown, name: string): number => {
  if (typeof value !== "number") throw new Error(`${name} is not a number`);
  return value;
};
const invalidData = (operationName: string, message: string) =>
  Effect.fail(new RepositoryPersistedDataInvalid({ operationName, cause: new Error(message) }));
