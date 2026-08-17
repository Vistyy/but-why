import { Effect } from "effect";

import { internalChangeId } from "../change/changeId.js";
import type { ChangeReviewerTranscriptPort } from "../change/changePorts.js";
import { RepositorySql } from "./repositorySql.js";
import {
  decodeReviewerTranscript,
  type StoredReviewerTranscriptRow,
} from "./sqliteChangeReadModel.js";
import { decodePersisted } from "./sqliteTaskReadModel.js";

export const openSqliteChangeReviewerTranscriptPort = () =>
  Effect.map(
    RepositorySql,
    (repository): ChangeReviewerTranscriptPort => ({
      listReviewerTranscripts: (changeId) =>
        repository.transaction("list Reviewer Transcripts", (sql) =>
          Effect.flatMap(
            sql<StoredReviewerTranscriptRow>`
            SELECT change_id AS changeId, producer, pi_session_id AS piSessionId,
              file_path AS filePath
            FROM reviewer_transcripts
            WHERE change_id = ${internalChangeId(changeId, repository.idPrefix)}
          `,
            (rows) =>
              decodePersisted("list Reviewer Transcripts", () =>
                rows
                  .map((row) => decodeReviewerTranscript(row, changeId, repository.idPrefix))
                  .sort(
                    (left, right) =>
                      compareStoredStrings(left.producer, right.producer) ||
                      compareStoredStrings(left.filePath, right.filePath),
                  ),
              ),
          ),
        ),
    }),
  );
const compareStoredStrings = (left: string, right: string): number =>
  left === right ? 0 : left < right ? -1 : 1;
