import type * as SqlClient from "@effect/sql/SqlClient";
import { Effect } from "effect";
import { RepositoryPersistedDataInvalid } from "../../../contracts/repositoryStorageError.js";
import { validationArtifactRef } from "../../../contracts/validationArtifact.js";
import { decodePersisted } from "../../../repositoryRuntime/adapters/sqlite/sqlitePersistedData.js";
import {
  assertValidationArtifactRecord,
  assertValidationToolingFailureEvidence,
  decodeValidationFindingEvidence,
} from "../../candidateValidation/candidateValidationEvidence.js";
import type { CandidateValidationOutcome } from "../../candidateValidation/candidateValidationRunStore.js";
import type { ChangePolicy } from "../../changePolicy.js";
import { type ValidationPhase, validationPhase } from "../../validationRun/validationRun.js";
import { configuredValidationPosition, decodeValidationPhase } from "./sqliteValidationPosition.js";
import { readValidationExecutionAuthorityById } from "./sqliteValidationRunStorage.js";

type PhaseResultEvidenceRow = {
  readonly validationRunId: number;
  readonly phase: string;
  readonly producer: string;
  readonly outcome: string;
  readonly findings: string;
  readonly artifacts: string;
  readonly toolingFailure: string | null;
};

type ReviewerInvocationEvidenceRow = {
  readonly validationRunId: number;
  readonly phase: string;
  readonly producer: string;
  readonly invocationId: number;
  readonly settledAt: string | null;
  readonly settlementKind: string | null;
  readonly changeOwned: number;
};

type ExpectedPhase = {
  readonly phase: ValidationPhase;
  readonly producers: readonly string[];
};

export const requireCoherentValidationCompletion = (
  sql: SqlClient.SqlClient,
  validationRunId: number,
  outcome: CandidateValidationOutcome,
  operationName: string,
  idPrefix: string,
) =>
  Effect.gen(function* () {
    const authority = yield* readValidationExecutionAuthorityById(
      sql,
      validationRunId,
      operationName,
      idPrefix,
    );
    if (authority === undefined) {
      return yield* invalid(operationName, "Validation Run does not exist");
    }
    const evidenceRows = yield* sql<PhaseResultEvidenceRow>`
      SELECT validation_run_id AS validationRunId, phase, producer, outcome,
        findings, artifacts, tooling_failure AS toolingFailure
      FROM validation_phase_results
      WHERE validation_run_id = ${validationRunId}
    `;
    const reviewerInvocationRows = yield* sql<ReviewerInvocationEvidenceRow>`
      SELECT link.validation_run_id AS validationRunId, link.phase, link.producer,
        link.agent_invocation_id AS invocationId,
        invocation.settled_at AS settledAt, invocation.settlement_kind AS settlementKind,
        CASE WHEN change_session.agent_session_id IS NULL THEN 0 ELSE 1 END AS changeOwned
      FROM validation_phase_agent_invocations AS link
      JOIN agent_invocations AS invocation ON invocation.id = link.agent_invocation_id
      JOIN agent_continuations AS continuation ON continuation.id = invocation.continuation_id
      JOIN validation_runs AS run ON run.id = link.validation_run_id
      JOIN candidates AS candidate ON candidate.id = run.candidate_id
      LEFT JOIN change_agent_sessions AS change_session
        ON change_session.change_id = candidate.change_id
        AND change_session.producer = link.producer
        AND change_session.agent_session_id = continuation.agent_session_id
      WHERE link.validation_run_id = ${validationRunId}
      ORDER BY link.phase, link.producer, link.agent_invocation_id
    `;
    const runRows = yield* sql<{ readonly toolingFailure: string | null }>`
      SELECT run_tooling_failure AS toolingFailure
      FROM validation_runs WHERE id = ${validationRunId}
    `;
    const runToolingFailure = runRows[0]?.toolingFailure ?? null;

    yield* decodePersisted(operationName, () =>
      validateValidationCompletion(
        authority.changePolicy,
        outcome,
        evidenceRows,
        reviewerInvocationRows,
        runToolingFailure,
        validationRunId,
      ),
    );
  }).pipe(Effect.asVoid);

const isPreDispatchReviewerIntegrityFailure = (
  phase: ValidationPhase,
  evidence: PhaseResultEvidenceRow | undefined,
): boolean => {
  if (evidence?.toolingFailure === null || evidence === undefined) return false;
  const findings: unknown = JSON.parse(evidence.findings) as unknown;
  const artifacts: unknown = JSON.parse(evidence.artifacts) as unknown;
  const failure: unknown = JSON.parse(evidence.toolingFailure) as unknown;
  if (
    !Array.isArray(findings) ||
    findings.length !== 0 ||
    !Array.isArray(artifacts) ||
    artifacts.length !== 0 ||
    typeof failure !== "object" ||
    failure === null ||
    Array.isArray(failure)
  ) {
    return false;
  }
  const value = failure as { readonly errorKind?: unknown; readonly operationName?: unknown };
  return (
    (value.errorKind === "git_tooling_failed" && value.operationName === "verify_candidate_head") ||
    (value.errorKind === "infrastructure_tooling_failed" &&
      value.operationName ===
        (phase === validationPhase.acceptanceReview
          ? "verify_acceptance_candidate"
          : "verify_specialist_candidate"))
  );
};

export const validateValidationCompletion = (
  changePolicy: ChangePolicy,
  outcome: CandidateValidationOutcome,
  evidenceRows: readonly PhaseResultEvidenceRow[],
  reviewerInvocationRows: readonly ReviewerInvocationEvidenceRow[],
  runToolingFailure: string | null,
  validationRunId: number,
): void => {
  const expected = expectedPhases(changePolicy);
  const results = evidenceRows.map((row) => {
    const phase = decodeValidationPhase(row.phase);
    configuredValidationPosition(phase, row.producer, changePolicy);
    return {
      validationRunId: row.validationRunId,
      phase,
      producer: row.producer,
      outcome: decodeOutcome(row.outcome),
    };
  });
  const artifactRefs = new Set<string>();
  const findingsByPosition = new Map<string, number>();
  const toolingPositions = new Set<string>();
  const evidenceByPosition = new Map<string, PhaseResultEvidenceRow>();

  for (const [index, row] of evidenceRows.entries()) {
    if (row.validationRunId !== validationRunId) {
      throw new Error("Validation evidence belongs to another Run");
    }
    const result = results[index];
    if (result === undefined) throw new Error("Validation Phase Result was not decoded");
    const key = positionKey(result.phase, result.producer);
    if (evidenceByPosition.has(key)) {
      throw new Error("Validation Phase Result position is duplicated");
    }
    evidenceByPosition.set(key, row);
    const artifacts: unknown = JSON.parse(row.artifacts) as unknown;
    if (!Array.isArray(artifacts)) throw new Error("Stored evidence is not an array");
    for (const value of artifacts) {
      if (typeof value !== "object" || value === null || Array.isArray(value)) {
        throw new Error("Artifact is not an object");
      }
      const artifact = value as {
        readonly path?: unknown;
        readonly originalBytes?: unknown;
        readonly storedBytes?: unknown;
      };
      if (
        typeof artifact.path !== "string" ||
        typeof artifact.originalBytes !== "number" ||
        typeof artifact.storedBytes !== "number"
      ) {
        throw new Error("Artifact fields are invalid");
      }
      const identity = {
        validationRunId: row.validationRunId,
        phase: result.phase,
        producer: result.producer,
        fileName: artifact.path.split("/").at(-1) ?? "",
      } as const;
      const record = {
        ref: validationArtifactRef(identity),
        path: artifact.path,
        originalBytes: artifact.originalBytes,
        storedBytes: artifact.storedBytes,
        truncated: artifact.storedBytes < artifact.originalBytes,
        validationRunId: row.validationRunId,
        phase: result.phase,
        producer: result.producer,
      };
      assertValidationArtifactRecord(record);
      artifactRefs.add(record.ref);
    }
  }
  for (const [index, row] of evidenceRows.entries()) {
    if (row.validationRunId !== validationRunId) {
      throw new Error("Validation evidence belongs to another Run");
    }
    const result = results[index];
    if (result === undefined) throw new Error("Validation Phase Result was not decoded");
    const key = positionKey(result.phase, result.producer);
    const findings: unknown = JSON.parse(row.findings) as unknown;
    if (!Array.isArray(findings)) throw new Error("Stored evidence is not an array");
    for (const finding of findings) decodeValidationFindingEvidence(finding, artifactRefs);
    if (findings.length > 0) findingsByPosition.set(key, findings.length);
    if (row.toolingFailure !== null) {
      const failure: unknown = JSON.parse(row.toolingFailure) as unknown;
      if (typeof failure !== "object" || failure === null || Array.isArray(failure)) {
        throw new Error("Tooling Failure is not an object");
      }
      const value = failure as {
        readonly errorKind?: unknown;
        readonly operationName?: unknown;
        readonly errorMessage?: unknown;
      };
      if (
        typeof value.errorKind !== "string" ||
        typeof value.operationName !== "string" ||
        typeof value.errorMessage !== "string"
      ) {
        throw new Error("Tooling Failure fields are invalid");
      }
      assertValidationToolingFailureEvidence({
        errorKind: value.errorKind,
        operationName: value.operationName,
        errorMessage: value.errorMessage,
      });
      toolingPositions.add(key);
    }
  }

  const resultByPosition = new Map(
    results.map((result) => [positionKey(result.phase, result.producer), result]),
  );
  const reviewerInvocations = new Map<string, ReviewerInvocationEvidenceRow[]>();
  for (const row of reviewerInvocationRows) {
    if (row.validationRunId !== validationRunId) {
      throw new Error("Reviewer Invocation belongs to another Run");
    }
    const phase = decodeValidationPhase(row.phase);
    const key = positionKey(phase, row.producer);
    const positionRows = reviewerInvocations.get(key) ?? [];
    positionRows.push(row);
    reviewerInvocations.set(key, positionRows);
    if (phase === validationPhase.acceptanceReview || phase === validationPhase.specialistReview) {
      if (!resultByPosition.has(key)) {
        throw new Error("Every linked reviewer position requires its final Phase Result");
      }
      if (row.changeOwned !== 1 || row.settledAt === null || row.settlementKind === null) {
        throw new Error(
          "Every linked reviewer Invocation must be Change-owned and settled before completion",
        );
      }
    }
  }

  const phaseToolingFailureCount = toolingPositions.size;
  if (runToolingFailure !== null) {
    const failure: unknown = JSON.parse(runToolingFailure) as unknown;
    if (typeof failure !== "object" || failure === null || Array.isArray(failure)) {
      throw new Error("Tooling Failure is not an object");
    }
    const value = failure as {
      readonly errorKind?: unknown;
      readonly operationName?: unknown;
      readonly errorMessage?: unknown;
    };
    if (
      typeof value.errorKind !== "string" ||
      typeof value.operationName !== "string" ||
      typeof value.errorMessage !== "string"
    ) {
      throw new Error("Tooling Failure fields are invalid");
    }
    assertValidationToolingFailureEvidence({
      errorKind: value.errorKind,
      operationName: value.operationName,
      errorMessage: value.errorMessage,
    });
  }
  if (
    phaseToolingFailureCount !== evidenceRows.filter((row) => row.toolingFailure !== null).length
  ) {
    throw new Error("Validation Tooling Failure evidence is inconsistent");
  }

  for (const result of results) {
    const key = positionKey(result.phase, result.producer);
    const hasFinding = findingsByPosition.has(key);
    const hasToolingFailure = toolingPositions.has(key);
    if (result.outcome === "passed" && (hasFinding || hasToolingFailure)) {
      throw new Error("A passing Validation Phase Result contains failure evidence");
    }
    if (
      result.outcome === "failed" &&
      (result.phase === validationPhase.acceptanceReview ||
        result.phase === validationPhase.specialistReview) &&
      hasFinding === hasToolingFailure
    ) {
      throw new Error("A failed reviewer Result requires either Findings or a Tooling Failure");
    }
    if (result.outcome === "failed" && !hasFinding && !hasToolingFailure) {
      throw new Error("A failed Validation Phase Result has no failure evidence");
    }
    if (
      result.phase === validationPhase.acceptanceReview ||
      result.phase === validationPhase.specialistReview
    ) {
      const invocations = reviewerInvocations.get(key) ?? [];
      const terminal = invocations.at(-1);
      if ((result.outcome === "passed" || hasFinding) && terminal?.settlementKind !== "returned") {
        throw new Error(
          "A passing reviewer Result or reviewer Finding requires a returned terminal Invocation",
        );
      }
      if (
        result.outcome === "failed" &&
        terminal === undefined &&
        !isPreDispatchReviewerIntegrityFailure(result.phase, evidenceByPosition.get(key))
      ) {
        throw new Error("A failed reviewer Result has no Agent Invocation evidence");
      }
    }
  }

  const reached = expected
    .map((group, index) => ({ group, index, count: countResults(group, resultByPosition) }))
    .filter(({ count }) => count > 0);
  const lastReached = reached.at(-1);
  let phaseOutcome: CandidateValidationOutcome;
  if (lastReached === undefined) {
    if (expected.length > 0 && runToolingFailure === null) {
      throw new Error("Validation Run has no result for its first configured phase");
    }
    phaseOutcome = "passed";
  } else {
    if (reached.length !== lastReached.index + 1) {
      throw new Error("Validation Phase Results skip a configured phase");
    }
    for (let index = 0; index < lastReached.index; index += 1) {
      const group = expected[index];
      if (group === undefined) throw new Error("Configured Validation phase is missing");
      requireCompletePassingGroup(group, resultByPosition);
    }
    const finalGroup = lastReached.group;
    const finalResults = resultsForGroup(finalGroup, resultByPosition);
    requireConfiguredPrefix(finalGroup, resultByPosition);
    validateSpecialistFailureBoundary(finalGroup, finalResults);
    const failed = finalResults.filter((result) => result.outcome === "failed");
    if (failed.length === 0) {
      if (finalResults.length !== finalGroup.producers.length) {
        throw new Error("A passing Validation phase is incomplete");
      }
      if (lastReached.index !== expected.length - 1) {
        throw new Error("Validation Run stopped after a passing phase");
      }
      phaseOutcome = "passed";
    } else {
      const hasPhaseToolingFailure = failed.some((result) =>
        toolingPositions.has(positionKey(result.phase, result.producer)),
      );
      phaseOutcome = hasPhaseToolingFailure ? "tooling_failed" : "blocked";
      if (
        finalGroup.phase !== validationPhase.specialistReview &&
        (phaseOutcome === "blocked" || finalGroup.phase !== validationPhase.checks) &&
        finalResults.length !== finalGroup.producers.length
      ) {
        throw new Error("Terminal Validation phase evidence is incomplete");
      }
    }
  }
  const evidencedOutcome = runToolingFailure === null ? phaseOutcome : "tooling_failed";
  if (evidencedOutcome !== outcome) {
    throw new Error(
      `Validation completion outcome ${outcome} does not match evidence ${evidencedOutcome}`,
    );
  }
};

const decodeOutcome = (value: string): "passed" | "failed" => {
  if (value === "passed" || value === "failed") return value;
  throw new Error("Validation Phase Result outcome is unsupported");
};

const expectedPhases = (changePolicy: ChangePolicy): readonly ExpectedPhase[] => [
  ...(changePolicy.prepare === null
    ? []
    : [{ phase: validationPhase.prepare, producers: ["prepare"] }]),
  ...(changePolicy.checks.length === 0
    ? []
    : [
        {
          phase: validationPhase.checks,
          producers: changePolicy.checks.map((check) => check.id),
        },
      ]),
  ...(changePolicy.reviewerConfiguration.acceptanceReview === null
    ? []
    : [{ phase: validationPhase.acceptanceReview, producers: ["acceptance"] }]),
  ...(changePolicy.reviewerConfiguration.specialistReviews.length === 0
    ? []
    : [
        {
          phase: validationPhase.specialistReview,
          producers: changePolicy.reviewerConfiguration.specialistReviews.map(
            (review) => review.id,
          ),
        },
      ]),
];

const positionKey = (phase: ValidationPhase, producer: string): string => `${phase}\0${producer}`;

const countResults = (
  group: ExpectedPhase,
  results: ReadonlyMap<string, { readonly outcome: "passed" | "failed" }>,
): number =>
  group.producers.filter((producer) => results.has(positionKey(group.phase, producer))).length;

const resultsForGroup = <T extends { readonly outcome: "passed" | "failed" }>(
  group: ExpectedPhase,
  results: ReadonlyMap<string, T>,
): readonly T[] =>
  group.producers.flatMap((producer) => {
    const result = results.get(positionKey(group.phase, producer));
    return result === undefined ? [] : [result];
  });

const validateSpecialistFailureBoundary = (
  group: ExpectedPhase,
  results: readonly { readonly outcome: "passed" | "failed" }[],
): void => {
  if (group.phase !== validationPhase.specialistReview) return;
  const firstFailure = results.findIndex((result) => result.outcome === "failed");
  if (firstFailure === -1) return;
  if (results.slice(firstFailure + 1).length > 0) {
    throw new Error("Specialist Validation results continue after the first failure");
  }
  if (
    results.length < group.producers.length &&
    results.filter((result) => result.outcome === "failed").length !== 1
  ) {
    throw new Error("Incomplete Specialist Validation results must contain one final failure");
  }
};

const requireCompletePassingGroup = (
  group: ExpectedPhase,
  results: ReadonlyMap<string, { readonly outcome: "passed" | "failed" }>,
): void => {
  const phaseResults = resultsForGroup(group, results);
  if (
    phaseResults.length !== group.producers.length ||
    phaseResults.some((result) => result.outcome !== "passed")
  ) {
    throw new Error("A phase before the terminal Validation phase did not pass completely");
  }
};

const requireConfiguredPrefix = (
  group: ExpectedPhase,
  results: ReadonlyMap<string, unknown>,
): void => {
  let missing = false;
  for (const producer of group.producers) {
    const present = results.has(positionKey(group.phase, producer));
    if (!present) missing = true;
    else if (missing) throw new Error("Validation phase results do not form a configured prefix");
  }
};

const invalid = (operationName: string, message: string) =>
  Effect.fail(new RepositoryPersistedDataInvalid({ operationName, cause: new Error(message) }));
