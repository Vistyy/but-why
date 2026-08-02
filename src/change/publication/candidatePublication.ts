import { isDeepStrictEqual } from "node:util";
import { Effect } from "effect";

import type { CandidateValidationPolicySnapshot } from "../candidateValidation/candidateValidationRunStore.js";
import type { ChangeValidationPersistence } from "../validation/changeValidationPersistence.js";
import type { ChangePersistence } from "../changePersistence.js";
import type {
  ChangeOwnedPullRequest,
  ChangePublication,
  ChangePublicationTarget,
  ChangeRecord,
} from "../change.js";
import type {
  GitHubPullRequest,
  GitHubPullRequestGateway,
  GitHubPullRequestMutationResult,
  GitHubPullRequestRequest,
} from "../ownedPullRequestGateway.js";
import type { RepositoryStorageError } from "../../contracts/repositoryStorageError.js";
import { implementationDecisionMarkdown } from "../implementationDecision.js";
export type CommitSubjectResult =
  | { readonly ok: true; readonly subject: string | undefined }
  | { readonly ok: false };

export type CandidatePublicationGit = {
  readonly readBranchHead: (branchRef: string) => string | undefined;
  readonly readFirstNonMergeCommitSubject: (
    startingCommit: string,
    headSha: string,
  ) => CommitSubjectResult;
  readonly containsCommit?: (headSha: string, ancestorSha: string) => boolean;
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
    };

type Dependencies = {
  readonly changePersistence: ChangePersistence;
  readonly validationPersistence: Pick<
    ChangeValidationPersistence,
    "getCandidateById" | "getRunById"
  >;
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
    const candidate = yield* dependencies.validationPersistence.getCandidateById(input.candidateId);
    if (candidate === undefined) return { ok: false, code: "candidate_not_found" };
    if (candidate.changeId !== change.id)
      return { ok: false, code: "candidate_does_not_belong_to_change" };
    const publicationInput = { ...input, changeBaseSha: candidate.changeBaseSha };
    const validationRun = yield* dependencies.validationPersistence.getRunById(
      publicationInput.validationRunId,
    );
    if (
      validationRun === undefined ||
      validationRun.candidateId !== input.candidateId ||
      validationRun.outcome !== "passed" ||
      !isDeepStrictEqual(validationRun.policy, publicationInput.policy) ||
      candidate.headSha.length === 0
    )
      return { ok: false, code: "validation_evidence_invalid" };
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
    if (change.publication === null)
      return yield* create(
        dependencies,
        publicationInput,
        change,
        headBranch,
        candidate.headSha,
        metadata,
      );
    if (change.publication.pullRequest === null)
      return yield* recover(dependencies, publicationInput, change, headBranch, candidate.headSha);
    return yield* updateOrReuse(
      dependencies,
      publicationInput,
      change,
      headBranch,
      candidate.headSha,
      metadata,
    );
  });

const create = (
  dependencies: Dependencies,
  input: PublishCandidateInput,
  change: ChangeRecord,
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
    if (!matches(created.pullRequest, input.target, headBranch, expectedHeadSha))
      return { ok: false, code: "publication_remote_mismatch" };
    return yield* record(dependencies, input, headBranch, expectedHeadSha, created.pullRequest);
  });

const createFailure = (
  dependencies: Dependencies,
  input: PublishCandidateInput,
  _change: ChangeRecord,
  headBranch: string,
  expectedHeadSha: string,
  pending: Parameters<ChangePersistence["beginPublication"]>[0],
  failure: Exclude<GitHubPullRequestMutationResult, { readonly ok: true }>,
): PublicationEffect => {
  if (failure.code === "remote_response_lost" || failure.code === "remote_response_unusable")
    return confirmCreation(dependencies, input, headBranch, expectedHeadSha, failure.evidence);
  if (
    failure.code === "remote_rejected" ||
    failure.code === "remote_head_mismatch" ||
    failure.code === "remote_lookup_failed"
  )
    return retainFailure(dependencies, pending, failure);
  const code =
    failure.code === "local_head_mismatch" ? "current_head_mismatch" : "publication_tooling_failed";
  return releaseWithDetails(dependencies, pending, code, failure);
};

const releaseWithDetails = (
  dependencies: Dependencies,
  pending: Parameters<ChangePersistence["beginPublication"]>[0],
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
  pending: Parameters<ChangePersistence["beginPublication"]>[0],
  code: Extract<PublishCandidateResult, { readonly ok: false }>["code"],
  failureEvidence?: import("../ownedPullRequestGateway.js").PublicationFailureEvidence,
): PublicationEffect =>
  Effect.map(dependencies.changePersistence.releasePendingPublication(pending), (released) =>
    released.ok
      ? { ok: false, code, ...(failureEvidence === undefined ? {} : { evidence: failureEvidence }) }
      : mapPersistenceError(released.code),
  );

const release = (
  dependencies: Dependencies,
  pending: Parameters<ChangePersistence["beginPublication"]>[0],
  code: Extract<PublishCandidateResult, { readonly ok: false }>["code"],
): PublicationEffect =>
  Effect.map(dependencies.changePersistence.releasePendingPublication(pending), (released) =>
    released.ok ? { ok: false, code } : mapPersistenceError(released.code),
  );

const recover = (
  dependencies: Dependencies,
  input: PublishCandidateInput,
  change: ChangeRecord,
  headBranch: string,
  expectedHeadSha: string,
): PublicationEffect =>
  Effect.gen(function* () {
    const marker = change.publication;
    if (marker === null || marker.pullRequest !== null)
      return { ok: false, code: "publication_state_conflict" };
    const found = dependencies.github.findPullRequests(marker.target, marker.headBranch);
    if (found === undefined)
      return {
        ok: false,
        code: "publication_tooling_failed",
        ...(dependencies.github.getLastFailureEvidence?.() === undefined
          ? {}
          : { evidence: dependencies.github.getLastFailureEvidence?.() }),
      };
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
    if (!sameTarget(marker.target, input.target))
      return { ok: false, code: "publication_state_conflict" };
    if (
      marker.candidateId === input.candidateId &&
      marker.validationRunId === input.validationRunId
    )
      return yield* record(dependencies, input, headBranch, expectedHeadSha, selected.pullRequest);
    if (
      dependencies.git.containsCommit === undefined ||
      !dependencies.git.containsCommit(expectedHeadSha, selected.pullRequest.headSha)
    )
      return {
        ok: false,
        code: "publication_remote_mismatch",
        expectedRemoteHeadSha: expectedHeadSha,
        observedRemoteHeadSha: selected.pullRequest.headSha,
      };
    const owned = {
      ...marker,
      pullRequest: { number: selected.pullRequest.number, url: selected.pullRequest.url },
    } as Published;
    const metadata = metadataFor(
      change,
      input.candidateId,
      input.validationRunId,
      expectedHeadSha,
      dependencies.git,
    );
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
  change: ChangeRecord,
): PublicationEffect =>
  Effect.gen(function* () {
    const metadata = metadataFor(
      change,
      input.candidateId,
      input.validationRunId,
      expectedHeadSha,
      dependencies.git,
    );
    if ("ok" in metadata) return metadata;
    const pending = { ...facts(input, headBranch, expectedHeadSha), now: input.now };
    const created = dependencies.github.createPullRequest({
      ...request(input.target, change.branchRef, headBranch, expectedHeadSha),
      allowExistingRemoteHead: true,
      ...metadata,
    });
    if (created.ok && matches(created.pullRequest, input.target, headBranch, expectedHeadSha))
      return yield* record(dependencies, input, headBranch, expectedHeadSha, created.pullRequest);
    if (
      !created.ok &&
      (created.code === "remote_response_lost" || created.code === "remote_response_unusable")
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
    return { ok: false, code: "publication_remote_mismatch" };
  });

const confirmCreation = (
  dependencies: Dependencies,
  input: PublishCandidateInput,
  headBranch: string,
  expectedHeadSha: string,
  failureEvidence?: import("../ownedPullRequestGateway.js").PublicationFailureEvidence,
): PublicationEffect => {
  const found = dependencies.github.findPullRequests(input.target, headBranch);
  const selected = selectRecoveredPullRequest(found, input.target, headBranch, expectedHeadSha);
  const lookupEvidence = dependencies.github.getLastFailureEvidence?.();
  return selected.ok
    ? record(dependencies, input, headBranch, expectedHeadSha, selected.pullRequest)
    : Effect.succeed({
        ...selected,
        ...(failureEvidence === undefined
          ? lookupEvidence === undefined
            ? {}
            : { evidence: lookupEvidence }
          : lookupEvidence === undefined
            ? { evidence: failureEvidence }
            : { evidence: lookupEvidence }),
      });
};

const retainFailure = (
  dependencies: Dependencies,
  pending: Parameters<ChangePersistence["beginPublication"]>[0],
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
    matches(pullRequest, target, headBranch, expectedHeadSha),
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
  change: ChangeRecord,
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
  | { readonly proceed: true; readonly owned: Published }
  | { readonly proceed: false; readonly owned: Published; readonly recovered: GitHubPullRequest }
  | { readonly proceed: false; readonly result: PublishCandidateResult };

const preparePullRequestUpdate = (
  dependencies: Dependencies,
  input: PublishCandidateInput,
  change: ChangeRecord,
  headBranch: string,
  expectedHeadSha: string,
): UpdatePreparation => {
  const owned = publishedChangePublication(change);
  if (owned === undefined) throw new Error("Missing owned pull request");
  if (!ownedPublicationMatchesTarget(owned, input.target, headBranch)) {
    return { proceed: false, result: { ok: false, code: "publication_state_conflict" } };
  }
  return prepareOwnedPullRequestUpdate(
    dependencies,
    input,
    change,
    owned,
    headBranch,
    expectedHeadSha,
  );
};

const ownedPublicationMatchesTarget = (
  owned: Published,
  target: ChangePublicationTarget,
  headBranch: string,
): boolean => sameTarget(owned.target, target) && owned.headBranch === headBranch;

const prepareOwnedPullRequestUpdate = (
  dependencies: Dependencies,
  input: PublishCandidateInput,
  change: ChangeRecord,
  owned: Published,
  headBranch: string,
  expectedHeadSha: string,
): UpdatePreparation => {
  const remote = dependencies.github.getPullRequest(input.target, owned.pullRequest.number);
  if (remote === undefined) {
    return {
      proceed: false,
      result: {
        ok: false,
        code: "publication_tooling_failed",
        ...(dependencies.github.getLastFailureEvidence?.() === undefined
          ? {}
          : { evidence: dependencies.github.getLastFailureEvidence?.() }),
      },
    };
  }
  if (
    isExpectedPullRequest(
      remote,
      owned.pullRequest.number,
      input.target,
      headBranch,
      expectedHeadSha,
    )
  ) {
    if (owned.expectedHeadSha === expectedHeadSha) {
      return { proceed: false, result: reusePublishedCandidate(owned, input) };
    }
    return hasExpectedHead(dependencies.git, change.branchRef, expectedHeadSha)
      ? { proceed: false, owned, recovered: remote }
      : { proceed: false, result: { ok: false, code: "current_head_mismatch" } };
  }
  if (
    !isExpectedPullRequest(
      remote,
      owned.pullRequest.number,
      input.target,
      headBranch,
      owned.expectedHeadSha,
    )
  ) {
    return { proceed: false, result: { ok: false, code: "publication_remote_mismatch" } };
  }
  return hasExpectedHead(dependencies.git, change.branchRef, expectedHeadSha)
    ? { proceed: true, owned }
    : { proceed: false, result: { ok: false, code: "current_head_mismatch" } };
};

const publishedChangePublication = (change: ChangeRecord): Published | undefined => {
  const publication = change.publication;
  return publication?.pullRequest === null || publication === null
    ? undefined
    : (publication as Published);
};

const reusePublishedCandidate = (
  owned: Published,
  input: PublishCandidateInput,
): PublishCandidateResult =>
  owned.candidateId === input.candidateId && owned.validationRunId === input.validationRunId
    ? { ok: true, created: false, pullRequest: owned.pullRequest }
    : { ok: false, code: "publication_state_conflict" };

const executePullRequestUpdate = (
  dependencies: Dependencies,
  input: PublishCandidateInput,
  change: ChangeRecord,
  owned: Published,
  headBranch: string,
  expectedHeadSha: string,
  metadata: Metadata,
): PublicationEffect => {
  const updated = dependencies.github.updatePullRequest({
    ...request(input.target, change.branchRef, headBranch, expectedHeadSha),
    ...metadata,
    number: owned.pullRequest.number,
    expectedCurrentHeadSha: owned.expectedHeadSha,
  });
  if (!updated.ok) {
    return updateFailure(dependencies, input, owned, headBranch, expectedHeadSha, updated);
  }
  if (
    !isExpectedUpdatedPullRequest(updated.pullRequest, owned, input, headBranch, expectedHeadSha)
  ) {
    return confirmUpdatedPullRequest(dependencies, input, owned, headBranch, expectedHeadSha);
  }
  return record(dependencies, input, headBranch, expectedHeadSha, updated.pullRequest, owned);
};

const confirmUpdatedPullRequest = (
  dependencies: Dependencies,
  input: PublishCandidateInput,
  owned: Published,
  headBranch: string,
  expectedHeadSha: string,
): PublicationEffect =>
  Effect.gen(function* () {
    const delay =
      dependencies.delayBeforeConfirmation ??
      ((milliseconds: number) => Effect.sleep(`${milliseconds} millis`));
    for (let attempt = 0; attempt < 3; attempt += 1) {
      yield* delay(100);
      const confirmed = dependencies.github.getPullRequest(input.target, owned.pullRequest.number);
      if (confirmed === undefined) {
        return {
          ok: false,
          code: "publication_tooling_failed",
          ...(dependencies.github.getLastFailureEvidence?.() === undefined
            ? {}
            : { evidence: dependencies.github.getLastFailureEvidence?.() }),
        };
      }
      if (isExpectedUpdatedPullRequest(confirmed, owned, input, headBranch, expectedHeadSha)) {
        return yield* record(dependencies, input, headBranch, expectedHeadSha, confirmed, owned);
      }
    }
    return { ok: false, code: "publication_remote_mismatch" };
  });

const isExpectedUpdatedPullRequest = (
  pullRequest: GitHubPullRequest,
  owned: Published,
  input: PublishCandidateInput,
  headBranch: string,
  expectedHeadSha: string,
): boolean =>
  isExpectedPullRequest(
    pullRequest,
    owned.pullRequest.number,
    input.target,
    headBranch,
    expectedHeadSha,
  );

const isExpectedPullRequest = (
  pullRequest: GitHubPullRequest,
  number: number,
  target: ChangePublicationTarget,
  headBranch: string,
  expectedHeadSha: string,
): boolean =>
  pullRequest.number === number && matches(pullRequest, target, headBranch, expectedHeadSha);

const updateFailure = (
  dependencies: Dependencies,
  input: PublishCandidateInput,
  owned: ChangePublication & {
    readonly pullRequest: NonNullable<ChangePublication["pullRequest"]>;
  },
  headBranch: string,
  expectedHeadSha: string,
  failure: Exclude<GitHubPullRequestMutationResult, { readonly ok: true }>,
): PublicationEffect => {
  if (failure.code === "local_head_mismatch") {
    return Effect.succeed({ ok: false, code: "current_head_mismatch" });
  }
  return canRecoverUpdateFailure(failure.code)
    ? recoverUpdatedPullRequest(
        dependencies,
        input,
        owned,
        headBranch,
        expectedHeadSha,
        failure.evidence,
      )
    : Effect.succeed({
        ok: false,
        code: "publication_tooling_failed",
        ...(failure.evidence === undefined ? {} : { evidence: failure.evidence }),
      });
};

const canRecoverUpdateFailure = (
  failure: Exclude<GitHubPullRequestMutationResult, { readonly ok: true }>["code"],
): boolean => failure === "remote_response_lost" || failure === "push_failed";

const recoverUpdatedPullRequest = (
  dependencies: Dependencies,
  input: PublishCandidateInput,
  owned: Published,
  headBranch: string,
  expectedHeadSha: string,
  failureEvidence?: import("../ownedPullRequestGateway.js").PublicationFailureEvidence,
): PublicationEffect => {
  const recovered = dependencies.github.getPullRequest(input.target, owned.pullRequest.number);
  if (recovered === undefined) {
    return Effect.succeed({
      ok: false,
      code: "publication_tooling_failed",
      ...(failureEvidence === undefined ? {} : { evidence: failureEvidence }),
    });
  }
  return isExpectedUpdatedPullRequest(recovered, owned, input, headBranch, expectedHeadSha)
    ? record(dependencies, input, headBranch, expectedHeadSha, recovered, owned)
    : Effect.succeed({ ok: false, code: "publication_remote_mismatch" });
};

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
          }),
      now: input.now,
    }),
    (recorded) => {
      if (!recorded.ok) return mapPersistenceError(recorded.code);
      const publication = recorded.change.publication;
      if (publication === null || publication.pullRequest === null)
        throw new Error("Published pull request was not stored");
      return { ok: true, created: previous === undefined, pullRequest: publication.pullRequest };
    },
  );

const implementationDecisionSection = (
  decisions: ChangeRecord["implementationDecisions"],
): string =>
  decisions === undefined || decisions.length === 0
    ? ""
    : `\n\n## Implementation Decision Log\n\n${implementationDecisionMarkdown(decisions)}`;

const metadataFor = (
  change: ChangeRecord,
  candidateId: string,
  validationRunId: string,
  headSha: string,
  git: CandidatePublicationGit,
): Metadata | Extract<PublishCandidateResult, { readonly ok: false }> => {
  if (change.taskId !== null)
    return change.acceptanceContext === null
      ? { ok: false, code: "task_metadata_missing" }
      : {
          title: change.acceptanceContext.title,
          body: `Task: ${change.taskId}\nCandidate: ${candidateId}\nValidation Run: ${validationRunId}${implementationDecisionSection(change.implementationDecisions)}`,
        };
  if (change.startingCommit === null) return { ok: false, code: "commit_history_unavailable" };
  const subject = git.readFirstNonMergeCommitSubject(change.startingCommit, headSha);
  return !subject.ok
    ? { ok: false, code: "commit_history_unavailable" }
    : {
        title: subject.subject ?? `Change ${change.id.slice(0, 8)}`,
        body: `Change: ${change.id}\nCandidate: ${candidateId}\nValidation Run: ${validationRunId}${implementationDecisionSection(change.implementationDecisions)}`,
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
const branchName = (branchRef: string) =>
  branchRef.startsWith("refs/heads/") && branchRef.length > 11 ? branchRef.slice(11) : undefined;
const hasExpectedHead = (
  git: CandidatePublicationGit,
  branchRef: string,
  expectedHeadSha: string,
) => git.readBranchHead(branchRef) === expectedHeadSha;
const matches = (
  pullRequest: GitHubPullRequest,
  target: ChangePublicationTarget,
  headBranch: string,
  expectedHeadSha: string,
) =>
  pullRequest.repository?.owner === target.owner &&
  pullRequest.repository.repo === target.repo &&
  pullRequest.state === "open" &&
  pullRequest.merged === false &&
  pullRequest.baseBranch === target.baseBranch &&
  pullRequest.headBranch === headBranch &&
  pullRequest.headSha === expectedHeadSha;
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
