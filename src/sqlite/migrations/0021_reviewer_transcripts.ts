import * as SqlClient from "@effect/sql/SqlClient";
import { Effect } from "effect";

export const reviewerTranscriptsMigration = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql.unsafe(`
    CREATE TABLE reviewer_transcripts (
      change_id TEXT NOT NULL,
      producer TEXT NOT NULL,
      pi_session_id TEXT NOT NULL,
      file_path TEXT NOT NULL,
      PRIMARY KEY (change_id, producer, file_path),
      FOREIGN KEY (change_id) REFERENCES changes(id)
    )
  `);
});
