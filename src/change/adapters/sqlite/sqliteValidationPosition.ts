import type * as SqlClient from "@effect/sql/SqlClient";
import type { SqlError } from "@effect/sql/SqlError";
import { Effect } from "effect";
import { RepositoryPersistedDataInvalid } from "../../../contracts/repositoryStorageError.js";
import type { CandidateValidationRunRecord } from "../../candidateValidation/candidateValidationRunStore.js";
import type { ChangePolicy } from "../../changePolicy.js";
import { type ValidationPhase, validationPhase } from "../../validationRun/validationRun.js";
import { readValidationExecutionAuthorityById } from "./sqliteValidationRunStorage.js";

export const decodeValidationPhase = (value: string): ValidationPhase => {
  if (Object.values(validationPhase).includes(value as ValidationPhase)) {
    return value as ValidationPhase;
  }
  throw new Error("Validation Phase is unsupported");
};

export const configuredValidationPosition = (
  phaseValue: string,
  producer: string,
  changePolicy: ChangePolicy,
): number => {
  switch (decodeValidationPhase(phaseValue)) {
    case validationPhase.prepare:
      if (producer !== "prepare") throw new Error("Prepare producer is invalid");
      if (changePolicy.prepare === null) throw new Error("Prepare Result is not configured");
      return 1;
    case validationPhase.checks: {
      const index = changePolicy.checks.findIndex((check) => check.id === producer);
      if (index < 0) throw new Error("Check Result is not configured");
      return index + 1;
    }
    case validationPhase.acceptanceReview:
      if (producer !== "acceptance") throw new Error("Acceptance Review producer is invalid");
      if (changePolicy.reviewerConfiguration.acceptanceReview === null) {
        throw new Error("Acceptance Review is not configured");
      }
      return 1;
    case validationPhase.specialistReview: {
      const index = changePolicy.reviewerConfiguration.specialistReviews.findIndex(
        (review) => review.id === producer,
      );
      if (index < 0) throw new Error("Specialist Review is not configured");
      return index + 1;
    }
  }
};

export const requireValidationPosition = (
  sql: SqlClient.SqlClient,
  input: {
    readonly validationRunId: number;
    readonly phase: string;
    readonly producer: string;
    readonly operationName: string;
    readonly idPrefix: string;
    readonly active?: boolean;
  },
): Effect.Effect<CandidateValidationRunRecord, SqlError | RepositoryPersistedDataInvalid> =>
  Effect.gen(function* () {
    const authority = yield* readValidationExecutionAuthorityById(
      sql,
      input.validationRunId,
      input.operationName,
      input.idPrefix,
    );
    if (authority === undefined) {
      return yield* invalid(input.operationName, "Validation position belongs to an unknown Run");
    }
    const { run, changePolicy } = authority;
    if (input.active === true && run.state !== "running") {
      return yield* invalid(input.operationName, "Validation position requires an active Run");
    }
    yield* Effect.try({
      try: () => configuredValidationPosition(input.phase, input.producer, changePolicy),
      catch: (cause) =>
        new RepositoryPersistedDataInvalid({ operationName: input.operationName, cause }),
    });
    return run;
  });

const invalid = (operationName: string, message: string) =>
  Effect.fail(new RepositoryPersistedDataInvalid({ operationName, cause: new Error(message) }));
