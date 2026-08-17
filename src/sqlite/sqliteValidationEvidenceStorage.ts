import type * as SqlClient from "@effect/sql/SqlClient";
import { Effect } from "effect";

import type { AgentInvocationRecord, AgentThinking } from "../agent/agentSession/agentSession.js";
import type {
  CandidateValidationArtifact,
  CandidateValidationFinding,
  CandidateValidationPhaseResult,
  CandidateValidationRunRecord,
  CandidateValidationToolingFailure,
} from "../change/candidateValidation/candidateValidationRunStore.js";
import { type ValidationPhase, validationPhase } from "../change/validationRun/validationRun.js";
import { RepositoryPersistedDataInvalid } from "../contracts/repositoryStorageError.js";
import { decodePersisted } from "./sqliteTaskReadModel.js";
import { readValidationRunById } from "./sqliteValidationRunStorage.js";

type StoredPhaseResultRow = {
  readonly validationRunId: number;
  readonly phase: string;
  readonly producer: string;
  readonly outcome: string;
  readonly findings: string;
  readonly artifacts: string;
  readonly toolingFailure: string | null;
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

export const listValidationPhaseResults = (
  sql: SqlClient.SqlClient,
  validationRunId: number,
  idPrefix: string,
) =>
  Effect.gen(function* () {
    const rows = yield* readPhaseResults(sql, validationRunId);
    if (rows.length === 0) return [];
    const run = yield* requireRun(sql, validationRunId, "list Validation Phase Results", idPrefix);
    return yield* decodePersisted("list Validation Phase Results", () =>
      rows.map((row) => {
        configuredPosition(row.phase, row.producer, run);
        return {
          validationRunId: assertRunId(row.validationRunId, validationRunId),
          phase: decodePhase(row.phase),
          producer: row.producer,
          outcome: decodeOutcome(row.outcome),
        };
      }),
    );
  });

export const listValidationAgentInvocations = (sql: SqlClient.SqlClient, validationRunId: number) =>
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
  validationRunId: number,
  _idPrefix: string,
) =>
  Effect.flatMap(readPhaseResults(sql, validationRunId), (rows) =>
    decodePersisted("list Candidate validation Findings", () =>
      rows.flatMap((row) =>
        parseFindings(row.findings).map((finding) => ({
          ...finding,
          validationRunId: assertRunId(row.validationRunId, validationRunId),
          phase: decodePhase(row.phase),
          producer: row.producer,
        })),
      ),
    ),
  );

export const listValidationToolingFailures = (sql: SqlClient.SqlClient, validationRunId: number) =>
  Effect.gen(function* () {
    const phaseRows = yield* readPhaseResults(sql, validationRunId);
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
        ...parseToolingFailure(source),
      }));
    });
  });

export const listValidationArtifacts = (
  sql: SqlClient.SqlClient,
  validationRunId: number,
  _idPrefix: string,
) =>
  Effect.flatMap(readPhaseResults(sql, validationRunId), (rows) =>
    decodePersisted("list Candidate validation Artifacts", () =>
      rows.flatMap((row) =>
        parseArtifacts(row.artifacts).map((artifact) => ({
          ...artifact,
          ref: `artifact:${artifact.path}`,
          truncated: artifact.storedBytes < artifact.originalBytes,
          validationRunId: assertRunId(row.validationRunId, validationRunId),
          phase: decodePhase(row.phase),
          producer: row.producer,
        })),
      ),
    ),
  );

export const assertRunOwner = <A extends { readonly validationRunId: number }>(
  record: A,
  validationRunId: number,
): A => {
  assertRunId(record.validationRunId, validationRunId);
  return record;
};

export const validatePhaseResultPolicyRelationships = (
  results: readonly CandidateValidationPhaseResult[],
  runs: ReadonlyMap<number, CandidateValidationRunRecord>,
): void => {
  for (const result of results) {
    const run = runs.get(result.validationRunId);
    if (run === undefined) throw new Error("Validation Phase Result belongs to an unknown Run");
    configuredPosition(result.phase, result.producer, run);
  }
};

export const validateFindingPhaseResultRelationships = (
  findings: readonly CandidateValidationFinding[],
  results: readonly CandidateValidationPhaseResult[],
): void => {
  for (const finding of findings) {
    if (
      !results.some(
        (result) =>
          result.validationRunId === finding.validationRunId &&
          result.phase === finding.phase &&
          result.producer === finding.producer &&
          result.outcome === "failed",
      )
    ) {
      throw new Error("Finding has no failed Validation Phase Result");
    }
  }
};

const readPhaseResults = (sql: SqlClient.SqlClient, validationRunId: number) =>
  sql<StoredPhaseResultRow>`
    SELECT validation_run_id AS validationRunId, phase, producer, outcome,
      findings, artifacts, tooling_failure AS toolingFailure
    FROM validation_phase_results
    WHERE validation_run_id = ${validationRunId}
    ORDER BY CASE phase
      WHEN 'prepare' THEN 0 WHEN 'checks' THEN 1
      WHEN 'acceptance_review' THEN 2 ELSE 3 END, producer
  `;

const parseFindings = (
  source: string,
): readonly Omit<CandidateValidationFinding, "validationRunId" | "phase" | "producer">[] =>
  parseArray(source).map((value) => {
    const row = objectValue(value, "Finding");
    return {
      title: stringValue(field(row, "title"), "Finding title"),
      description: stringValue(field(row, "description"), "Finding description"),
      evidence: stringValue(field(row, "evidence"), "Finding evidence"),
      files: stringArray(field(row, "files"), "Finding files"),
      artifactRefs: stringArray(field(row, "artifactRefs"), "Finding Artifact refs"),
    };
  });

const parseArtifacts = (
  source: string,
): readonly Pick<CandidateValidationArtifact, "path" | "originalBytes" | "storedBytes">[] =>
  parseArray(source).map((value) => {
    const row = objectValue(value, "Artifact");
    const originalBytes = integerValue(field(row, "originalBytes"), "Artifact original bytes");
    const storedBytes = integerValue(field(row, "storedBytes"), "Artifact stored bytes");
    if (storedBytes > originalBytes) throw new Error("Artifact stored bytes exceed original bytes");
    return {
      path: stringValue(field(row, "path"), "Artifact path"),
      originalBytes,
      storedBytes,
    };
  });

const parseToolingFailure = (
  source: string,
): Omit<CandidateValidationToolingFailure, "sequence" | "validationRunId"> => {
  const row = objectValue(JSON.parse(source) as unknown, "Tooling Failure");
  return {
    errorKind: stringValue(
      field(row, "errorKind"),
      "Tooling Failure kind",
    ) as CandidateValidationToolingFailure["errorKind"],
    operationName: stringValue(field(row, "operationName"), "Tooling Failure operation"),
    errorMessage: stringValue(field(row, "errorMessage"), "Tooling Failure message"),
  };
};

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
      harness: row.harness === "pi" ? "pi" : invalidHarness(row.harness),
      provider: row.provider,
      model: row.model,
      thinking: decodeThinking(row.thinking),
      transcriptPath: row.transcriptPath,
      unusableReason: row.unusableReason,
    },
  };
};

const configuredPosition = (
  phase: string,
  producer: string,
  run: CandidateValidationRunRecord,
): number => {
  switch (decodePhase(phase)) {
    case validationPhase.prepare:
      if (run.policy.prepare === undefined) throw new Error("Prepare Result is not configured");
      return 1;
    case validationPhase.checks: {
      const index = run.policy.checks.findIndex((check) => check.id === producer);
      if (index < 0) throw new Error("Check Result is not configured");
      return index + 1;
    }
    case validationPhase.acceptanceReview:
      if (run.policy.acceptanceReview === undefined)
        throw new Error("Acceptance Review is not configured");
      return 1;
    case validationPhase.specialistReview: {
      const index = (run.policy.specialistReviews ?? []).findIndex(
        (review) => review.id === producer,
      );
      if (index < 0) throw new Error("Specialist Review is not configured");
      return index + 1;
    }
  }
};

const requireRun = (
  sql: SqlClient.SqlClient,
  validationRunId: number,
  operationName: string,
  idPrefix: string,
) =>
  Effect.flatMap(readValidationRunById(sql, validationRunId, operationName, idPrefix), (run) =>
    run === undefined
      ? invalidData(operationName, "Validation evidence belongs to an unknown Run")
      : Effect.succeed(run),
  );

const decodePhase = (value: string): ValidationPhase => {
  if (Object.values(validationPhase).includes(value as ValidationPhase))
    return value as ValidationPhase;
  throw new Error("Validation Phase is unsupported");
};
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
const stringArray = (value: unknown, name: string): readonly string[] => {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`${name} is not a string array`);
  }
  return value as readonly string[];
};
const integerValue = (value: unknown, name: string): number => {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new Error(`${name} is invalid`);
  return value as number;
};
const invalidHarness = (value: string): never => {
  throw new Error(`Invalid Agent Harness: ${value}`);
};
const decodeThinking = (value: string | null): AgentThinking | null => {
  if (value === null) return null;
  if (["off", "minimal", "low", "medium", "high", "xhigh"].includes(value)) {
    return value as AgentThinking;
  }
  throw new Error(`Invalid Agent thinking level: ${value}`);
};
const invalidData = (operationName: string, message: string) =>
  Effect.fail(new RepositoryPersistedDataInvalid({ operationName, cause: new Error(message) }));
