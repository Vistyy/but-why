import { isDeepStrictEqual } from "node:util";

import type { CandidateStore } from "../candidate/candidateStore.js";
import type {
  CandidateValidationPolicySnapshot,
  CandidateValidationRunStore,
} from "../candidateValidation/candidateValidationRunStore.js";
import type {
  ChangeOwnedPullRequest,
  ChangePublicationTarget,
  ChangeRecord,
} from "../change/change.js";
import type { ChangeStore } from "../change/changeStore.js";

export type GitHubPullRequest = ChangeOwnedPullRequest & {
  readonly baseBranch: string;
  readonly headBranch: string;
  readonly headSha: string;
};

export type GitHubPullRequestRequest = {
  readonly owner: string;
  readonly repo: string;
  readonly remoteName: string;
  readonly baseBranch: string;
  readonly headBranch: string;
  readonly branchRef: string;
  readonly expectedHeadSha: string;
  readonly title: string;
  readonly body: string;
};

export type GitHubPullRequestMutationResult =
  | { readonly ok: true; readonly pullRequest: GitHubPullRequest }
  | {
      readonly ok: false;
      readonly code:
        | "local_head_mismatch"
        | "remote_head_mismatch"
        | "push_failed"
        | "remote_response_lost";
    };

export type GitHubPullRequestGateway = {
  readonly findPullRequests: (
    target: ChangePublicationTarget,
    headBranch: string,
  ) => readonly GitHubPullRequest[] | undefined;
  readonly getPullRequest: (
    target: ChangePublicationTarget,
    number: number,
  ) => GitHubPullRequest | undefined;
  readonly createPullRequest: (
    request: GitHubPullRequestRequest,
  ) => GitHubPullRequestMutationResult;
  readonly updatePullRequest: (
    input: GitHubPullRequestRequest & {
      readonly number: number;
      readonly expectedCurrentHeadSha: string;
    },
  ) => GitHubPullRequestMutationResult;
};

export type CommitSubjectResult =
  | { readonly ok: true; readonly subject: string | undefined }
  | { readonly ok: false };

export type CandidatePublicationGit = {
  readonly readBranchHead: (branchRef: string) => string | undefined;
  readonly readFirstNonMergeCommitSubject: (
    startingCommit: string,
    headSha: string,
  ) => CommitSubjectResult;
};

export type CandidatePublication = {
  readonly publish: (input: PublishCandidateInput) => PublishCandidateResult;
};

export type PublishCandidateInput = {
  readonly changeId: string;
  readonly candidateId: string;
  readonly validationRunId: string;
  readonly policy: CandidateValidationPolicySnapshot;
  readonly target: ChangePublicationTarget;
  readonly now: string;
};

export type PublishCandidateResult =
  | { readonly ok: true; readonly created: boolean; readonly pullRequest: ChangeOwnedPullRequest }
  | {
      readonly ok: false;
      readonly code:
        | "change_not_found"
        | "change_closed"
        | "candidate_not_found"
        | "candidate_does_not_belong_to_change"
        | "validation_evidence_invalid"
        | "branch_binding_invalid"
        | "current_head_mismatch"
        | "task_metadata_missing"
        | "commit_history_unavailable"
        | "publication_creation_unconfirmed"
        | "publication_lookup_ambiguous"
        | "publication_remote_mismatch"
        | "publication_state_conflict"
        | "publication_tooling_failed";
    };

export const openCandidatePublication = (input: {
  readonly changeStore: ChangeStore;
  readonly candidateStore: CandidateStore;
  readonly validationRunStore: CandidateValidationRunStore;
  readonly git: CandidatePublicationGit;
  readonly github: GitHubPullRequestGateway;
}): CandidatePublication => ({
  publish: (publicationInput) => publishCandidate(input, publicationInput),
});

const publishCandidate = (
  dependencies: {
    readonly changeStore: ChangeStore;
    readonly candidateStore: CandidateStore;
    readonly validationRunStore: CandidateValidationRunStore;
    readonly git: CandidatePublicationGit;
    readonly github: GitHubPullRequestGateway;
  },
  input: PublishCandidateInput,
): PublishCandidateResult => {
  const change = dependencies.changeStore.getChangeById(input.changeId);
  if (change === undefined) return { ok: false, code: "change_not_found" };
  if (change.state === "closed") return { ok: false, code: "change_closed" };
  const candidate = dependencies.candidateStore.getCandidateById(input.candidateId);
  if (candidate === undefined) return { ok: false, code: "candidate_not_found" };
  if (candidate.changeId !== change.id)
    return { ok: false, code: "candidate_does_not_belong_to_change" };
  if (!hasPassingEvidence(dependencies.validationRunStore, input, candidate.headSha)) {
    return { ok: false, code: "validation_evidence_invalid" };
  }
  const headBranch = branchName(change.branchRef);
  if (headBranch === undefined) return { ok: false, code: "branch_binding_invalid" };
  const metadata = metadataFor(
    change,
    candidate.id,
    input.validationRunId,
    candidate.headSha,
    dependencies.git,
  );
  if ("ok" in metadata) return metadata;

  if (change.publication === null) {
    return createPullRequest(dependencies, input, change, headBranch, candidate.headSha, metadata);
  }
  if (change.publication.pullRequest === null) {
    return recoverCreatedPullRequest(dependencies, input, change, headBranch, candidate.headSha);
  }
  return updateOrReusePullRequest(
    dependencies,
    input,
    change,
    headBranch,
    candidate.headSha,
    metadata,
  );
};

const hasPassingEvidence = (
  validationRunStore: CandidateValidationRunStore,
  input: PublishCandidateInput,
  headSha: string,
): boolean => {
  const run = validationRunStore.getRunById(input.validationRunId);
  return (
    run !== undefined &&
    run.candidateId === input.candidateId &&
    run.outcome === "passed" &&
    isDeepStrictEqual(run.policy, input.policy) &&
    headSha.length > 0
  );
};

const createPullRequest = (
  dependencies: Parameters<typeof publishCandidate>[0],
  input: PublishCandidateInput,
  change: ChangeRecord,
  headBranch: string,
  expectedHeadSha: string,
  metadata: PullRequestMetadata,
): PublishCandidateResult => {
  if (!hasExpectedHead(dependencies.git, change.branchRef, expectedHeadSha)) {
    return { ok: false, code: "current_head_mismatch" };
  }
  const pendingPublication = {
    ...publicationFacts(input, headBranch, expectedHeadSha),
    now: input.now,
  };
  const started = dependencies.changeStore.beginPublication(pendingPublication);
  if (!started.ok) return mapChangePublicationError(started.code);
  if (!started.created) {
    return recoverCreatedPullRequest(
      dependencies,
      input,
      started.change,
      headBranch,
      expectedHeadSha,
    );
  }
  if (!hasExpectedHead(dependencies.git, change.branchRef, expectedHeadSha)) {
    return releaseMovedPendingPublication(dependencies.changeStore, pendingPublication);
  }

  const created = dependencies.github.createPullRequest({
    ...requestFacts(input.target, change.branchRef, headBranch, expectedHeadSha),
    ...metadata,
  });
  if (!created.ok) {
    return createFailureResult(
      dependencies,
      input,
      started.change,
      headBranch,
      expectedHeadSha,
      pendingPublication,
      created.code,
    );
  }
  if (!matchesExpectedPullRequest(created.pullRequest, input.target, headBranch, expectedHeadSha)) {
    return { ok: false, code: "publication_remote_mismatch" };
  }
  return recordPullRequest(
    dependencies.changeStore,
    input,
    headBranch,
    expectedHeadSha,
    created.pullRequest,
  );
};

const releaseMovedPendingPublication = (
  changeStore: ChangeStore,
  pendingPublication: Parameters<ChangeStore["beginPublication"]>[0],
): PublishCandidateResult => {
  const released = changeStore.releasePendingPublication(pendingPublication);
  return released.ok
    ? { ok: false, code: "current_head_mismatch" }
    : mapChangePublicationError(released.code);
};

const createFailureResult = (
  dependencies: Parameters<typeof publishCandidate>[0],
  input: PublishCandidateInput,
  change: ChangeRecord,
  headBranch: string,
  expectedHeadSha: string,
  pendingPublication: Parameters<ChangeStore["beginPublication"]>[0],
  failure: Exclude<GitHubPullRequestMutationResult, { readonly ok: true }>["code"],
): PublishCandidateResult => {
  if (failure === "remote_response_lost") {
    return recoverCreatedPullRequest(dependencies, input, change, headBranch, expectedHeadSha);
  }
  const released = dependencies.changeStore.releasePendingPublication(pendingPublication);
  if (!released.ok) return mapChangePublicationError(released.code);
  if (failure === "local_head_mismatch") return { ok: false, code: "current_head_mismatch" };
  return failure === "remote_head_mismatch"
    ? { ok: false, code: "publication_remote_mismatch" }
    : { ok: false, code: "publication_tooling_failed" };
};

const recoverCreatedPullRequest = (
  dependencies: Parameters<typeof publishCandidate>[0],
  input: PublishCandidateInput,
  change: ChangeRecord,
  headBranch: string,
  expectedHeadSha: string,
): PublishCandidateResult => {
  const marker = change.publication;
  if (
    marker === null ||
    marker.pullRequest !== null ||
    marker.candidateId !== input.candidateId ||
    marker.validationRunId !== input.validationRunId ||
    !sameTarget(marker.target, input.target) ||
    marker.headBranch !== headBranch ||
    marker.expectedHeadSha !== expectedHeadSha
  ) {
    return { ok: false, code: "publication_state_conflict" };
  }
  const matches = dependencies.github.findPullRequests(input.target, headBranch);
  if (matches === undefined) return { ok: false, code: "publication_tooling_failed" };
  const exact = matches.filter((pullRequest) =>
    matchesExpectedPullRequest(pullRequest, input.target, headBranch, expectedHeadSha),
  );
  if (exact.length === 0) return { ok: false, code: "publication_creation_unconfirmed" };
  if (exact.length !== 1 || matches.length !== 1) {
    return { ok: false, code: "publication_lookup_ambiguous" };
  }
  const pullRequest = exact[0];
  if (pullRequest === undefined) throw new Error("Missing exact pull request");
  return recordPullRequest(
    dependencies.changeStore,
    input,
    headBranch,
    expectedHeadSha,
    pullRequest,
  );
};

const updateOrReusePullRequest = (
  dependencies: Parameters<typeof publishCandidate>[0],
  input: PublishCandidateInput,
  change: ChangeRecord,
  headBranch: string,
  expectedHeadSha: string,
  metadata: PullRequestMetadata,
): PublishCandidateResult => {
  const owned = change.publication;
  if (owned === null || owned.pullRequest === null) throw new Error("Missing owned pull request");
  if (!sameTarget(owned.target, input.target) || owned.headBranch !== headBranch) {
    return { ok: false, code: "publication_state_conflict" };
  }
  const remote = dependencies.github.getPullRequest(input.target, owned.pullRequest.number);
  if (remote === undefined) return { ok: false, code: "publication_tooling_failed" };
  if (!matchesExpectedPullRequest(remote, input.target, headBranch, owned.expectedHeadSha)) {
    return { ok: false, code: "publication_remote_mismatch" };
  }
  if (owned.expectedHeadSha === expectedHeadSha) {
    return owned.candidateId === input.candidateId &&
      owned.validationRunId === input.validationRunId
      ? { ok: true, created: false, pullRequest: owned.pullRequest }
      : { ok: false, code: "publication_state_conflict" };
  }
  if (!hasExpectedHead(dependencies.git, change.branchRef, expectedHeadSha)) {
    return { ok: false, code: "current_head_mismatch" };
  }
  const updated = dependencies.github.updatePullRequest({
    ...requestFacts(input.target, change.branchRef, headBranch, expectedHeadSha),
    ...metadata,
    number: owned.pullRequest.number,
    expectedCurrentHeadSha: owned.expectedHeadSha,
  });
  if (!updated.ok) {
    return updateFailureResult(
      dependencies,
      input,
      owned.expectedHeadSha,
      owned.pullRequest.number,
      headBranch,
      expectedHeadSha,
      updated.code,
    );
  }
  if (!matchesExpectedPullRequest(updated.pullRequest, input.target, headBranch, expectedHeadSha)) {
    return { ok: false, code: "publication_remote_mismatch" };
  }
  return recordPullRequest(
    dependencies.changeStore,
    input,
    headBranch,
    expectedHeadSha,
    updated.pullRequest,
    owned.expectedHeadSha,
  );
};

const updateFailureResult = (
  dependencies: Parameters<typeof publishCandidate>[0],
  input: PublishCandidateInput,
  previousExpectedHeadSha: string,
  pullRequestNumber: number,
  headBranch: string,
  expectedHeadSha: string,
  failure: Exclude<GitHubPullRequestMutationResult, { readonly ok: true }>["code"],
): PublishCandidateResult => {
  if (failure === "local_head_mismatch") return { ok: false, code: "current_head_mismatch" };
  if (failure !== "remote_response_lost" && failure !== "push_failed") {
    return { ok: false, code: "publication_tooling_failed" };
  }
  const recovered = dependencies.github.getPullRequest(input.target, pullRequestNumber);
  if (recovered === undefined) return { ok: false, code: "publication_tooling_failed" };
  if (!matchesExpectedPullRequest(recovered, input.target, headBranch, expectedHeadSha)) {
    return { ok: false, code: "publication_remote_mismatch" };
  }
  return recordPullRequest(
    dependencies.changeStore,
    input,
    headBranch,
    expectedHeadSha,
    recovered,
    previousExpectedHeadSha,
  );
};

type PullRequestMetadata = { readonly title: string; readonly body: string };

const metadataFor = (
  change: ChangeRecord,
  candidateId: string,
  validationRunId: string,
  headSha: string,
  git: CandidatePublicationGit,
): PullRequestMetadata | Extract<PublishCandidateResult, { readonly ok: false }> => {
  if (change.taskId !== null) {
    if (change.acceptanceContext === null) return { ok: false, code: "task_metadata_missing" };
    return {
      title: change.acceptanceContext.title,
      body: `Task: ${change.taskId}\nCandidate: ${candidateId}\nValidation Run: ${validationRunId}`,
    };
  }
  if (change.startingCommit === null) return { ok: false, code: "commit_history_unavailable" };
  const subject = git.readFirstNonMergeCommitSubject(change.startingCommit, headSha);
  if (!subject.ok) return { ok: false, code: "commit_history_unavailable" };
  return {
    title: subject.subject ?? `Change ${change.id.slice(0, 8)}`,
    body: `Change: ${change.id}\nCandidate: ${candidateId}\nValidation Run: ${validationRunId}`,
  };
};

const publicationFacts = (
  input: PublishCandidateInput,
  headBranch: string,
  expectedHeadSha: string,
) => ({
  changeId: input.changeId,
  candidateId: input.candidateId,
  validationRunId: input.validationRunId,
  target: input.target,
  headBranch,
  expectedHeadSha,
});

const requestFacts = (
  target: ChangePublicationTarget,
  branchRef: string,
  headBranch: string,
  expectedHeadSha: string,
): Omit<GitHubPullRequestRequest, "title" | "body"> => ({
  owner: target.owner,
  repo: target.repo,
  remoteName: target.remoteName,
  baseBranch: target.baseBranch,
  headBranch,
  branchRef,
  expectedHeadSha,
});

const recordPullRequest = (
  changeStore: ChangeStore,
  input: PublishCandidateInput,
  headBranch: string,
  expectedHeadSha: string,
  pullRequest: GitHubPullRequest,
  previousExpectedHeadSha?: string,
): PublishCandidateResult => {
  const recorded = changeStore.recordPublishedPullRequest({
    ...publicationFacts(input, headBranch, expectedHeadSha),
    pullRequest: { number: pullRequest.number, url: pullRequest.url },
    ...(previousExpectedHeadSha === undefined ? {} : { previousExpectedHeadSha }),
    now: input.now,
  });
  if (!recorded.ok) return mapChangePublicationError(recorded.code);
  const publication = recorded.change.publication;
  if (publication?.pullRequest === null || publication === null) {
    throw new Error("Published pull request was not stored");
  }
  return {
    ok: true,
    created: previousExpectedHeadSha === undefined,
    pullRequest: publication.pullRequest,
  };
};

const hasExpectedHead = (
  git: CandidatePublicationGit,
  branchRef: string,
  expectedHeadSha: string,
): boolean => git.readBranchHead(branchRef) === expectedHeadSha;

const branchName = (branchRef: string): string | undefined => {
  const prefix = "refs/heads/";
  const branch = branchRef.startsWith(prefix) ? branchRef.slice(prefix.length) : "";
  return branch.length > 0 ? branch : undefined;
};

const matchesExpectedPullRequest = (
  pullRequest: GitHubPullRequest,
  target: ChangePublicationTarget,
  headBranch: string,
  expectedHeadSha: string,
): boolean =>
  pullRequest.baseBranch === target.baseBranch &&
  pullRequest.headBranch === headBranch &&
  pullRequest.headSha === expectedHeadSha;

const sameTarget = (left: ChangePublicationTarget, right: ChangePublicationTarget): boolean =>
  left.owner === right.owner &&
  left.repo === right.repo &&
  left.baseBranch === right.baseBranch &&
  left.remoteName === right.remoteName;

const mapChangePublicationError = (
  code:
    | "change_not_found"
    | "change_closed"
    | "publication_already_owned"
    | "publication_state_conflict",
): Extract<PublishCandidateResult, { readonly ok: false }> =>
  code === "change_not_found" || code === "change_closed"
    ? { ok: false, code }
    : { ok: false, code: "publication_state_conflict" };
