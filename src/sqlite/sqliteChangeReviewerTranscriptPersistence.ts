import { Effect } from "effect";

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
            WHERE change_id = ${changeId}
          `,
            (rows) =>
              decodePersisted("list Reviewer Transcripts", () =>
                rows
                  .map((row) => decodeReviewerTranscript(row, changeId))
                  .sort(
                    (left, right) =>
                      compareStoredStrings(left.producer, right.producer) ||
                      compareStoredStrings(left.filePath, right.filePath),
                  ),
              ),
          ),
        ),
      recordReviewerTranscripts: (input) =>
        repository.transactionImmediate("record Reviewer Transcripts", (sql) =>
          input.transcripts.length === 0
            ? Effect.void
            : Effect.asVoid(
                sql`
                INSERT INTO reviewer_transcripts
                ${sql.insert(
                  input.transcripts.map((transcript) => ({
                    change_id: input.changeId,
                    producer: transcript.producer,
                    pi_session_id: transcript.piSessionId,
                    file_path: transcript.filePath,
                  })),
                )}
                ON CONFLICT(change_id, producer, file_path) DO NOTHING
              `,
              ),
        ),
    }),
  );
const compareStoredStrings = (left: string, right: string): number =>
  left === right ? 0 : left < right ? -1 : 1;
