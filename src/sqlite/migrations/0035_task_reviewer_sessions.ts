import * as SqlClient from "@effect/sql/SqlClient";
import { Effect } from "effect";

const statements = [
  `
    CREATE TABLE task_reviewer_sessions (
      task_id TEXT PRIMARY KEY,
      fingerprint TEXT NOT NULL,
      session_reference TEXT NOT NULL,
      FOREIGN KEY (task_id) REFERENCES tasks(id)
    )
  `,
  `
    CREATE TABLE task_review_executions (
      review_id TEXT PRIMARY KEY,
      continuity TEXT NOT NULL CHECK (continuity IN ('fresh', 'resumed', 'restarted')),
      identity_fingerprint TEXT NOT NULL,
      restart_reason TEXT,
      duration_ms INTEGER NOT NULL,
      review_calls INTEGER NOT NULL,
      invocation_usage TEXT NOT NULL,
      session_reference TEXT,
      FOREIGN KEY (review_id) REFERENCES task_reviews(id)
    )
  `,
  `
    CREATE TABLE task_reviewer_transcripts (
      sequence INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id TEXT NOT NULL,
      producer TEXT NOT NULL,
      pi_session_id TEXT NOT NULL,
      file_path TEXT NOT NULL,
      FOREIGN KEY (task_id) REFERENCES tasks(id),
      UNIQUE (task_id, producer, file_path)
    )
  `,
  `
    CREATE TABLE task_review_transcript_observations (
      review_id TEXT NOT NULL,
      transcript_sequence INTEGER NOT NULL,
      PRIMARY KEY (review_id, transcript_sequence),
      FOREIGN KEY (review_id) REFERENCES task_reviews(id),
      FOREIGN KEY (transcript_sequence) REFERENCES task_reviewer_transcripts(sequence)
    )
  `,
] as const;

export const taskReviewerSessionsMigration = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  for (const statement of statements) yield* sql.unsafe(statement);
});
