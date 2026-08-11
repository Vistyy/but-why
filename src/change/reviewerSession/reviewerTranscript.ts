import { Effect } from "effect";

import { discoverObservedReviewerTranscripts } from "../../agent/reviewerSession/reviewerTranscript.js";
import type { RepositoryStorageError } from "../../contracts/repositoryStorageError.js";
import type { ChangeReviewerTranscriptPort } from "../changePorts.js";

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

export const openReviewerTranscriptIndex =
  (dependencies: {
    readonly persistence: Pick<ChangeReviewerTranscriptPort, "recordReviewerTranscripts">;
  }): TranscriptIndexOperation =>
  (input) =>
    Effect.gen(function* () {
      const discovery = discoverReviewerTranscripts(input.reviewerSessionPath, input.changeId);
      if (!discovery.ok) return discovery;
      yield* dependencies.persistence.recordReviewerTranscripts({
        changeId: input.changeId,
        transcripts: discovery.transcripts,
      });
      return { ok: true } as const;
    });

export const discoverReviewerTranscripts = (
  changeRoot: string,
  changeId: string,
): ReviewerTranscriptDiscovery => {
  const discovery = discoverObservedReviewerTranscripts(changeRoot, changeId);
  return discovery.ok
    ? {
        ok: true,
        transcripts: discovery.transcripts.map(({ ownerId: _ownerId, ...transcript }) => ({
          changeId,
          ...transcript,
        })),
      }
    : discovery;
};
