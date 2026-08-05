import * as SqlClient from "@effect/sql/SqlClient";
import { Effect } from "effect";

export const removeCandidatePublicationsMigration = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`DROP TABLE IF EXISTS candidate_publications`;
});
