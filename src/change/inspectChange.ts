import { Effect } from "effect";
import type { RepositoryStorageError } from "../contracts/repositoryStorageError.js";
import type { CandidateRecord } from "./candidate/candidate.js";
import type {
  CandidateValidationFinding,
  CandidateValidationRunRecord,
  CandidateValidationToolingFailure,
} from "./candidateValidation/candidateValidationRunStore.js";
import type { ChangeRecord } from "./change.js";
import type { ChangeAuthorityPort, ChangeReadPort } from "./changePorts.js";
import type { ChangeValidationReadPort } from "./validation/changeValidationPorts.js";

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

type ChangeDetailDependencies = {
  readonly getChangeById: ChangeReadPort["getChangeById"];
  readonly getCurrentCandidateForChange: ChangeValidationReadPort["getCurrentCandidateForChange"];
  readonly getCurrentPassingEvidence: ChangeAuthorityPort["getCurrentPassingEvidence"];
  readonly getRunById: ChangeValidationReadPort["getRunById"];
  readonly listFindings: ChangeValidationReadPort["listFindings"];
  readonly listToolingFailures: ChangeValidationReadPort["listToolingFailures"];
};

export const queryChangeDetail = (
  dependencies: ChangeDetailDependencies,
  changeId: string,
): Effect.Effect<ChangeDetail | undefined, RepositoryStorageError> =>
  Effect.gen(function* () {
    const change = yield* dependencies.getChangeById(changeId);
    if (change === undefined) return undefined;
    const candidate = (yield* dependencies.getCurrentCandidateForChange(changeId)) ?? null;
    const passingEvidence =
      candidate === null
        ? undefined
        : yield* dependencies.getCurrentPassingEvidence(changeId, { candidateId: candidate.id });
    const validationRun =
      passingEvidence === undefined
        ? null
        : ((yield* dependencies.getRunById(passingEvidence.validationRunId)) ?? null);
    return {
      change,
      currentCandidate: candidate,
      currentValidationRun: validationRun,
      findings: validationRun === null ? [] : yield* dependencies.listFindings(validationRun.id),
      toolingFailures:
        validationRun === null ? [] : yield* dependencies.listToolingFailures(validationRun.id),
    };
  });

export const queryChangeFindings = (
  dependencies: ChangeDetailDependencies,
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

type ChangeValidationRunsDependencies = {
  readonly getChangeById: ChangeReadPort["getChangeById"];
  readonly listCandidatesForChange: ChangeValidationReadPort["listCandidatesForChange"];
  readonly listRunsForCandidate: ChangeValidationReadPort["listRunsForCandidate"];
};

export const queryChangeValidationRuns = (
  dependencies: ChangeValidationRunsDependencies,
  changeId: string,
): Effect.Effect<ChangeValidationRunHistory | undefined, RepositoryStorageError> =>
  Effect.gen(function* () {
    const change = yield* dependencies.getChangeById(changeId);
    if (change === undefined) return undefined;
    const candidates = yield* dependencies.listCandidatesForChange(changeId);
    const validationRuns = yield* Effect.forEach(candidates, (candidate) =>
      dependencies.listRunsForCandidate(candidate.id),
    );
    return {
      change,
      validationRuns: validationRuns.flat().toSorted((left, right) => left.id - right.id),
    };
  });
