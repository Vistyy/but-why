import { type Dirent, readdirSync, readFileSync } from "node:fs";
import { basename, join, relative } from "node:path";

import { Effect } from "effect";

import type { RepositoryStorageError } from "../../contracts/repositoryStorageError.js";
import type { ChangePersistence } from "../changePersistence.js";

export type ReviewerTranscript = {
  readonly changeId: string;
  readonly producer: string;
  readonly piSessionId: string;
  readonly filePath: string;
};

export type ReviewerTranscriptDiscovery =
  | { readonly ok: true; readonly transcripts: readonly ReviewerTranscript[] }
  | { readonly ok: false; readonly reason: string };

export type TranscriptIndexResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: string };

export type TranscriptIndexOperation = (input: {
  readonly changeId: string;
  readonly reviewerSessionPath: string;
}) => Effect.Effect<TranscriptIndexResult, RepositoryStorageError>;

export const openReviewerTranscriptIndex = (dependencies: {
  readonly persistence: Pick<ChangePersistence, "recordReviewerTranscripts">;
}): TranscriptIndexOperation => {
  const index = (input: {
    readonly changeId: string;
    readonly reviewerSessionPath: string;
  }): Effect.Effect<TranscriptIndexResult, RepositoryStorageError> =>
    Effect.gen(function* () {
      const discovery = discoverReviewerTranscripts(input.reviewerSessionPath, input.changeId);
      if (!discovery.ok) return { ok: false, reason: discovery.reason };
      yield* dependencies.persistence.recordReviewerTranscripts({
        changeId: input.changeId,
        transcripts: discovery.transcripts,
      });
      return { ok: true };
    });
  return index;
};

export const discoverReviewerTranscripts = (
  changeRoot: string,
  changeId: string,
): ReviewerTranscriptDiscovery => {
  let producerEntries: Dirent[];
  try {
    producerEntries = readdirSync(changeRoot, { withFileTypes: true });
  } catch (error) {
    if (isFileSystemError(error, "ENOENT")) return { ok: true, transcripts: [] };
    return { ok: false, reason: "reviewer_session_storage_unreadable" };
  }

  const transcripts: ReviewerTranscript[] = [];
  for (const entry of producerEntries) {
    if (!entry.isDirectory()) continue;
    const producerRoot = join(changeRoot, entry.name);
    const files = collectReviewerSessionFiles(producerRoot);
    if (files === undefined) {
      return { ok: false, reason: `reviewer_session_storage_unreadable:${entry.name}` };
    }
    for (const file of files) {
      const piSessionId = extractPiSessionId(file);
      if (piSessionId === undefined) {
        return {
          ok: false,
          reason: `unidentified_reviewer_session:${relative(changeRoot, file)}`,
        };
      }
      transcripts.push({
        changeId,
        producer: entry.name,
        piSessionId,
        filePath: relative(producerRoot, file),
      });
    }
  }
  transcripts.sort((first, second) => {
    const producerOrder =
      first.producer < second.producer ? -1 : first.producer > second.producer ? 1 : 0;
    if (producerOrder !== 0) return producerOrder;
    return first.filePath < second.filePath ? -1 : first.filePath > second.filePath ? 1 : 0;
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
      } else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
        files.push(path);
      }
    }
    return true;
  };
  if (!visit(root)) return undefined;
  return files;
};

const extractPiSessionId = (filePath: string): string | undefined => {
  const headerId = sessionHeaderSessionId(filePath);
  if (headerId !== undefined) return headerId;
  const match = /^.+_([^_]+)\.jsonl$/u.exec(basename(filePath));
  return match?.[1];
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
  const header = parseSessionHeader(firstLine);
  if (header?.type === "session" && typeof header.id === "string" && header.id.length > 0) {
    return header.id;
  }
  return undefined;
};

type SessionHeader = Record<string, unknown> & {
  readonly type?: unknown;
  readonly id?: unknown;
};

const parseSessionHeader = (line: string): SessionHeader | undefined => {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return undefined;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  return value as SessionHeader;
};

const isFileSystemError = (error: unknown, code: string): boolean =>
  error instanceof Error && "code" in error && error.code === code;
