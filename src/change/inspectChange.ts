import { Effect } from "effect";

import type { CandidateRecord } from "../candidate/candidate.js";
import type {
  CandidateValidationFinding,
  CandidateValidationRunRecord,
  CandidateValidationToolingFailure,
} from "../candidateValidation/candidateValidationRunStore.js";
import type { ChangeValidationPersistence } from "../changeValidation/changeValidationPersistence.js";
import type { RepositoryStorageError } from "../repositoryStorageError.js";
import type { ChangeRecord } from "./change.js";
import type { ChangeStore } from "./changeStore.js";

export type ChangeInspection = {
  readonly list: (input: {
    readonly repositoryCommonDirectory: string;
    readonly includeClosed: boolean;
  }) => readonly ChangeRecord[];
  readonly inspect: (
    changeId: string,
  ) => Effect.Effect<ChangeDetail | undefined, RepositoryStorageError>;
  readonly inspectTaskProjection: (taskId: string) => ChangeTaskProjection | null;
  readonly findings: (
    changeId: string,
  ) => Effect.Effect<ChangeFindings | undefined, RepositoryStorageError>;
  readonly validationRuns: (
    changeId: string,
  ) => Effect.Effect<ChangeValidationRunHistory | undefined, RepositoryStorageError>;
};

export type ChangeTaskProjection = {
  readonly id: string;
  readonly state: ChangeRecord["state"];
  readonly readiness: ChangeRecord["readiness"];
};

export type ChangeDetail = {
  readonly change: ChangeRecord;
  readonly currentCandidate: CandidateRecord | null;
  readonly currentValidationRun: CandidateValidationRunRecord | null;
  readonly findings: readonly CandidateValidationFinding[];
  readonly toolingFailures: readonly CandidateValidationToolingFailure[];
};

export type ChangeFindings = {
  readonly change: ChangeRecord;
  readonly candidate: CandidateRecord | null;
  readonly validationRun: CandidateValidationRunRecord | null;
  readonly findings: readonly CandidateValidationFinding[];
  readonly toolingFailures: readonly CandidateValidationToolingFailure[];
};

export type ChangeValidationRunHistory = {
  readonly change: ChangeRecord;
  readonly validationRuns: readonly CandidateValidationRunRecord[];
};

export const openChangeInspection = (input: {
  readonly changeStore: ChangeStore;
  readonly persistence: ChangeValidationPersistence;
}): ChangeInspection => ({
  list: input.changeStore.listChanges,
  inspect: (changeId) => inspectChange(input, changeId),
  inspectTaskProjection: (taskId) => {
    const change = input.changeStore.getChangeByTaskId(taskId);
    return change === undefined
      ? null
      : { id: change.id, state: change.state, readiness: change.readiness };
  },
  findings: (changeId) => inspectFindings(input, changeId),
  validationRuns: (changeId) => inspectValidationRuns(input, changeId),
});

const inspectChange = (
  dependencies: {
    readonly changeStore: ChangeStore;
    readonly persistence: ChangeValidationPersistence;
  },
  changeId: string,
): Effect.Effect<ChangeDetail | undefined, RepositoryStorageError> =>
  Effect.gen(function* () {
    const change = dependencies.changeStore.getChangeById(changeId);
    if (change === undefined) return undefined;
    const candidate = yield* currentCandidate(dependencies.persistence, changeId);
    const validationRun =
      candidate === null
        ? null
        : yield* currentValidationRun(dependencies.persistence, candidate.id);
    return {
      change,
      currentCandidate: candidate,
      currentValidationRun: validationRun,
      findings:
        validationRun === null
          ? []
          : yield* dependencies.persistence.listFindings(validationRun.id),
      toolingFailures:
        validationRun === null
          ? []
          : yield* dependencies.persistence.listToolingFailures(validationRun.id),
    };
  });

const inspectFindings = (
  dependencies: {
    readonly changeStore: ChangeStore;
    readonly persistence: ChangeValidationPersistence;
  },
  changeId: string,
): Effect.Effect<ChangeFindings | undefined, RepositoryStorageError> =>
  Effect.map(inspectChange(dependencies, changeId), (detail) =>
    detail === undefined
      ? undefined
      : {
          change: detail.change,
          candidate: detail.currentCandidate,
          validationRun: detail.currentValidationRun,
          findings: detail.findings,
          toolingFailures: detail.toolingFailures,
        },
  );

const inspectValidationRuns = (
  dependencies: {
    readonly changeStore: ChangeStore;
    readonly persistence: ChangeValidationPersistence;
  },
  changeId: string,
): Effect.Effect<ChangeValidationRunHistory | undefined, RepositoryStorageError> =>
  Effect.gen(function* () {
    const change = dependencies.changeStore.getChangeById(changeId);
    if (change === undefined) return undefined;
    const candidates = yield* dependencies.persistence.listCandidatesForChange(changeId);
    const validationRuns = yield* Effect.forEach(candidates, (candidate) =>
      dependencies.persistence.listRunsForCandidate(candidate.id),
    );
    return {
      change,
      validationRuns: validationRuns
        .flat()
        .toSorted(
          (left, right) =>
            left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id),
        ),
    };
  });

const currentCandidate = (
  persistence: ChangeValidationPersistence,
  changeId: string,
): Effect.Effect<CandidateRecord | null, RepositoryStorageError> =>
  Effect.map(
    persistence.listCandidatesForChange(changeId),
    (candidates) => candidates.at(-1) ?? null,
  );

const currentValidationRun = (
  persistence: ChangeValidationPersistence,
  candidateId: string,
): Effect.Effect<CandidateValidationRunRecord | null, RepositoryStorageError> =>
  Effect.map(persistence.listRunsForCandidate(candidateId), (runs) => runs.at(-1) ?? null);
