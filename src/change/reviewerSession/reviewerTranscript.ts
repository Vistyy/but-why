import { discoverObservedReviewerTranscripts } from "../../agent/reviewerSession/reviewerTranscript.js";

export type ReviewerTranscript = {
  readonly changeId: string;
  readonly producer: string;
  readonly piSessionId: string;
  readonly filePath: string;
};

export type ReviewerTranscriptDiscovery =
  | { readonly ok: true; readonly transcripts: readonly ReviewerTranscript[] }
  | { readonly ok: false; readonly reason: string };

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
