import type { Effect } from "effect";
import type { AgentEnvironmentCommand } from "../../agent/agentEnvironment.js";
import type { ResolvedPiAgentProfile } from "../../agent/agentProfiles.js";
import {
  currentCandidateReReviewInstructions,
  previousFindingsPrompt,
} from "../../agent/reviewerPrompts.js";
import type { RepositoryStorageError } from "../../contracts/repositoryStorageError.js";
import {
  reviewerSessionFingerprint as neutralReviewerSessionFingerprint,
  reviewerSessionsOwnerRoot,
  reviewerSessionsPath as neutralReviewerSessionsPath,
  reviewerSessionsProducerRoot as neutralReviewerSessionsProducerRoot,
} from "../../reviewerSession/sessionFiles.js";
import type { ImplementationBlockerHistory } from "../implementationBlocker.js";
import type { ImplementationDecision } from "../implementationDecision.js";
import type { AcceptanceContextSnapshotV1 } from "../validationRun/acceptanceContextSnapshot.js";

export type ReviewerSessionIdentity = {
  readonly changeId: string;
  readonly producer: string;
  readonly agentProfile: ResolvedPiAgentProfile;
  readonly instructions: string;
  readonly agentEnvironment?: AgentEnvironmentCommand;
  readonly resources: {
    readonly extensions?: readonly string[];
    readonly skills?: readonly string[];
    readonly tools?: readonly string[];
  };
};

export type ReviewerSessionRecord = {
  readonly changeId: string;
  readonly producer: string;
  readonly fingerprint: string;
  readonly sessionReference: string;
};

export type ReviewerSessionStore = {
  readonly get: (
    changeId: string,
    producer: string,
  ) => Effect.Effect<ReviewerSessionRecord | undefined, RepositoryStorageError>;
  readonly save: (input: ReviewerSessionRecord) => Effect.Effect<void, RepositoryStorageError>;
  // remove clears only the active continuation record; retained Reviewer Transcript files stay on disk for Terminal Cleanup indexing.
  readonly remove: (
    changeId: string,
    producer: string,
  ) => Effect.Effect<void, RepositoryStorageError>;
};

export type ReviewerContinuity = "fresh" | "resumed" | "restarted";

export const reviewerSessionFingerprint = (identity: ReviewerSessionIdentity): string =>
  neutralReviewerSessionFingerprint(identity);

export const reviewerSessionsPath = (
  sessionStorageRoot: string,
  changeId: string,
  producer: string,
): string => neutralReviewerSessionsPath(sessionStorageRoot, changeId, producer);

export const reviewerSessionsProducerRoot = (
  sessionStorageRoot: string,
  changeId: string,
  producer: string,
): string => neutralReviewerSessionsProducerRoot(sessionStorageRoot, changeId, producer);

export const reviewerSessionsChangeRoot = (sessionStorageRoot: string, changeId: string): string =>
  reviewerSessionsOwnerRoot(sessionStorageRoot, changeId);

export const continuationPrompt = (input: {
  readonly candidate: {
    readonly candidateId: string;
    readonly changeBaseSha: string;
    readonly headSha: string;
  };
  readonly acceptanceContext: AcceptanceContextSnapshotV1;
  readonly implementationDecisions: readonly ImplementationDecision[];
  readonly blockerHistory?: ImplementationBlockerHistory;
  readonly availableArtifactRefs: readonly string[];
  readonly previousFindings: readonly unknown[];
}): string =>
  [
    "Continue the Acceptance Reviewer Session.",
    currentCandidateReReviewInstructions,
    "Current Candidate:",
    JSON.stringify(input.candidate),
    "Complete authoritative Acceptance Context:",
    JSON.stringify(input.acceptanceContext),
    "Implementer Implementation Decision Log (non-authoritative rationale):",
    JSON.stringify(input.implementationDecisions),
    "Implementation Blocker history (non-authoritative evidence):",
    JSON.stringify(input.blockerHistory ?? { blockers: [], resolutions: [], active: null }),
    "Available Check and Validation evidence:",
    JSON.stringify(input.availableArtifactRefs),
    previousFindingsPrompt(input.previousFindings),
    "Return only the required reviewer output.",
  ].join("\n");
