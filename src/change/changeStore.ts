import type { ChangeCleanup, ChangeOwnedPullRequest, ChangePublicationTarget } from "./change.js";
import type { ObservedMergedChangeEvidence } from "./ownedPullRequestClassifier.js";

export type ListChangesInput = {
  readonly repositoryCommonDirectory: string;
  readonly includeClosed: boolean;
};

export type CompleteMergedChangeInput = {
  readonly changeId: string;
  readonly now: string;
  readonly observed: ObservedMergedChangeEvidence;
};

export type CancelChangeInput = {
  readonly changeId: string;
  readonly reason: string;
  readonly now: string;
};

export type RecordChangeCleanupInput = {
  readonly changeId: string;
  readonly cleanup: ChangeCleanup;
  readonly now: string;
};

export type BeginChangePublicationInput = {
  readonly changeId: string;
  readonly candidateId: string;
  readonly validationRunId: string;
  readonly target: ChangePublicationTarget;
  readonly headBranch: string;
  readonly expectedHeadSha: string;
  readonly now: string;
};

export type ReplacePendingChangePublicationInput = BeginChangePublicationInput & {
  readonly expectedCurrentCandidateId: string;
  readonly expectedCurrentValidationRunId: string;
  readonly expectedCurrentHeadSha: string;
  readonly expectedCurrentHeadBranch: string;
  readonly expectedCurrentTarget: ChangePublicationTarget;
};

export type RecordPublishedPullRequestInput = BeginChangePublicationInput & {
  readonly pullRequest: ChangeOwnedPullRequest;
  readonly previousExpectedHeadSha?: string;
  readonly previousCandidateId?: string;
  readonly previousValidationRunId?: string;
  readonly previousPullRequestNumber?: number;
  readonly changeBaseSha?: string;
};
