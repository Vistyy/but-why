import { createHash } from "node:crypto";
import { chmodSync, mkdirSync } from "node:fs";
import { join } from "node:path";

import type { Effect } from "effect";
import type { AgentEnvironmentCommand } from "../../agent/agentEnvironment.js";
import type { ResolvedPiAgentProfile } from "../../agent/agentProfiles.js";
import type { TaskContextSnapshotV1 } from "../validationRun/taskContextSnapshot.js";

export type ReviewerSessionIdentity = {
  readonly changeId: string;
  readonly producer: "acceptance";
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
  readonly get: (changeId: string) => Effect.Effect<ReviewerSessionRecord | undefined, any>;
  readonly save: (input: ReviewerSessionRecord) => Effect.Effect<void, any>;
  readonly remove: (changeId: string) => Effect.Effect<void, any>;
};

export type ReviewerContinuity = "fresh" | "resumed" | "restarted";

export const reviewerSessionFingerprint = (identity: ReviewerSessionIdentity): string =>
  createHash("sha256").update(JSON.stringify(identity)).digest("hex");

export const sessionIdentityMatches = (
  record: ReviewerSessionRecord,
  identity: ReviewerSessionIdentity,
): boolean =>
  record.fingerprint === reviewerSessionFingerprint(identity) &&
  record.identity.changeId === identity.changeId;

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
  readonly acceptanceContext: TaskContextSnapshotV1;
  readonly availableArtifactRefs: readonly string[];
  readonly previousFindings: readonly unknown[];
}): string =>
  [
    "Continue the Acceptance Reviewer Session, but perform a complete fresh sweep of the exact current Candidate.",
    "The previous Findings are evidence to recheck, not the only review target.",
    "Current Candidate:",
    JSON.stringify(input.candidate),
    "Complete authoritative Acceptance Context:",
    JSON.stringify(input.acceptanceContext),
    "Available Check and Validation evidence:",
    JSON.stringify(input.availableArtifactRefs),
    "Previous final Acceptance Findings:",
    JSON.stringify({ findings: input.previousFindings }),
    "Return only the required reviewer output.",
  ].join("\n");

export const reviewerSessionEvidence = (input: {
  readonly continuity: ReviewerContinuity;
  readonly fingerprint: string;
  readonly restartReason?: string;
  readonly durationMs: number;
}) => ({
  continuity: input.continuity,
  identityFingerprint: input.fingerprint,
  ...(input.restartReason === undefined ? {} : { restartReason: input.restartReason }),
  durationMs: input.durationMs,
});
