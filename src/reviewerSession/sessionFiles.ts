import { createHash } from "node:crypto";
import { chmodSync, mkdirSync } from "node:fs";
import { join } from "node:path";

export const reviewerSessionFingerprint = (identity: unknown): string =>
  createHash("sha256").update(JSON.stringify(identity)).digest("hex");

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
