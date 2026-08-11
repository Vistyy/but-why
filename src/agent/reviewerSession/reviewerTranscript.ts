import { type Dirent, readdirSync, readFileSync } from "node:fs";
import { basename, join, relative } from "node:path";

import { decodePiJsonlObject, decodePiSessionIdentity } from "../piJsonl.js";

export type ObservedReviewerTranscript = {
  readonly ownerId: string;
  readonly producer: string;
  readonly piSessionId: string;
  readonly filePath: string;
};

export type ReviewerTranscriptDiscoveryResult =
  | { readonly ok: true; readonly transcripts: readonly ObservedReviewerTranscript[] }
  | { readonly ok: false; readonly reason: string };

export const discoverObservedReviewerTranscripts = (
  ownerRoot: string,
  ownerId: string,
): ReviewerTranscriptDiscoveryResult => {
  let producerEntries: Dirent[];
  try {
    producerEntries = readdirSync(ownerRoot, { withFileTypes: true });
  } catch (error) {
    if (isFileSystemError(error, "ENOENT")) return { ok: true, transcripts: [] };
    return { ok: false, reason: "reviewer_session_storage_unreadable" };
  }

  const transcripts: ObservedReviewerTranscript[] = [];
  for (const entry of producerEntries) {
    if (!entry.isDirectory()) continue;
    const producerRoot = join(ownerRoot, entry.name);
    const files = collectReviewerSessionFiles(producerRoot);
    if (files === undefined) {
      return { ok: false, reason: `reviewer_session_storage_unreadable:${entry.name}` };
    }
    for (const file of files) {
      const piSessionId = extractPiSessionId(file);
      if (piSessionId === undefined) {
        return {
          ok: false,
          reason: `unidentified_reviewer_session:${relative(ownerRoot, file)}`,
        };
      }
      transcripts.push({
        ownerId,
        producer: entry.name,
        piSessionId,
        filePath: relative(producerRoot, file),
      });
    }
  }
  transcripts.sort((first, second) => {
    const producerOrder = compare(first.producer, second.producer);
    return producerOrder || compare(first.filePath, second.filePath);
  });
  return { ok: true, transcripts };
};

const collectReviewerSessionFiles = (root: string): readonly string[] | undefined => {
  const files: string[] = [];
  const visit = (directory: string): boolean => {
    let entries: Dirent[];
    try {
      entries = readdirSync(directory, { withFileTypes: true });
    } catch {
      return false;
    }
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!visit(path)) return false;
      } else if (entry.isFile() && entry.name.endsWith(".jsonl")) files.push(path);
    }
    return true;
  };
  return visit(root) ? files : undefined;
};

const extractPiSessionId = (filePath: string): string | undefined => {
  const headerId = sessionHeaderSessionId(filePath);
  if (headerId !== undefined) return headerId;
  return /^.+_([^_]+)\.jsonl$/u.exec(basename(filePath))?.[1];
};

const sessionHeaderSessionId = (filePath: string): string | undefined => {
  let content: string;
  try {
    content = readFileSync(filePath, "utf8");
  } catch {
    return undefined;
  }
  const firstLine = content.split("\n").find((line) => line.trim().length > 0);
  if (firstLine === undefined) return undefined;
  try {
    const sessionId = decodePiSessionIdentity(decodePiJsonlObject(firstLine));
    return sessionId === undefined || sessionId.length === 0 ? undefined : sessionId;
  } catch {
    return undefined;
  }
};

const compare = (left: string, right: string): number =>
  left === right ? 0 : left < right ? -1 : 1;

const isFileSystemError = (error: unknown, code: string): boolean =>
  error instanceof Error && "code" in error && error.code === code;
