import { Effect } from "effect";

import type { ChangeReviewerSessionPort } from "../change/changePorts.js";
import { RepositorySql } from "./repositorySql.js";
import { decodeReviewerSession, type StoredReviewerSessionRow } from "./sqliteChangeReadModel.js";
import { decodePersisted } from "./sqliteTaskReadModel.js";

export const openSqliteChangeReviewerSessionPort = () =>
  Effect.map(
    RepositorySql,
    (repository): ChangeReviewerSessionPort => ({
      getReviewerSession: (changeId, producer) =>
        repository.transaction("read Reviewer Session", (sql) =>
          Effect.flatMap(
            sql<StoredReviewerSessionRow>`
            SELECT change_id AS changeId, producer, fingerprint,
              session_reference AS sessionReference
            FROM reviewer_sessions
            WHERE change_id = ${changeId} AND producer = ${producer}
          `,
            (rows) => {
              const row = rows[0];
              return row === undefined
                ? Effect.succeed(undefined)
                : decodePersisted("read Reviewer Session", () =>
                    decodeReviewerSession(row, changeId),
                  );
            },
          ),
        ),
      saveReviewerSession: (input) =>
        repository.transactionImmediate("save Reviewer Session", (sql) =>
          Effect.asVoid(sql`
          INSERT INTO reviewer_sessions (change_id, producer, fingerprint, session_reference)
          VALUES (${input.changeId}, ${input.producer}, ${input.fingerprint}, ${input.sessionReference})
          ON CONFLICT(change_id, producer) DO UPDATE SET
            fingerprint = excluded.fingerprint,
            session_reference = excluded.session_reference
        `),
        ),
      removeReviewerSession: (changeId, producer) =>
        repository.transactionImmediate("remove Reviewer Session", (sql) =>
          Effect.asVoid(
            sql`DELETE FROM reviewer_sessions WHERE change_id = ${changeId} AND producer = ${producer}`,
          ),
        ),
      removeReviewerSessions: (changeId) =>
        repository.transactionImmediate("remove Reviewer Sessions", (sql) =>
          Effect.asVoid(sql`DELETE FROM reviewer_sessions WHERE change_id = ${changeId}`),
        ),
    }),
  );
