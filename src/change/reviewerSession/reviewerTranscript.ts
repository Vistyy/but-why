import { Effect } from "effect";

import type { RepositoryStorageError } from "../../contracts/repositoryStorageError.js";
import {
  discoverSessionTranscripts,
  openSessionTranscriptIndex,
  type SessionTranscript,
} from "../../reviewerSession/sessionTranscripts.js";
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
  const neutralIndex = openSessionTranscriptIndex({
    recordTranscripts: ({ ownerId, transcripts }) =>
      dependencies.persistence.recordReviewerTranscripts({
        changeId: ownerId,
        transcripts: transcripts.map(toReviewerTranscript),
      }),
  });
  const index = (input: {
    readonly changeId: string;
    readonly reviewerSessionPath: string;
  }): Effect.Effect<TranscriptIndexResult, RepositoryStorageError> =>
    Effect.map(
      neutralIndex({ ownerId: input.changeId, sessionRoot: input.reviewerSessionPath }),
      (result) => result,
    );
  return index;
};

const toReviewerTranscript = (transcript: SessionTranscript): ReviewerTranscript => ({
  changeId: transcript.ownerId,
  producer: transcript.producer,
  piSessionId: transcript.piSessionId,
  filePath: transcript.filePath,
});

export const discoverReviewerTranscripts = (
  changeRoot: string,
  changeId: string,
): ReviewerTranscriptDiscovery => {
  const discovery = discoverSessionTranscripts(changeRoot, changeId);
  if (!discovery.ok) return discovery;
  return { ok: true, transcripts: discovery.transcripts.map(toReviewerTranscript) };
};
