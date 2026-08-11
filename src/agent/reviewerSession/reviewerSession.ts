import { createHash } from "node:crypto";
import { chmodSync, mkdirSync } from "node:fs";
import { join } from "node:path";

import type { Effect } from "effect";
import type { RepositoryStorageError } from "../../contracts/repositoryStorageError.js";
import type { AgentEnvironmentCommand } from "../agentEnvironment.js";
import type { ResolvedPiAgentProfile } from "../agentProfiles.js";

export type ReviewerSessionIdentity = {
  readonly ownerId: string;
  readonly fingerprintOwnerKey?: "changeId";
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
  readonly ownerId: string;
  readonly producer: string;
  readonly fingerprint: string;
  readonly sessionReference: string;
};

export type ReviewerSessionStore = {
  readonly get: (
    ownerId: string,
    producer: string,
  ) => Effect.Effect<ReviewerSessionRecord | undefined, RepositoryStorageError>;
  readonly save: (input: ReviewerSessionRecord) => Effect.Effect<void, RepositoryStorageError>;
  // remove clears only the active continuation record; retained Reviewer Transcript files stay on disk for Terminal Cleanup indexing.
  readonly remove: (
    ownerId: string,
    producer: string,
  ) => Effect.Effect<void, RepositoryStorageError>;
};

export type ReviewerContinuity = "fresh" | "resumed" | "restarted";

export const reviewerSessionFingerprint = (identity: ReviewerSessionIdentity): string => {
  const { ownerId, fingerprintOwnerKey, ...remainder } = identity;
  const persistedIdentity =
    fingerprintOwnerKey === "changeId"
      ? { changeId: ownerId, ...remainder }
      : { ownerId, ...remainder };
  return createHash("sha256").update(JSON.stringify(persistedIdentity)).digest("hex");
};

export const reviewerSessionsPath = (
  sessionStorageRoot: string,
  ownerId: string,
  producer: string,
): string => {
  const path = join(sessionStorageRoot, ownerId, producer, "reviewer-sessions");
  mkdirSync(path, { recursive: true, mode: 0o700 });
  chmodSync(path, 0o700);
  return path;
};

export const reviewerSessionsProducerRoot = (
  sessionStorageRoot: string,
  ownerId: string,
  producer: string,
): string => join(sessionStorageRoot, ownerId, producer);

export const reviewerSessionsOwnerRoot = (sessionStorageRoot: string, ownerId: string): string =>
  join(sessionStorageRoot, ownerId);
