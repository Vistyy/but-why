import type * as SqlClient from "@effect/sql/SqlClient";
import { Effect } from "effect";

import type { AgentInvocationRecord } from "../agent/agentSession/agentSession.js";
import type {
  CandidateValidationArtifact,
  CandidateValidationFinding,
  CandidateValidationRound,
  CandidateValidationRunRecord,
  CandidateValidationToolingFailure,
} from "../change/candidateValidation/candidateValidationRunStore.js";
import type { ValidationToolingFailureKind } from "../change/validationRun/toolingErrorKind.js";
import { type ValidationPhase, validationPhase } from "../change/validationRun/validationRun.js";
import { RepositoryPersistedDataInvalid } from "../contracts/repositoryStorageError.js";
import { decodeSqliteJsonStringArray } from "./sqliteJsonStringArray.js";
import { decodePersisted } from "./sqliteTaskReadModel.js";
import { readValidationRunById } from "./sqliteValidationRunStorage.js";

export type StoredValidationRoundRow = {
  readonly validationRunId: string;
  readonly phase: ValidationPhase;
  readonly producer: string;
  readonly roundNumber: number;
  readonly status: CandidateValidationRound["status"];
  readonly createdAt: string;
};

type StoredValidationAgentInvocationRow = {
  readonly phase: ValidationPhase;
  readonly producer: string;
  readonly id: number;
  readonly agentSessionId: number;
  readonly continuationId: number;
  readonly createdAt: string;
  readonly settledAt: string | null;
  readonly settlementKind: string | null;
  readonly inputTokens: number | null;
  readonly cachedInputTokens: number | null;
  readonly cacheWriteTokens: number | null;
  readonly outputTokens: number | null;
  readonly totalTokens: number | null;
  readonly harness: string;
  readonly provider: string | null;
  readonly model: string;
  readonly thinking: string | null;
  readonly transcriptPath: string | null;
  readonly unusableReason: string | null;
};

export type StoredValidationFindingRow = {
  readonly id: string;
  readonly validationRunId: string;
  readonly phase: ValidationPhase;
  readonly producer: string;
  readonly title: string;
  readonly description: string;
  readonly evidence: string;
  readonly files: string;
  readonly artifactRefs: string;
  readonly createdAt: string;
  readonly updatedAt: string;
};

type StoredToolingFailureRow = {
  readonly sequence: number;
  readonly validationRunId: string;
  readonly errorKind: ValidationToolingFailureKind;
  readonly operationName: string;
  readonly errorMessage: string;
  readonly createdAt: string;
};

type StoredValidationArtifactRow = {
  readonly ref: string;
  readonly validationRunId: string;
  readonly phase: ValidationPhase;
  readonly producer: string;
  readonly path: string;
  readonly originalBytes: number;
  readonly storedBytes: number;
  readonly truncated: number;
  readonly createdAt: string;
};

export const findingReadColumns = `
  id, validation_run_id AS validationRunId, phase, producer, title,
  description, evidence, files, artifact_refs AS artifactRefs,
  created_at AS createdAt, updated_at AS updatedAt
`;

export const listValidationRounds = (
  sql: SqlClient.SqlClient,
  validationRunId: string,
  idPrefix: string,
) =>
  Effect.gen(function* () {
    const operationName = "list Candidate validation rounds";
    const rows = yield* sql<StoredValidationRoundRow>`
      SELECT validation_run_id AS validationRunId, phase, producer,
        round_number AS roundNumber,
        status, created_at AS createdAt
      FROM candidate_validation_rounds
      WHERE validation_run_id = ${validationRunId}
    `;
    const rounds = yield* decodePersisted(operationName, () =>
      rows
        .map((row) => assertRunOwner(decodeValidationRound(row), validationRunId))
        .sort(compareRounds),
    );
    if (rounds.length === 0) return rounds;
    const run = yield* readValidationRunById(
      sql,
      validationRunId,
      "decode Candidate Validation Run",
      idPrefix,
    );
    if (run === undefined) {
      return yield* invalidData(operationName, "Validation rounds belong to an unknown Run");
    }
    yield* decodePersisted(operationName, () =>
      validateRoundPolicyRelationships(rounds, new Map([[run.id, run]])),
    );
    return rounds;
  });

export const listValidationAgentInvocations = (sql: SqlClient.SqlClient, validationRunId: string) =>
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
        continuation.harness,
        continuation.provider,
        continuation.model,
        continuation.thinking,
        continuation.transcript_path AS transcriptPath,
        continuation.unusable_reason AS unusableReason
      FROM validation_phase_agent_invocations link
      JOIN agent_invocations invocation ON invocation.id = link.agent_invocation_id
      JOIN agent_continuations continuation ON continuation.id = invocation.continuation_id
      WHERE link.validation_run_id = ${validationRunId}
      ORDER BY invocation.id ASC
    `;
    return yield* decodePersisted("list Candidate Agent Invocations", () =>
      rows.map((row) => ({
        ...decodeAgentInvocation(row),
        phase: row.phase,
        producer: row.producer,
      })),
    );
  });

export const listValidationFindings = (
  sql: SqlClient.SqlClient,
  validationRunId: string,
  idPrefix: string,
) =>
  Effect.gen(function* () {
    const operationName = "decode Candidate validation Finding";
    const rows = yield* sql.unsafe<StoredValidationFindingRow>(
      `SELECT ${findingReadColumns}
       FROM candidate_validation_findings
       WHERE validation_run_id = ?`,
      [validationRunId],
    );
    const findings = yield* decodePersisted(operationName, () =>
      rows.map((row) => assertRunOwner(decodeValidationFinding(row), validationRunId)),
    );
    if (findings.length === 0) return findings;
    const run = yield* requireRun(sql, validationRunId, operationName, idPrefix);
    const roundRows = yield* sql<StoredValidationRoundRow>`
      SELECT round.validation_run_id AS validationRunId, round.phase, round.producer,
        round.round_number AS roundNumber,
        round.status, round.created_at AS createdAt
      FROM candidate_validation_rounds AS round
      WHERE round.validation_run_id = ${validationRunId}
        AND EXISTS (
          SELECT 1 FROM candidate_validation_findings AS finding
          WHERE finding.validation_run_id = round.validation_run_id
            AND finding.phase = round.phase AND finding.producer = round.producer
        )
    `;
    const rounds = yield* decodePersisted(operationName, () => {
      const selected = roundRows.map((row) =>
        assertRunOwner(decodeValidationRound(row), validationRunId),
      );
      validateRoundPolicyRelationships(selected, new Map([[run.id, run]]));
      validateFindingRoundRelationships(findings, selected);
      return selected;
    });
    return findings.sort((left, right) => compareEvidence(left, right, rounds));
  });

export const listValidationToolingFailures = (sql: SqlClient.SqlClient, validationRunId: string) =>
  Effect.gen(function* () {
    const operationName = "list Candidate validation Tooling Failures";
    const rows = yield* sql<StoredToolingFailureRow>`
      SELECT sequence, validation_run_id AS validationRunId, error_kind AS errorKind,
        operation_name AS operationName, error_message AS errorMessage,
        created_at AS createdAt
      FROM candidate_validation_tooling_failures
      WHERE validation_run_id = ${validationRunId}
    `;
    const failures = yield* decodePersisted(operationName, () =>
      rows
        .map((row) => assertRunOwner(decodeToolingFailure(row), validationRunId))
        .sort((left, right) => left.sequence - right.sequence),
    );
    if (failures.length === 0) return failures;
    yield* requireRunIdentity(
      sql,
      validationRunId,
      operationName,
      "Tooling Failures belong to an unknown Run",
    );
    return failures;
  });

export const listValidationArtifacts = (
  sql: SqlClient.SqlClient,
  validationRunId: string,
  idPrefix: string,
) =>
  Effect.gen(function* () {
    const operationName = "list Candidate validation Artifacts";
    const rows = yield* sql<StoredValidationArtifactRow>`
      SELECT ref, validation_run_id AS validationRunId, phase, producer, path,
        original_bytes AS originalBytes, stored_bytes AS storedBytes, truncated,
        created_at AS createdAt
      FROM candidate_validation_artifacts
      WHERE validation_run_id = ${validationRunId}
    `;
    const artifacts = yield* decodePersisted(operationName, () =>
      rows
        .map((row) => assertRunOwner(decodeValidationArtifact(row), validationRunId))
        .sort(compareArtifacts),
    );
    if (artifacts.length === 0) return artifacts;
    const run = yield* requireRun(sql, validationRunId, operationName, idPrefix);
    const roundRows = yield* sql<StoredValidationRoundRow>`
      SELECT round.validation_run_id AS validationRunId, round.phase, round.producer,
        round.round_number AS roundNumber,
        round.status, round.created_at AS createdAt
      FROM candidate_validation_rounds AS round
      WHERE round.validation_run_id = ${validationRunId}
        AND EXISTS (
          SELECT 1 FROM candidate_validation_artifacts AS artifact
          WHERE artifact.validation_run_id = round.validation_run_id
            AND artifact.phase = round.phase AND artifact.producer = round.producer
        )
    `;
    yield* decodePersisted(operationName, () => {
      const rounds = roundRows.map((row) =>
        assertRunOwner(decodeValidationRound(row), validationRunId),
      );
      validateRoundPolicyRelationships(rounds, new Map([[run.id, run]]));
    });
    return artifacts;
  });

export const decodeValidationRound = (row: StoredValidationRoundRow): CandidateValidationRound => ({
  validationRunId: row.validationRunId,
  phase: row.phase,
  producer: row.producer,
  roundNumber: row.roundNumber,
  status: row.status,
  createdAt: row.createdAt,
});

const decodeAgentInvocation = (row: StoredValidationAgentInvocationRow): AgentInvocationRecord => {
  const validKinds = ["returned", "launch_failed", "failed", "return_unknown"] as const;
  if (
    row.settlementKind !== null &&
    !validKinds.includes(row.settlementKind as (typeof validKinds)[number])
  ) {
    throw new Error(`Invalid Agent Invocation settlement kind: ${row.settlementKind}`);
  }
  const values = [
    row.inputTokens,
    row.cachedInputTokens,
    row.cacheWriteTokens,
    row.outputTokens,
    row.totalTokens,
  ];
  const hasUsage = values.some((value) => value !== null);
  if (
    hasUsage &&
    values.some((value) => value === null || !Number.isSafeInteger(value) || value < 0)
  ) {
    throw new Error("Incomplete Agent Invocation token evidence");
  }
  return {
    id: row.id,
    continuationId: row.continuationId,
    createdAt: row.createdAt,
    settledAt: row.settledAt,
    settlementKind: row.settlementKind as AgentInvocationRecord["settlementKind"],
    usage: hasUsage
      ? {
          inputTokens: row.inputTokens as number,
          cachedInputTokens: row.cachedInputTokens as number,
          cacheWriteTokens: row.cacheWriteTokens as number,
          outputTokens: row.outputTokens as number,
          totalTokens: row.totalTokens as number,
        }
      : null,
    continuation: {
      id: row.continuationId,
      agentSessionId: row.agentSessionId,
      harness: decodeAgentHarness(row.harness),
      provider: row.provider,
      model: row.model,
      thinking: row.thinking === null ? null : decodeAgentThinking(row.thinking),
      transcriptPath: row.transcriptPath,
      unusableReason: row.unusableReason,
    },
  };
};

const decodeAgentHarness = (value: string): "pi" => {
  if (value !== "pi") throw new Error(`Invalid Agent Harness: ${value}`);
  return "pi";
};

const decodeAgentThinking = (value: string) => {
  if (!["off", "minimal", "low", "medium", "high", "xhigh"].includes(value))
    throw new Error(`Invalid Agent thinking level: ${value}`);
  return value as "off" | "minimal" | "low" | "medium" | "high" | "xhigh";
};

export const decodeValidationFinding = (
  row: StoredValidationFindingRow,
): CandidateValidationFinding => ({
  id: row.id,
  validationRunId: row.validationRunId,
  phase: row.phase,
  producer: row.producer,
  title: row.title,
  description: row.description,
  evidence: row.evidence,
  files: decodeSqliteJsonStringArray(row.files),
  artifactRefs: decodeSqliteJsonStringArray(row.artifactRefs),
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

const decodeToolingFailure = (row: StoredToolingFailureRow): CandidateValidationToolingFailure => ({
  sequence: row.sequence,
  validationRunId: row.validationRunId,
  errorKind: row.errorKind,
  operationName: row.operationName,
  errorMessage: row.errorMessage,
  createdAt: row.createdAt,
});

const decodeValidationArtifact = (
  row: StoredValidationArtifactRow,
): CandidateValidationArtifact => ({
  ref: row.ref,
  validationRunId: row.validationRunId,
  phase: row.phase,
  producer: row.producer,
  path: row.path,
  originalBytes: row.originalBytes,
  storedBytes: row.storedBytes,
  truncated: row.truncated === 1,
  createdAt: row.createdAt,
});

export const assertRunOwner = <A extends { readonly validationRunId: string }>(
  record: A,
  validationRunId: string,
): A => {
  if (record.validationRunId !== validationRunId)
    throw new Error("Validation evidence belongs to another Run");
  return record;
};

export const validateRoundPolicyRelationships = (
  rounds: readonly CandidateValidationRound[],
  runs: ReadonlyMap<string, CandidateValidationRunRecord>,
): void => {
  for (const round of rounds) {
    const run = runs.get(round.validationRunId);
    if (run === undefined) throw new Error("Validation round belongs to an unknown Run");
    const expectedRoundNumber = configuredRoundNumber(round, run);
    if (expectedRoundNumber === undefined) {
      throw new Error("Validation round is not configured by its Run policy");
    }
    if (round.roundNumber !== expectedRoundNumber) {
      throw new Error("Validation round ordering does not match its Run policy");
    }
  }
};

export const validateFindingRoundRelationships = (
  findings: readonly CandidateValidationFinding[],
  rounds: readonly CandidateValidationRound[],
): void => {
  for (const finding of findings) findingRound(finding, rounds);
};

const requireRun = (
  sql: SqlClient.SqlClient,
  validationRunId: string,
  operationName: string,
  idPrefix: string,
) =>
  Effect.flatMap(
    readValidationRunById(sql, validationRunId, "decode Candidate Validation Run", idPrefix),
    (run) =>
      run === undefined
        ? invalidData(operationName, "Validation evidence belongs to an unknown Run")
        : Effect.succeed(run),
  );

const requireRunIdentity = (
  sql: SqlClient.SqlClient,
  validationRunId: string,
  operationName: string,
  missingMessage: string,
) =>
  Effect.gen(function* () {
    const rows = yield* sql<{ readonly id: string }>`
      SELECT id FROM candidate_validation_runs WHERE id = ${validationRunId}
    `;
    const row = rows[0];
    if (row === undefined) return yield* invalidData(operationName, missingMessage);
    yield* decodePersisted(operationName, () => {
      if (row.id !== validationRunId)
        throw new Error("Validation Run identity does not match lookup");
    });
  });

const phaseOrder = (phase: CandidateValidationRound["phase"]): number => {
  switch (phase) {
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

const compareRounds = (left: CandidateValidationRound, right: CandidateValidationRound): number =>
  phaseOrder(left.phase) - phaseOrder(right.phase) ||
  left.roundNumber - right.roundNumber ||
  compareStrings(left.producer, right.producer);

const configuredRoundNumber = (
  round: CandidateValidationRound,
  run: CandidateValidationRunRecord,
): number | undefined => {
  switch (round.phase) {
    case validationPhase.prepare:
      return run.policy.prepare === undefined ? undefined : 1;
    case validationPhase.checks: {
      const index = run.policy.checks.findIndex((check) => check.id === round.producer);
      return index < 0 ? undefined : index + 1;
    }
    case validationPhase.acceptanceReview:
      return run.policy.acceptanceReview === undefined ? undefined : 1;
    case validationPhase.specialistReview: {
      const index = (run.policy.specialistReviews ?? []).findIndex(
        (specialist) => specialist.id === round.producer,
      );
      return index < 0 ? undefined : index + 1;
    }
  }
};

const compareEvidence = (
  left: CandidateValidationFinding,
  right: CandidateValidationFinding,
  rounds: readonly CandidateValidationRound[],
): number =>
  phaseOrder(left.phase) - phaseOrder(right.phase) ||
  findingRound(left, rounds) - findingRound(right, rounds) ||
  compareStrings(left.id, right.id);

const findingRound = (
  finding: CandidateValidationFinding,
  rounds: readonly CandidateValidationRound[],
): number => {
  const round = rounds.find(
    (candidate) =>
      candidate.validationRunId === finding.validationRunId &&
      candidate.phase === finding.phase &&
      candidate.producer === finding.producer,
  );
  if (round === undefined) throw new Error("Finding has no related Validation round");
  if (round.status !== "failed") throw new Error("Finding belongs to a passed Validation round");
  return round.roundNumber;
};

const artifactPathOrder = (path: string): number => {
  if (path.endsWith("/stdout.txt")) return 0;
  if (path.endsWith("/stderr.txt")) return 1;
  if (path.endsWith("/exit-code.json")) return 2;
  if (path.endsWith("/logs.txt")) return 3;
  return 4;
};

const compareArtifacts = (
  left: CandidateValidationArtifact,
  right: CandidateValidationArtifact,
): number =>
  phaseOrder(left.phase) - phaseOrder(right.phase) ||
  compareStrings(left.producer, right.producer) ||
  artifactPathOrder(left.path) - artifactPathOrder(right.path) ||
  compareStrings(left.ref, right.ref);

const compareStrings = (left: string, right: string): number =>
  left === right ? 0 : left < right ? -1 : 1;

const invalidData = (operationName: string, message: string) =>
  Effect.fail(new RepositoryPersistedDataInvalid({ operationName, cause: new Error(message) }));
