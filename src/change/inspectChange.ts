import { Effect } from "effect";
import type { RepositoryStorageError } from "../contracts/repositoryStorageError.js";
import type { CandidateRecord } from "./candidate/candidate.js";
import type {
  CandidateValidationFinding,
  CandidateValidationRunRecord,
  CandidateValidationToolingFailure,
} from "./candidateValidation/candidateValidationRunStore.js";
import type { ChangeRecord } from "./change.js";
import type { ChangeQueryStore } from "./changePorts.js";
import type { ImplementationBlockerHistory } from "./implementationBlocker.js";
import type { ImplementationDecision } from "./implementationDecision.js";
import type { ChangeQueryValidationStore } from "./validation/changeValidationPorts.js";

export type ChangeQueryPort = {
  readonly list: ChangeQueryStore["listChanges"];
  readonly detail: (
    changeId: string,
  ) => Effect.Effect<ChangeDetail | undefined, RepositoryStorageError>;
  readonly taskProjection: (
    taskId: string,
  ) => Effect.Effect<ChangeTaskProjection | null, RepositoryStorageError>;
  readonly findings: (
    changeId: string,
  ) => Effect.Effect<ChangeFindings | undefined, RepositoryStorageError>;
  readonly validationRuns: (
    changeId: string,
  ) => Effect.Effect<ChangeValidationRunHistory | undefined, RepositoryStorageError>;
  readonly decisions: (
    changeId: string,
  ) => Effect.Effect<readonly ImplementationDecision[] | undefined, RepositoryStorageError>;
  readonly blockers: (
    changeId: string,
  ) => Effect.Effect<ImplementationBlockerHistory | undefined, RepositoryStorageError>;
};

export type ChangeActivity = "blocked" | "validating" | "ready" | "implementing";

export type ChangeTaskProjection = {
  readonly id: string;
  readonly activity?: ChangeActivity;
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

type ChangeQueryDependencies = {
  readonly changes: ChangeQueryStore;
  readonly validation: ChangeQueryValidationStore;
};

export const queryChangeTaskProjection = (
  dependencies: ChangeQueryDependencies,
  taskId: string,
): Effect.Effect<ChangeTaskProjection | null, RepositoryStorageError> =>
  Effect.gen(function* () {
    const change = yield* dependencies.changes.getChangeByTaskId(taskId);
    if (change === undefined) return null;
    if (change.state === "closed") return { id: change.id };
    if (change.activeBlocker !== null && change.activeBlocker !== undefined) {
      return { id: change.id, activity: "blocked" };
    }
    if ((yield* dependencies.validation.getActiveForChange(change.id)) !== undefined) {
      return { id: change.id, activity: "validating" };
    }

    const evidence = yield* dependencies.changes.getCurrentPassingEvidence(change.id);
    return {
      id: change.id,
      activity: evidence === undefined ? "implementing" : "ready",
    };
  });

export const queryChangeDetail = (
  dependencies: ChangeQueryDependencies,
  changeId: string,
): Effect.Effect<ChangeDetail | undefined, RepositoryStorageError> =>
  Effect.gen(function* () {
    const change = yield* dependencies.changes.getChangeById(changeId);
    if (change === undefined) return undefined;
    const candidate = yield* currentCandidate(dependencies.validation, changeId);
    const validationRun =
      candidate === null
        ? null
        : yield* currentValidationRun(dependencies.validation, candidate.id);
    return {
      change,
      currentCandidate: candidate,
      currentValidationRun: validationRun,
      findings:
        validationRun === null
          ? []
          : yield* dependencies.validation.listFindings(validationRun.id),
      toolingFailures:
        validationRun === null
          ? []
          : yield* dependencies.validation.listToolingFailures(validationRun.id),
    };
  });

export const queryChangeFindings = (
  dependencies: ChangeQueryDependencies,
  changeId: string,
): Effect.Effect<ChangeFindings | undefined, RepositoryStorageError> =>
  Effect.map(queryChangeDetail(dependencies, changeId), (detail) =>
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

export const queryChangeValidationRuns = (
  dependencies: ChangeQueryDependencies,
  changeId: string,
): Effect.Effect<ChangeValidationRunHistory | undefined, RepositoryStorageError> =>
  Effect.gen(function* () {
    const change = yield* dependencies.changes.getChangeById(changeId);
    if (change === undefined) return undefined;
    const candidates = yield* dependencies.validation.listCandidatesForChange(changeId);
    const validationRuns = yield* Effect.forEach(candidates, (candidate) =>
      dependencies.validation.listRunsForCandidate(candidate.id),
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
  persistence: ChangeQueryValidationStore,
  changeId: string,
): Effect.Effect<CandidateRecord | null, RepositoryStorageError> =>
  Effect.map(
    persistence.listCandidatesForChange(changeId),
    (candidates) => candidates.at(-1) ?? null,
  );

const currentValidationRun = (
  persistence: ChangeQueryValidationStore,
  candidateId: string,
): Effect.Effect<CandidateValidationRunRecord | null, RepositoryStorageError> =>
  Effect.map(persistence.listRunsForCandidate(candidateId), (runs) => runs.at(-1) ?? null);
