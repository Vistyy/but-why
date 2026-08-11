import { createHash } from "node:crypto";
import { chmodSync, mkdirSync } from "node:fs";
import { join } from "node:path";

import type { Effect } from "effect";
import type { AgentEnvironmentCommand } from "../../agent/agentEnvironment.js";
import type { ResolvedPiAgentProfile } from "../../agent/agentProfiles.js";
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
  createHash("sha256").update(JSON.stringify(identity)).digest("hex");

export const reviewerSessionsPath = (
  sessionStorageRoot: string,
  changeId: string,
  producer: string,
): string => {
  const path = join(sessionStorageRoot, changeId, producer, "reviewer-sessions");
  mkdirSync(path, { recursive: true, mode: 0o700 });
  chmodSync(path, 0o700);
  return path;
};

export const reviewerSessionsProducerRoot = (
  sessionStorageRoot: string,
  changeId: string,
  producer: string,
): string => join(sessionStorageRoot, changeId, producer);

export const reviewerSessionsChangeRoot = (sessionStorageRoot: string, changeId: string): string =>
  join(sessionStorageRoot, changeId);
