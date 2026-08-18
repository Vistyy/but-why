import type * as SqlClient from "@effect/sql/SqlClient";
import { Effect } from "effect";

import type { CandidateValidationOutcome } from "../change/candidateValidation/candidateValidationRunStore.js";
import { type ValidationPhase, validationPhase } from "../change/validationRun/validationRun.js";
import { RepositoryPersistedDataInvalid } from "../contracts/repositoryStorageError.js";
import { decodePersisted } from "./sqliteTaskReadModel.js";
import {
  listValidationFindings,
  listValidationPhaseResults,
  listValidationToolingFailures,
} from "./sqliteValidationEvidenceStorage.js";
import { readValidationRunById } from "./sqliteValidationRunStorage.js";

type PhaseResultEvidenceRow = {
  readonly phase: string;
  readonly producer: string;
  readonly toolingFailure: string | null;
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
    const run = yield* readValidationRunById(sql, validationRunId, operationName, idPrefix);
    if (run === undefined) {
      return yield* invalid(operationName, "Validation Run does not exist");
    }
    const results = yield* listValidationPhaseResults(sql, validationRunId, idPrefix);
    const findings = yield* listValidationFindings(sql, validationRunId, idPrefix);
    const toolingFailures = yield* listValidationToolingFailures(sql, validationRunId, idPrefix);
    const evidenceRows = yield* sql<PhaseResultEvidenceRow>`
      SELECT phase, producer, tooling_failure AS toolingFailure
      FROM validation_phase_results
      WHERE validation_run_id = ${validationRunId}
    `;
    const runRows = yield* sql<{ readonly toolingFailure: string | null }>`
      SELECT run_tooling_failure AS toolingFailure
      FROM validation_runs WHERE id = ${validationRunId}
    `;
    const runToolingFailure = runRows[0]?.toolingFailure ?? null;

    yield* decodePersisted(operationName, () => {
      const expected = expectedPhases(run.policy);
      const resultByPosition = new Map(
        results.map((result) => [positionKey(result.phase, result.producer), result]),
      );
      const findingPositions = new Set(
        findings.map((finding) => positionKey(finding.phase, finding.producer)),
      );
      const toolingPositions = new Set(
        evidenceRows
          .filter((row) => row.toolingFailure !== null)
          .map((row) => positionKey(row.phase as ValidationPhase, row.producer)),
      );
      if (toolingFailures.length !== toolingPositions.size + (runToolingFailure === null ? 0 : 1)) {
        throw new Error("Validation Tooling Failure evidence is inconsistent");
      }

      for (const result of results) {
        const key = positionKey(result.phase, result.producer);
        const hasFinding = findingPositions.has(key);
        const hasToolingFailure = toolingPositions.has(key);
        if (result.outcome === "passed" && (hasFinding || hasToolingFailure)) {
          throw new Error("A passing Validation Phase Result contains failure evidence");
        }
        if (result.outcome === "failed" && !hasFinding && !hasToolingFailure) {
          throw new Error("A failed Validation Phase Result has no failure evidence");
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
          if (phaseOutcome === "blocked" || finalGroup.phase !== validationPhase.checks) {
            if (finalResults.length !== finalGroup.producers.length) {
              throw new Error("Terminal Validation phase evidence is incomplete");
            }
          }
        }
      }

      const evidencedOutcome = runToolingFailure === null ? phaseOutcome : "tooling_failed";
      if (evidencedOutcome !== outcome) {
        throw new Error(
          `Validation completion outcome ${outcome} does not match evidence ${evidencedOutcome}`,
        );
      }
    });
  }).pipe(Effect.asVoid);

const expectedPhases = (policy: {
  readonly prepare?: unknown;
  readonly checks: readonly { readonly id: string }[];
  readonly acceptanceReview?: unknown;
  readonly specialistReviews?: readonly { readonly id: string }[] | undefined;
}): readonly ExpectedPhase[] => [
  ...(policy.prepare === undefined
    ? []
    : [{ phase: validationPhase.prepare, producers: ["prepare"] }]),
  ...(policy.checks.length === 0
    ? []
    : [{ phase: validationPhase.checks, producers: policy.checks.map((check) => check.id) }]),
  ...(policy.acceptanceReview === undefined
    ? []
    : [{ phase: validationPhase.acceptanceReview, producers: ["acceptance"] }]),
  ...((policy.specialistReviews ?? []).length === 0
    ? []
    : [
        {
          phase: validationPhase.specialistReview,
          producers: (policy.specialistReviews ?? []).map((review) => review.id),
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
