import { Effect } from "effect";

import type { CandidateRecord } from "./candidate/candidate.js";
import type {
  CandidateValidationFinding,
  CandidateValidationRunRecord,
  CandidateValidationToolingFailure,
} from "./candidateValidation/candidateValidationRunStore.js";
import type { ChangeValidationPersistence } from "./validation/changeValidationPersistence.js";
import type { RepositoryStorageError } from "../contracts/repositoryStorageError.js";
import type { CandidatePublicationRecord, ChangeRecord } from "./change.js";
import type { ChangePersistence, RecordImplementationDecisionResult } from "./changePersistence.js";
import type { ImplementationDecision } from "./implementationDecision.js";
import type { ImplementationBlockerHistory } from "./implementationBlocker.js";

export type ChangeInspection = {
  readonly list: (input: {
    readonly repositoryCommonDirectory: string;
    readonly includeClosed: boolean;
  }) => Effect.Effect<readonly ChangeRecord[], RepositoryStorageError>;
  readonly inspect: (
    changeId: string,
  ) => Effect.Effect<ChangeDetail | undefined, RepositoryStorageError>;
  readonly inspectTaskProjection: (
    taskId: string,
  ) => Effect.Effect<ChangeTaskProjection | null, RepositoryStorageError>;
  readonly findings: (
    changeId: string,
  ) => Effect.Effect<ChangeFindings | undefined, RepositoryStorageError>;
  readonly validationRuns: (
    changeId: string,
  ) => Effect.Effect<ChangeValidationRunHistory | undefined, RepositoryStorageError>;
  readonly publications: (
    changeId: string,
  ) => Effect.Effect<readonly CandidatePublicationRecord[] | undefined, RepositoryStorageError>;
  readonly decisions: (
    changeId: string,
  ) => Effect.Effect<readonly ImplementationDecision[] | undefined, RepositoryStorageError>;
  readonly blockers: (
    changeId: string,
  ) => Effect.Effect<ImplementationBlockerHistory | undefined, RepositoryStorageError>;
  readonly raiseBlocker: (input: {
    readonly changeId: string;
    readonly content: string;
    readonly now: string;
  }) => Effect.Effect<
    import("./changePersistence.js").ImplementationBlockerMutationResult,
    RepositoryStorageError
  >;
  readonly resolveBlocker: (input: {
    readonly changeId: string;
    readonly content: string;
    readonly now: string;
  }) => Effect.Effect<
    import("./changePersistence.js").ImplementationBlockerMutationResult,
    RepositoryStorageError
  >;
  readonly addDecision: (
    input: import("./changePersistence.js").RecordImplementationDecisionInput,
  ) => Effect.Effect<RecordImplementationDecisionResult, RepositoryStorageError>;
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

export const openChangeInspection = (input: {
  readonly changePersistence: ChangePersistence;
  readonly persistence: ChangeValidationPersistence;
}): ChangeInspection => ({
  list: input.changePersistence.listChanges,
  inspect: (changeId) => inspectChange(input, changeId),
  inspectTaskProjection: (taskId) => inspectTaskProjection(input, taskId),
  findings: (changeId) => inspectFindings(input, changeId),
  validationRuns: (changeId) => inspectValidationRuns(input, changeId),
  publications: (changeId) =>
    input.changePersistence
      .getChangeById(changeId)
      .pipe(
        Effect.flatMap((change) =>
          change === undefined
            ? Effect.succeed(undefined)
            : input.changePersistence.listCandidatePublications(changeId),
        ),
      ),
  decisions: (changeId) =>
    input.changePersistence
      .getChangeById(changeId)
      .pipe(
        Effect.flatMap((change) =>
          change === undefined
            ? Effect.succeed(undefined)
            : input.changePersistence.listImplementationDecisions(changeId),
        ),
      ),
  blockers: input.changePersistence.listImplementationBlockers,
  raiseBlocker: input.changePersistence.raiseImplementationBlocker,
  resolveBlocker: input.changePersistence.resolveImplementationBlocker,
  addDecision: (decision) => input.changePersistence.recordImplementationDecision(decision),
});

const inspectTaskProjection = (
  dependencies: {
    readonly changePersistence: ChangePersistence;
    readonly persistence: ChangeValidationPersistence;
  },
  taskId: string,
): Effect.Effect<ChangeTaskProjection | null, RepositoryStorageError> =>
  Effect.gen(function* () {
    const change = yield* dependencies.changePersistence.getChangeByTaskId(taskId);
    if (change === undefined) return null;
    if (change.state === "closed") return { id: change.id };
    if (change.activeBlocker !== null && change.activeBlocker !== undefined) {
      return { id: change.id, activity: "blocked" };
    }
    if ((yield* dependencies.persistence.getActiveForChange(change.id)) !== undefined) {
      return { id: change.id, activity: "validating" };
    }

    const candidates = yield* dependencies.persistence.listCandidatesForChange(change.id);
    const currentCandidate = candidates.at(-1);
    if (currentCandidate === undefined) {
      return { id: change.id, activity: "implementing" };
    }
    const validationRuns = yield* dependencies.persistence.listRunsForCandidate(
      currentCandidate.id,
    );
    const currentValidationRun = validationRuns.at(-1);
    return {
      id: change.id,
      activity:
        currentValidationRun?.state === "complete" && currentValidationRun.outcome === "passed"
          ? "ready"
          : "implementing",
    };
  });

const inspectChange = (
  dependencies: {
    readonly changePersistence: ChangePersistence;
    readonly persistence: ChangeValidationPersistence;
  },
  changeId: string,
): Effect.Effect<ChangeDetail | undefined, RepositoryStorageError> =>
  Effect.gen(function* () {
    const change = yield* dependencies.changePersistence.getChangeById(changeId);
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
    readonly changePersistence: ChangePersistence;
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
    readonly changePersistence: ChangePersistence;
    readonly persistence: ChangeValidationPersistence;
  },
  changeId: string,
): Effect.Effect<ChangeValidationRunHistory | undefined, RepositoryStorageError> =>
  Effect.gen(function* () {
    const change = yield* dependencies.changePersistence.getChangeById(changeId);
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
