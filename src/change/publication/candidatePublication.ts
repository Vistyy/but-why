import { Effect } from "effect";
import type { RepositoryStorageError } from "../../contracts/repositoryStorageError.js";
import type { CandidateValidationPolicySnapshot } from "../candidateValidation/candidateValidationPolicySnapshot.js";
import type {
  ChangeOwnedPullRequest,
  ChangePublication,
  ChangePublicationTarget,
} from "../change.js";
import { branchNameForRef } from "../changeBranch.js";
import type {
  CandidatePublicationChange,
  CandidatePublicationPort,
  PendingCandidatePublicationChange,
  PublishedCandidatePublicationChange,
} from "../changePorts.js";
import { implementationDecisionMarkdown } from "../implementationDecision.js";
import {
  classifyOwnedPullRequest,
  type OwnedPublication,
  observeOwnedPullRequest,
} from "../ownedPullRequestClassifier.js";
import type {
  GitHubPullRequest,
  GitHubPullRequestGateway,
  GitHubPullRequestListResult,
  GitHubPullRequestMutationResult,
  GitHubPullRequestReadResult,
  GitHubPullRequestRequest,
  GitHubPullRequestUpdateConfirmationResult,
  PublicationFailureEvidence,
} from "../ownedPullRequestGateway.js";
export type CommitSubjectResult =
  | { readonly ok: true; readonly subject: string | undefined }
  | { readonly ok: false };

export type CandidatePublicationGit = {
  readonly readBranchHead: (branchRef: string) => string | undefined;
  readonly readFirstNonMergeCommitSubject: (
    startingCommit: string,
    headSha: string,
  ) => CommitSubjectResult;
  readonly containsCommit: (headSha: string, ancestorSha: string) => boolean;
};

export type CandidatePublication = {
  readonly publish: (
    input: PublishCandidateInput,
  ) => Effect.Effect<PublishCandidateResult, RepositoryStorageError>;
};

export type PublishCandidateInput = {
  readonly changeId: string;
  readonly candidateId: string;
  readonly validationRunId: string;
  readonly changeBaseSha: string;
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
      readonly evidence?: PublicationFailureEvidence;
      readonly recoveryEvidence?: PublicationFailureEvidence;
      readonly expectedRemoteHeadSha?: string;
      readonly observedRemoteHeadSha?: string;
    };

type Dependencies = {
  readonly changePersistence: CandidatePublicationPort;
  readonly git: CandidatePublicationGit;
  readonly github: GitHubPullRequestGateway;
  readonly delayBeforeConfirmation?: (milliseconds: number) => Effect.Effect<void>;
};
type PublicationEffect = Effect.Effect<PublishCandidateResult, RepositoryStorageError>;
type Metadata = { readonly title: string; readonly body: string };

export const openCandidatePublication = (dependencies: Dependencies): CandidatePublication => ({
  publish: (input) => publish(dependencies, input),
});

const publish = (dependencies: Dependencies, input: PublishCandidateInput): PublicationEffect =>
  Effect.gen(function* () {
    const change = yield* dependencies.changePersistence.getChangeById(input.changeId);
    if (change === undefined) return { ok: false, code: "change_not_found" };
    if (change.state === "closed") return { ok: false, code: "change_closed" };
    const evidence = yield* dependencies.changePersistence.getCurrentPassingEvidence(change.id, {
      candidateId: input.candidateId,
      validationRunId: input.validationRunId,
      changeBaseSha: input.changeBaseSha,
      policy: input.policy,
    });
    if (evidence === undefined) return { ok: false, code: "validation_evidence_invalid" };
    if (evidence.candidateId !== input.candidateId)
      return { ok: false, code: "candidate_does_not_belong_to_change" };
    if (evidence.validationRunId !== input.validationRunId)
      return { ok: false, code: "validation_evidence_invalid" };
    const publicationInput = { ...input, changeBaseSha: evidence.changeBaseSha };
    const headBranch = branchNameForRef(change.branchRef);
    if (headBranch === undefined) return { ok: false, code: "branch_binding_invalid" };
    const metadata = metadataFor(change, evidence.headSha, dependencies.git);
    if ("ok" in metadata) return metadata;
    const publication = change.publication;
    if (publication === null)
      return yield* create(
        dependencies,
        publicationInput,
        change,
        headBranch,
        evidence.headSha,
        metadata,
      );
    if (publication.pullRequest === null)
      return yield* recover(
        dependencies,
        publicationInput,
        { ...change, publication: { ...publication, pullRequest: null } },
        headBranch,
        evidence.headSha,
      );
    return yield* updateOrReuse(
      dependencies,
      publicationInput,
      { ...change, publication: { ...publication, pullRequest: publication.pullRequest } },
      headBranch,
      evidence.headSha,
      metadata,
    );
  });

const create = (
  dependencies: Dependencies,
  input: PublishCandidateInput,
  change: CandidatePublicationChange,
  headBranch: string,
  expectedHeadSha: string,
  metadata: Metadata,
): PublicationEffect =>
  Effect.gen(function* () {
    if (!hasExpectedHead(dependencies.git, change.branchRef, expectedHeadSha))
      return { ok: false, code: "current_head_mismatch" };
    const pending = { ...facts(input, headBranch, expectedHeadSha), now: input.now };
    const started = yield* dependencies.changePersistence.beginPublication(pending);
    if (!started.ok) return mapPersistenceError(started.code);
    if (!started.created)
      return yield* recover(dependencies, input, started.change, headBranch, expectedHeadSha);
    if (!hasExpectedHead(dependencies.git, change.branchRef, expectedHeadSha))
      return yield* release(dependencies, pending, "current_head_mismatch");
    const created = dependencies.github.createPullRequest({
      ...request(input.target, change.branchRef, headBranch, expectedHeadSha),
      ...metadata,
    });
    if (!created.ok)
      return yield* createFailure(
        dependencies,
        input,
        started.change,
        headBranch,
        expectedHeadSha,
        pending,
        created,
      );
    if (
      !isExactOpenPullRequest(
        created.pullRequest,
        created.pullRequest.number,
        input.target,
        headBranch,
        expectedHeadSha,
      )
    )
      return {
        ok: false,
        code: "publication_remote_mismatch",
        evidence: conflictingMutationEvidence("pull_request_creation"),
        expectedRemoteHeadSha: expectedHeadSha,
        observedRemoteHeadSha: created.pullRequest.headSha,
      };
    return yield* record(dependencies, input, headBranch, expectedHeadSha, created.pullRequest);
  });

const createFailure = (
  dependencies: Dependencies,
  input: PublishCandidateInput,
  _change: CandidatePublicationChange,
  headBranch: string,
  expectedHeadSha: string,
  pending: Parameters<CandidatePublicationPort["beginPublication"]>[0],
  failure: Exclude<GitHubPullRequestMutationResult, { readonly ok: true }>,
): PublicationEffect => {
  if (
    failure.code === "remote_response_lost" ||
    failure.code === "remote_response_unusable" ||
    failure.code === "remote_rejected"
  )
    return confirmCreation(dependencies, input, headBranch, expectedHeadSha, failure.evidence);
  if (failure.code === "remote_head_mismatch" || failure.code === "remote_lookup_failed")
    return retainFailure(dependencies, pending, failure);
  const code =
    failure.code === "local_head_mismatch" ? "current_head_mismatch" : "publication_tooling_failed";
  return releaseWithDetails(dependencies, pending, code, failure);
};

const releaseWithDetails = (
  dependencies: Dependencies,
  pending: Parameters<CandidatePublicationPort["beginPublication"]>[0],
  code: Extract<PublishCandidateResult, { readonly ok: false }>["code"],
  failure: Exclude<GitHubPullRequestMutationResult, { readonly ok: true }>,
): PublicationEffect =>
  Effect.map(dependencies.changePersistence.releasePendingPublication(pending), (released) =>
    released.ok
      ? {
          ok: false,
          code,
          ...(failure.evidence === undefined ? {} : { evidence: failure.evidence }),
          ...(failure.observedRemoteHeadSha === undefined
            ? {}
            : {
                expectedRemoteHeadSha: pending.expectedHeadSha,
                observedRemoteHeadSha: failure.observedRemoteHeadSha,
              }),
        }
      : mapPersistenceError(released.code),
  );

const releaseWithEvidence = (
  dependencies: Dependencies,
  pending: Parameters<CandidatePublicationPort["beginPublication"]>[0],
  code: Extract<PublishCandidateResult, { readonly ok: false }>["code"],
  failureEvidence?: PublicationFailureEvidence,
): PublicationEffect =>
  Effect.map(dependencies.changePersistence.releasePendingPublication(pending), (released) =>
    released.ok
      ? { ok: false, code, ...(failureEvidence === undefined ? {} : { evidence: failureEvidence }) }
      : mapPersistenceError(released.code),
  );

const release = (
  dependencies: Dependencies,
  pending: Parameters<CandidatePublicationPort["beginPublication"]>[0],
  code: Extract<PublishCandidateResult, { readonly ok: false }>["code"],
): PublicationEffect =>
  Effect.map(dependencies.changePersistence.releasePendingPublication(pending), (released) =>
    released.ok ? { ok: false, code } : mapPersistenceError(released.code),
  );

const recover = (
  dependencies: Dependencies,
  input: PublishCandidateInput,
  change: PendingCandidatePublicationChange,
  headBranch: string,
  expectedHeadSha: string,
): PublicationEffect =>
  Effect.gen(function* () {
    const marker = change.publication;
    const foundResult = readPullRequestList(dependencies.github, marker.target, marker.headBranch);
    if (!foundResult.ok) {
      return {
        ok: false,
        code: "publication_tooling_failed",
        evidence: foundResult.evidence,
      };
    }
    const found = foundResult.pullRequests;
    if (!sameTarget(marker.target, input.target))
      return { ok: false, code: "publication_state_conflict" };
    const selected = selectRecoveredPullRequest(
      found,
      marker.target,
      marker.headBranch,
      marker.expectedHeadSha,
    );
    if (!selected.ok) {
      if (selected.code !== "publication_creation_unconfirmed") return selected;
      const replacement = yield* dependencies.changePersistence.replacePendingPublication({
        ...facts(input, headBranch, expectedHeadSha),
        now: input.now,
        expectedCurrentCandidateId: marker.candidateId,
        expectedCurrentValidationRunId: marker.validationRunId,
        expectedCurrentHeadSha: marker.expectedHeadSha,
        expectedCurrentHeadBranch: marker.headBranch,
        expectedCurrentTarget: marker.target,
      });
      if (!replacement.ok) return mapPersistenceError(replacement.code);
      return yield* createRecoveryAttempt(
        dependencies,
        input,
        headBranch,
        expectedHeadSha,
        replacement.change,
      );
    }
    if (
      marker.candidateId === input.candidateId &&
      marker.validationRunId === input.validationRunId
    )
      return yield* record(dependencies, input, headBranch, expectedHeadSha, selected.pullRequest);
    if (!dependencies.git.containsCommit(expectedHeadSha, selected.pullRequest.headSha))
      return {
        ok: false,
        code: "publication_remote_mismatch",
        expectedRemoteHeadSha: expectedHeadSha,
        observedRemoteHeadSha: selected.pullRequest.headSha,
      };
    const owned: Published = {
      ...marker,
      pullRequest: { number: selected.pullRequest.number, url: selected.pullRequest.url },
    };
    const metadata = metadataFor(change, expectedHeadSha, dependencies.git);
    if ("ok" in metadata) return metadata;
    return yield* executePullRequestUpdate(
      dependencies,
      input,
      change,
      owned,
      headBranch,
      expectedHeadSha,
      metadata,
    );
  });

const createRecoveryAttempt = (
  dependencies: Dependencies,
  input: PublishCandidateInput,
  headBranch: string,
  expectedHeadSha: string,
  change: CandidatePublicationChange,
): PublicationEffect =>
  Effect.gen(function* () {
    const metadata = metadataFor(change, expectedHeadSha, dependencies.git);
    if ("ok" in metadata) return metadata;
    const pending = { ...facts(input, headBranch, expectedHeadSha), now: input.now };
    const created = dependencies.github.createPullRequest({
      ...request(input.target, change.branchRef, headBranch, expectedHeadSha),
      allowExistingRemoteHead: true,
      ...metadata,
    });
    if (
      created.ok &&
      isExactOpenPullRequest(
        created.pullRequest,
        created.pullRequest.number,
        input.target,
        headBranch,
        expectedHeadSha,
      )
    )
      return yield* record(dependencies, input, headBranch, expectedHeadSha, created.pullRequest);
    if (
      !created.ok &&
      (created.code === "remote_response_lost" ||
        created.code === "remote_response_unusable" ||
        created.code === "remote_rejected")
    )
      return yield* confirmCreation(
        dependencies,
        input,
        headBranch,
        expectedHeadSha,
        created.evidence,
      );
    if (!created.ok) {
      if (created.code === "push_failed" || created.code === "local_head_mismatch")
        return yield* releaseWithEvidence(
          dependencies,
          pending,
          created.code === "push_failed" ? "publication_tooling_failed" : "current_head_mismatch",
          created.evidence,
        );
      return yield* retainFailure(dependencies, pending, created);
    }
    return {
      ok: false,
      code: "publication_remote_mismatch",
      evidence: conflictingMutationEvidence("pull_request_creation"),
      expectedRemoteHeadSha: expectedHeadSha,
      observedRemoteHeadSha: created.pullRequest.headSha,
    };
  });

const confirmCreation = (
  dependencies: Dependencies,
  input: PublishCandidateInput,
  headBranch: string,
  expectedHeadSha: string,
  failureEvidence?: PublicationFailureEvidence,
): PublicationEffect => {
  const found = readPullRequestList(dependencies.github, input.target, headBranch);
  const selected = selectRecoveredPullRequest(
    found.ok ? found.pullRequests : undefined,
    input.target,
    headBranch,
    expectedHeadSha,
  );
  return selected.ok
    ? record(dependencies, input, headBranch, expectedHeadSha, selected.pullRequest)
    : Effect.succeed({
        ...selected,
        ...(failureEvidence === undefined ? {} : { evidence: failureEvidence }),
        recoveryEvidence: found.ok ? conflictingRecoveryEvidence : found.evidence,
      });
};

const retainFailure = (
  dependencies: Dependencies,
  pending: Parameters<CandidatePublicationPort["beginPublication"]>[0],
  failure: Exclude<GitHubPullRequestMutationResult, { readonly ok: true }>,
): PublicationEffect =>
  Effect.map(dependencies.changePersistence.getChangeById(pending.changeId), () => ({
    ok: false,
    code:
      failure.code === "remote_head_mismatch"
        ? "publication_remote_mismatch"
        : "publication_tooling_failed",
    ...(failure.evidence === undefined ? {} : { evidence: failure.evidence }),
    ...(failure.observedRemoteHeadSha === undefined
      ? {}
      : {
          expectedRemoteHeadSha: pending.expectedHeadSha,
          observedRemoteHeadSha: failure.observedRemoteHeadSha,
        }),
  }));

const selectRecoveredPullRequest = (
  found: readonly GitHubPullRequest[] | undefined,
  target: ChangePublicationTarget,
  headBranch: string,
  expectedHeadSha: string,
):
  | { readonly ok: true; readonly pullRequest: GitHubPullRequest }
  | Extract<PublishCandidateResult, { readonly ok: false }> => {
  if (found === undefined) return { ok: false, code: "publication_tooling_failed" };
  const exact = found.filter((pullRequest) =>
    isExactOpenPullRequest(pullRequest, pullRequest.number, target, headBranch, expectedHeadSha),
  );
  return selectSingleRecoveredPullRequest(found, exact);
};

const selectSingleRecoveredPullRequest = (
  found: readonly GitHubPullRequest[],
  exact: readonly GitHubPullRequest[],
):
  | { readonly ok: true; readonly pullRequest: GitHubPullRequest }
  | Extract<PublishCandidateResult, { readonly ok: false }> => {
  if (exact.length === 0)
    return {
      ok: false,
      code:
        found.length === 0 ? "publication_creation_unconfirmed" : "publication_lookup_ambiguous",
    };
  if (exact.length !== 1) return { ok: false, code: "publication_lookup_ambiguous" };
  if (found.length !== 1) return { ok: false, code: "publication_lookup_ambiguous" };
  return { ok: true, pullRequest: exact[0] as GitHubPullRequest };
};

const updateOrReuse = (
  dependencies: Dependencies,
  input: PublishCandidateInput,
  change: PublishedCandidatePublicationChange,
  headBranch: string,
  expectedHeadSha: string,
  metadata: Metadata,
): PublicationEffect => {
  const prepared = preparePullRequestUpdate(
    dependencies,
    input,
    change,
    headBranch,
    expectedHeadSha,
  );
  if (prepared.proceed) {
    return executePullRequestUpdate(
      dependencies,
      input,
      change,
      prepared.owned,
      headBranch,
      expectedHeadSha,
      metadata,
      prepared.allowExistingRemoteHead,
    );
  }
  return "recovered" in prepared
    ? record(dependencies, input, headBranch, expectedHeadSha, prepared.recovered, prepared.owned)
    : Effect.succeed(prepared.result);
};

type Published = ChangePublication & {
  readonly pullRequest: NonNullable<ChangePublication["pullRequest"]>;
};
type UpdatePreparation =
  | {
      readonly proceed: true;
      readonly owned: Published;
      readonly allowExistingRemoteHead?: boolean;
    }
  | { readonly proceed: false; readonly owned: Published; readonly recovered: GitHubPullRequest }
  | { readonly proceed: false; readonly result: PublishCandidateResult };

const preparePullRequestUpdate = (
  dependencies: Dependencies,
  input: PublishCandidateInput,
  change: PublishedCandidatePublicationChange,
  headBranch: string,
  expectedHeadSha: string,
): UpdatePreparation => {
  const owned = change.publication;
  if (!ownedPublicationMatchesTarget(owned, input.target, headBranch)) {
    return { proceed: false, result: { ok: false, code: "publication_state_conflict" } };
  }
  return prepareOwnedPullRequestUpdate(dependencies, input, change, owned, expectedHeadSha);
};

const ownedPublicationMatchesTarget = (
  owned: Published,
  target: ChangePublicationTarget,
  headBranch: string,
): boolean => sameTarget(owned.target, target) && owned.headBranch === headBranch;

const prepareOwnedPullRequestUpdate = (
  dependencies: Dependencies,
  input: PublishCandidateInput,
  change: CandidatePublicationChange,
  owned: Published,
  expectedHeadSha: string,
): UpdatePreparation => {
  const classification = observeOwnedPullRequest(dependencies.github, change);
  switch (classification.kind) {
    case "not_owned":
      return { proceed: false, result: { ok: false, code: "publication_state_conflict" } };
    case "exact_open":
      return prepareExactOpenUpdate(
        dependencies,
        input,
        change,
        owned,
        expectedHeadSha,
        classification.pullRequest,
      );
    case "exact_closed_unmerged":
      return hasExpectedHead(dependencies.git, change.branchRef, expectedHeadSha)
        ? { proceed: true, owned }
        : { proceed: false, result: { ok: false, code: "current_head_mismatch" } };
    case "exact_merged":
      return { proceed: false, result: { ok: false, code: "publication_state_conflict" } };
    case "mismatch":
      if (
        classification.rejection === "head_sha_mismatch" &&
        classification.pullRequest.headSha === expectedHeadSha
      ) {
        return hasExpectedHead(dependencies.git, change.branchRef, expectedHeadSha)
          ? { proceed: true, owned, allowExistingRemoteHead: true }
          : { proceed: false, result: { ok: false, code: "current_head_mismatch" } };
      }
      return { proceed: false, result: { ok: false, code: "publication_remote_mismatch" } };
    case "unavailable":
      return { proceed: false, result: { ok: false, code: "publication_tooling_failed" } };
  }
};

const prepareExactOpenUpdate = (
  dependencies: Dependencies,
  input: PublishCandidateInput,
  change: CandidatePublicationChange,
  owned: Published,
  expectedHeadSha: string,
  remote: GitHubPullRequest,
): UpdatePreparation => {
  if (owned.expectedHeadSha === expectedHeadSha) {
    if (owned.candidateId !== input.candidateId) {
      return { proceed: false, result: { ok: false, code: "publication_state_conflict" } };
    }
    if (owned.validationRunId === input.validationRunId) {
      return {
        proceed: false,
        result: { ok: true, created: false, pullRequest: owned.pullRequest },
      };
    }
    return hasExpectedHead(dependencies.git, change.branchRef, expectedHeadSha)
      ? { proceed: false, owned, recovered: remote }
      : { proceed: false, result: { ok: false, code: "current_head_mismatch" } };
  }
  return hasExpectedHead(dependencies.git, change.branchRef, expectedHeadSha)
    ? { proceed: true, owned }
    : { proceed: false, result: { ok: false, code: "current_head_mismatch" } };
};

const executePullRequestUpdate = (
  dependencies: Dependencies,
  input: PublishCandidateInput,
  change: CandidatePublicationChange,
  owned: Published,
  headBranch: string,
  expectedHeadSha: string,
  metadata: Metadata,
  allowExistingRemoteHead = false,
): PublicationEffect => {
  const updated = dependencies.github.updatePullRequest({
    ...request(input.target, change.branchRef, headBranch, expectedHeadSha),
    ...metadata,
    number: owned.pullRequest.number,
    expectedCurrentHeadSha: owned.expectedHeadSha,
    ...(allowExistingRemoteHead ? { allowExistingRemoteHead: true } : {}),
  });
  const confirmationMetadata = allowExistingRemoteHead ? metadata : undefined;
  if (!updated.ok) {
    return updateFailure(
      dependencies,
      input,
      owned,
      headBranch,
      expectedHeadSha,
      updated,
      confirmationMetadata,
    );
  }
  if (
    !isExpectedUpdatedPullRequest(
      updated.pullRequest,
      owned,
      input,
      headBranch,
      expectedHeadSha,
      confirmationMetadata,
    )
  ) {
    return confirmUpdatedPullRequest(
      dependencies,
      input,
      owned,
      headBranch,
      expectedHeadSha,
      confirmationMetadata,
    );
  }
  return record(dependencies, input, headBranch, expectedHeadSha, updated.pullRequest, owned);
};

const confirmUpdatedPullRequest = (
  dependencies: Dependencies,
  input: PublishCandidateInput,
  owned: Published,
  headBranch: string,
  expectedHeadSha: string,
  metadata?: Metadata,
): PublicationEffect =>
  readBackUpdatedPullRequest(
    dependencies,
    input,
    owned,
    headBranch,
    expectedHeadSha,
    conflictingMutationEvidence("pull_request_update"),
    true,
    metadata,
  );

const isExpectedUpdatedPullRequest = (
  pullRequest: GitHubPullRequest,
  owned: Published,
  input: PublishCandidateInput,
  headBranch: string,
  expectedHeadSha: string,
  metadata?: Metadata,
): boolean =>
  isExpectedPullRequest(
    pullRequest,
    owned.pullRequest.number,
    input.target,
    headBranch,
    expectedHeadSha,
  ) &&
  (metadata === undefined ||
    (pullRequest.title === metadata.title && pullRequest.body === metadata.body));

const isExpectedPullRequest = (
  pullRequest: GitHubPullRequest,
  number: number,
  target: ChangePublicationTarget,
  headBranch: string,
  expectedHeadSha: string,
): boolean => isExactOpenPullRequest(pullRequest, number, target, headBranch, expectedHeadSha);

const updateFailure = (
  dependencies: Dependencies,
  input: PublishCandidateInput,
  owned: ChangePublication & {
    readonly pullRequest: NonNullable<ChangePublication["pullRequest"]>;
  },
  headBranch: string,
  expectedHeadSha: string,
  failure: Exclude<GitHubPullRequestMutationResult, { readonly ok: true }>,
  metadata?: Metadata,
): PublicationEffect => {
  if (failure.code === "local_head_mismatch") {
    return Effect.succeed({
      ok: false,
      code: "current_head_mismatch",
      ...(failure.evidence === undefined ? {} : { evidence: failure.evidence }),
    });
  }
  if (failure.code === "remote_head_mismatch") {
    return Effect.succeed({
      ok: false,
      code: "publication_remote_mismatch",
      ...(failure.evidence === undefined ? {} : { evidence: failure.evidence }),
      expectedRemoteHeadSha: expectedHeadSha,
      ...(failure.observedRemoteHeadSha === undefined
        ? {}
        : { observedRemoteHeadSha: failure.observedRemoteHeadSha }),
    });
  }
  return canRecoverUpdateFailure(failure.code)
    ? readBackUpdatedPullRequest(
        dependencies,
        input,
        owned,
        headBranch,
        expectedHeadSha,
        failure.evidence,
        false,
        metadata,
      )
    : Effect.succeed({
        ok: false,
        code: "publication_tooling_failed",
        ...(failure.evidence === undefined ? {} : { evidence: failure.evidence }),
      });
};

const canRecoverUpdateFailure = (
  failure: Exclude<GitHubPullRequestMutationResult, { readonly ok: true }>["code"],
): boolean =>
  failure === "remote_response_lost" ||
  failure === "remote_response_unusable" ||
  failure === "remote_rejected" ||
  failure === "push_failed";

const readBackUpdatedPullRequest = (
  dependencies: Dependencies,
  input: PublishCandidateInput,
  owned: Published,
  headBranch: string,
  expectedHeadSha: string,
  failureEvidence: PublicationFailureEvidence | undefined,
  delayBeforeRead: boolean,
  metadata?: Metadata,
): PublicationEffect =>
  Effect.gen(function* () {
    if (delayBeforeRead) {
      const delay =
        dependencies.delayBeforeConfirmation ??
        ((milliseconds: number) => Effect.sleep(`${milliseconds} millis`));
      yield* delay(100);
    }
    const recovered =
      metadata === undefined
        ? readPullRequest(dependencies.github, input.target, owned.pullRequest.number)
        : readPullRequestUpdateConfirmation(
            dependencies.github,
            input.target,
            owned.pullRequest.number,
          );
    if (!recovered.ok) {
      return {
        ok: false,
        code: "publication_tooling_failed",
        ...(failureEvidence === undefined ? {} : { evidence: failureEvidence }),
        recoveryEvidence: recovered.evidence,
      };
    }
    return isExpectedUpdatedPullRequest(
      recovered.pullRequest,
      owned,
      input,
      headBranch,
      expectedHeadSha,
      metadata,
    )
      ? yield* record(
          dependencies,
          input,
          headBranch,
          expectedHeadSha,
          recovered.pullRequest,
          owned,
        )
      : {
          ok: false,
          code: "publication_remote_mismatch",
          ...(failureEvidence === undefined ? {} : { evidence: failureEvidence }),
          recoveryEvidence: conflictingRecoveryEvidence,
        };
  });

const record = (
  dependencies: Dependencies,
  input: PublishCandidateInput,
  headBranch: string,
  expectedHeadSha: string,
  pullRequest: GitHubPullRequest,
  previous?: ChangePublication,
): PublicationEffect =>
  Effect.map(
    dependencies.changePersistence.recordPublishedPullRequest({
      ...facts(input, headBranch, expectedHeadSha),
      pullRequest: { number: pullRequest.number, url: pullRequest.url },
      ...(previous === undefined
        ? {}
        : {
            previousExpectedHeadSha: previous.expectedHeadSha,
            previousCandidateId: previous.candidateId,
            previousValidationRunId: previous.validationRunId,
            previousPullRequestNumber: pullRequest.number,
          }),
      now: input.now,
    }),
    (recorded) => {
      if (!recorded.ok) return mapPersistenceError(recorded.code);
      return {
        ok: true,
        created: previous === undefined,
        pullRequest: recorded.change.publication.pullRequest,
      };
    },
  );

const implementationDecisionSection = (
  decisions: CandidatePublicationChange["implementationDecisions"],
): string =>
  decisions.length === 0
    ? ""
    : `\n\n## Implementation Decision Log\n\n${implementationDecisionMarkdown(decisions)}`;

const metadataFor = (
  change: CandidatePublicationChange,
  headSha: string,
  git: CandidatePublicationGit,
): Metadata | Extract<PublishCandidateResult, { readonly ok: false }> => {
  if (change.taskId !== null)
    return change.acceptanceContext === null
      ? { ok: false, code: "task_metadata_missing" }
      : {
          title: change.acceptanceContext.title,
          body: `Task: ${change.taskId}${implementationDecisionSection(change.implementationDecisions)}`,
        };
  if (change.startingCommit === null) return { ok: false, code: "commit_history_unavailable" };
  const subject = git.readFirstNonMergeCommitSubject(change.startingCommit, headSha);
  return !subject.ok
    ? { ok: false, code: "commit_history_unavailable" }
    : {
        title: subject.subject ?? "Change publication",
        body: implementationDecisionSection(change.implementationDecisions).trim(),
      };
};

const facts = (input: PublishCandidateInput, headBranch: string, expectedHeadSha: string) => ({
  changeId: input.changeId,
  candidateId: input.candidateId,
  validationRunId: input.validationRunId,
  changeBaseSha: input.changeBaseSha,
  target: input.target,
  headBranch,
  expectedHeadSha,
});
const readPullRequest = (
  github: GitHubPullRequestGateway,
  target: ChangePublicationTarget,
  number: number,
): GitHubPullRequestReadResult => {
  try {
    return github.getPullRequest(target, number);
  } catch {
    return { ok: false, evidence: unavailableRecoveryEvidence };
  }
};

const readPullRequestUpdateConfirmation = (
  github: GitHubPullRequestGateway,
  target: ChangePublicationTarget,
  number: number,
): GitHubPullRequestUpdateConfirmationResult => {
  const result = readPullRequest(github, target, number);
  if (!result.ok) return result;
  return result.pullRequest.title === undefined || result.pullRequest.body === undefined
    ? {
        ok: false,
        evidence: {
          operation: "remote_lookup",
          classification: "response_parse_failure",
          reason: "malformed",
        },
      }
    : {
        ok: true,
        pullRequest: {
          ...result.pullRequest,
          title: result.pullRequest.title,
          body: result.pullRequest.body,
        },
      };
};

const readPullRequestList = (
  github: GitHubPullRequestGateway,
  target: ChangePublicationTarget,
  headBranch: string,
): GitHubPullRequestListResult => {
  try {
    return github.findPullRequests(target, headBranch);
  } catch {
    return { ok: false, evidence: unavailableRecoveryEvidence };
  }
};

const conflictingMutationEvidence = (operation: "pull_request_creation" | "pull_request_update") =>
  ({
    operation,
    classification: "conflict",
    reason: "postcondition_mismatch",
  }) as const;

const unavailableRecoveryEvidence = {
  operation: "remote_lookup",
  classification: "unavailable",
  reason: "unavailable",
} as const;

const conflictingRecoveryEvidence = {
  operation: "remote_lookup",
  classification: "conflict",
  reason: "postcondition_mismatch",
} as const;

const request = (
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
const hasExpectedHead = (
  git: CandidatePublicationGit,
  branchRef: string,
  expectedHeadSha: string,
) => git.readBranchHead(branchRef) === expectedHeadSha;
const isExactOpenPullRequest = (
  pullRequest: GitHubPullRequest,
  number: number,
  target: ChangePublicationTarget,
  headBranch: string,
  expectedHeadSha: string,
): boolean => {
  const expected: OwnedPublication = {
    candidateId: "mutation-postcondition",
    validationRunId: "mutation-postcondition",
    target,
    headBranch,
    expectedHeadSha,
    pullRequest: { number, url: pullRequest.url },
  };
  return classifyOwnedPullRequest(expected, pullRequest).kind === "exact_open";
};
const sameTarget = (left: ChangePublicationTarget, right: ChangePublicationTarget) =>
  left.owner === right.owner &&
  left.repo === right.repo &&
  left.baseBranch === right.baseBranch &&
  left.remoteName === right.remoteName;
const mapPersistenceError = (
  code:
    | "change_not_found"
    | "change_closed"
    | "publication_already_owned"
    | "publication_state_conflict",
) =>
  code === "change_not_found" || code === "change_closed"
    ? { ok: false as const, code }
    : { ok: false as const, code: "publication_state_conflict" as const };
