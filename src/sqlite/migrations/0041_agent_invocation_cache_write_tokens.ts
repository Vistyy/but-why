import * as SqlClient from "@effect/sql/SqlClient";
import { Effect } from "effect";

export const agentInvocationCacheWriteTokensMigration = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`
    ALTER TABLE agent_invocations
    ADD COLUMN cache_write_tokens INTEGER
    CHECK (cache_write_tokens IS NULL OR
           (cache_write_tokens >= 0 AND cache_write_tokens <= 9007199254740991))
  `;
  yield* sql`
    UPDATE agent_invocations
    SET cache_write_tokens = 0
    WHERE input_tokens IS NOT NULL
  `;
});
