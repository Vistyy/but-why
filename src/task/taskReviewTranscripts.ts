import type { Effect } from "effect";

import type { RepositoryStorageError } from "../contracts/repositoryStorageError.js";
import { reviewerSessionsOwnerRoot } from "../reviewerSession/sessionFiles.js";
import {
  openSessionTranscriptIndex,
  type SessionTranscript,
} from "../reviewerSession/sessionTranscripts.js";
import type { PublicTaskId } from "./taskId.js";
import type { TaskReviewPersistence } from "./taskReviewStore.js";

export const indexTaskReviewTranscripts = (
  persistence: TaskReviewPersistence,
  input: { readonly taskId: PublicTaskId; readonly reviewerSessionsRoot: string },
): Effect.Effect<
  { readonly ok: true } | { readonly ok: false; readonly reason: string },
  RepositoryStorageError
> => {
  const index = openSessionTranscriptIndex({
    recordTranscripts: ({ transcripts }) =>
      persistence.recordTaskReviewTranscripts({
        taskId: input.taskId,
        transcripts: transcripts.map(toTaskReviewTranscript(input.taskId)),
      }),
  });
  return index({
    ownerId: input.taskId,
    sessionRoot: reviewerSessionsOwnerRoot(input.reviewerSessionsRoot, input.taskId),
  });
};

const toTaskReviewTranscript =
  (taskId: PublicTaskId) =>
  (
    transcript: SessionTranscript,
  ): {
    readonly taskId: PublicTaskId;
    readonly producer: string;
    readonly piSessionId: string;
    readonly filePath: string;
  } => ({
    taskId,
    producer: transcript.producer,
    piSessionId: transcript.piSessionId,
    filePath: transcript.filePath,
  });
