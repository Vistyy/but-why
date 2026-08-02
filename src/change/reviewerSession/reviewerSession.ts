import { createHash } from "node:crypto";
import { chmodSync, mkdirSync } from "node:fs";
import { join } from "node:path";

import type { Effect } from "effect";
import type { AgentEnvironmentCommand } from "../../agent/agentEnvironment.js";
import type { ResolvedPiAgentProfile } from "../../agent/agentProfiles.js";
import { currentCandidateReReviewInstructions } from "../../agent/reviewerPrompts.js";
import type { AcceptanceContextSnapshotV1 } from "../validationRun/acceptanceContextSnapshot.js";
import type { ImplementationDecision } from "../implementationDecision.js";
import type { ImplementationBlockerHistory } from "../implementationBlocker.js";
import type { RepositoryStorageError } from "../../contracts/repositoryStorageError.js";

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
  readonly identity: ReviewerSessionIdentity;
  readonly fingerprint: string;
  readonly sessionReference: string;
  readonly lastCandidateId: string;
};

export type ReviewerSessionStore = {
  readonly get: (
    changeId: string,
    producer: string,
  ) => Effect.Effect<ReviewerSessionRecord | undefined, RepositoryStorageError>;
  readonly save: (input: ReviewerSessionRecord) => Effect.Effect<void, RepositoryStorageError>;
  readonly remove: (
    changeId: string,
    producer: string,
  ) => Effect.Effect<void, RepositoryStorageError>;
};

export type ReviewerContinuity = "fresh" | "resumed" | "restarted";

export const reviewerSessionFingerprint = (identity: ReviewerSessionIdentity): string =>
  createHash("sha256").update(JSON.stringify(identity)).digest("hex");

export const sessionIdentityMatches = (
  record: ReviewerSessionRecord,
  identity: ReviewerSessionIdentity,
): boolean => {
  try {
    return (
      typeof record.fingerprint === "string" &&
      typeof record.sessionReference === "string" &&
      record.identity !== null &&
      typeof record.identity === "object" &&
      record.fingerprint === reviewerSessionFingerprint(record.identity) &&
      record.fingerprint === reviewerSessionFingerprint(identity) &&
      record.identity.changeId === identity.changeId
    );
  } catch {
    return false;
  }
};

export const reviewerSessionsPath = (operationalDir: string): string => {
  const path = join(operationalDir, "reviewer-sessions");
  mkdirSync(path, { recursive: true, mode: 0o700 });
  chmodSync(path, 0o700);
  return path;
};

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
    "Previous final Acceptance Findings:",
    JSON.stringify({ findings: input.previousFindings }),
    "Return only the required reviewer output.",
  ].join("\n");
