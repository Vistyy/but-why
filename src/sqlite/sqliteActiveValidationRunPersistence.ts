import type * as SqlClient from "@effect/sql/SqlClient";
import { Effect } from "effect";

import type { ActiveValidationRunPort } from "../change/validation/changeValidationPorts.js";

import { RepositorySql } from "./repositorySql.js";

import {
  decodeActiveValidationRun,
  type StoredActiveValidationRunRow,
} from "./sqliteCandidateValidationReadModel.js";

import { decodePersisted } from "./sqliteTaskReadModel.js";

export const openSqliteActiveValidationRunPort = () =>
  Effect.map(
    RepositorySql,
    (repository): ActiveValidationRunPort => ({
      getActiveForChange: (changeId) =>
        repository.transaction("read Active Candidate Validation Run", (sql) =>
          getActiveForChange(sql, changeId),
        ),
    }),
  );

const getActiveForChange = (sql: SqlClient.SqlClient, changeId: string) =>
  Effect.gen(function* () {
    const rows = yield* sql<StoredActiveValidationRunRow>`
      SELECT active.validation_run_id AS validationRunId, active.change_id AS changeId,
        run.id AS runId, run.candidate_id AS runCandidateId,
        run.state AS runState, run.outcome AS runOutcome,
        candidate.id AS candidateId, candidate.change_id AS candidateChangeId,
        change_row.id AS storedChangeId
      FROM active_validation_runs AS active
      LEFT JOIN candidate_validation_runs AS run ON run.id = active.validation_run_id
      LEFT JOIN candidates AS candidate ON candidate.id = run.candidate_id
      LEFT JOIN changes AS change_row ON change_row.id = candidate.change_id
      WHERE active.change_id = ${changeId}
    `;
    const row = rows[0];
    return row === undefined
      ? undefined
      : yield* decodePersisted("read Active Candidate Validation Run", () =>
          decodeActiveValidationRun(row, changeId),
        );
  });
