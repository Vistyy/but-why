import type { CandidateRecord } from "../candidate/candidate.js";
import type { CandidateStore } from "../candidate/candidateStore.js";
import type {
  CandidateValidationFinding,
  CandidateValidationRunRecord,
  CandidateValidationRunStore,
  CandidateValidationToolingFailure,
} from "../candidateValidation/candidateValidationRunStore.js";
import type { PublicTaskId } from "../task/taskId.js";
import type { ChangeRecord } from "./change.js";
import type { ChangeStore } from "./changeStore.js";

export type ChangeInspection = {
  readonly list: (input: {
    readonly repositoryCommonDirectory: string;
    readonly includeClosed: boolean;
  }) => readonly ChangeRecord[];
  readonly inspect: (changeId: string) => ChangeDetail | undefined;
  readonly inspectTaskProjection: (taskId: PublicTaskId) => ChangeTaskProjection | null;
  readonly findings: (changeId: string) => ChangeFindings | undefined;
  readonly validationRuns: (changeId: string) => ChangeValidationRunHistory | undefined;
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
  readonly candidateStore: CandidateStore;
  readonly runStore: CandidateValidationRunStore;
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
    readonly candidateStore: CandidateStore;
    readonly runStore: CandidateValidationRunStore;
  },
  changeId: string,
): ChangeDetail | undefined => {
  const change = dependencies.changeStore.getChangeById(changeId);
  if (change === undefined) return undefined;
  const candidate = currentCandidate(dependencies.candidateStore, changeId);
  const validationRun =
    candidate === null ? null : currentValidationRun(dependencies.runStore, candidate.id);
  return {
    change,
    currentCandidate: candidate,
    currentValidationRun: validationRun,
    findings: validationRun === null ? [] : dependencies.runStore.listFindings(validationRun.id),
    toolingFailures:
      validationRun === null ? [] : dependencies.runStore.listToolingFailures(validationRun.id),
  };
};

const inspectFindings = (
  dependencies: {
    readonly changeStore: ChangeStore;
    readonly candidateStore: CandidateStore;
    readonly runStore: CandidateValidationRunStore;
  },
  changeId: string,
): ChangeFindings | undefined => {
  const detail = inspectChange(dependencies, changeId);
  if (detail === undefined) return undefined;
  return {
    change: detail.change,
    candidate: detail.currentCandidate,
    validationRun: detail.currentValidationRun,
    findings: detail.findings,
    toolingFailures: detail.toolingFailures,
  };
};

const inspectValidationRuns = (
  dependencies: {
    readonly changeStore: ChangeStore;
    readonly candidateStore: CandidateStore;
    readonly runStore: CandidateValidationRunStore;
  },
  changeId: string,
): ChangeValidationRunHistory | undefined => {
  const change = dependencies.changeStore.getChangeById(changeId);
  if (change === undefined) return undefined;
  return {
    change,
    validationRuns: dependencies.candidateStore
      .listCandidatesForChange(changeId)
      .flatMap((candidate) => dependencies.runStore.listRunsForCandidate(candidate.id))
      .toSorted(
        (left, right) =>
          left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id),
      ),
  };
};

const currentCandidate = (
  candidateStore: CandidateStore,
  changeId: string,
): CandidateRecord | null => candidateStore.listCandidatesForChange(changeId).at(-1) ?? null;

const currentValidationRun = (
  runStore: CandidateValidationRunStore,
  candidateId: string,
): CandidateValidationRunRecord | null => runStore.listRunsForCandidate(candidateId).at(-1) ?? null;
