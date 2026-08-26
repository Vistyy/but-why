import type * as SqlClient from "@effect/sql/SqlClient";
import { Effect } from "effect";
import { RepositorySql } from "../../../repositoryRuntime/adapters/sqlite/repositorySql.js";
import { decodePersisted } from "../../../repositoryRuntime/adapters/sqlite/sqlitePersistedData.js";
import { internalChangeId, publicChangeId } from "../../changeId.js";
import type { ValidationArtifactLifecyclePort } from "../../validation/changeValidationPorts.js";

export const openSqliteValidationArtifactLifecyclePort = () =>
  Effect.map(
    RepositorySql,
    (repository): ValidationArtifactLifecyclePort => ({
      listRunIdsForChange: (changeId) =>
        repository.transaction("list Candidate Validation Run IDs", (sql) =>
          listRunIdsForChange(sql, changeId, repository.idPrefix),
        ),
    }),
  );

const listRunIdsForChange = (sql: SqlClient.SqlClient, changeId: string, idPrefix: string) =>
  Effect.flatMap(
    sql<{
      readonly runId: number;
      readonly runCandidateId: number;
      readonly candidateId: number;
      readonly candidateChangeId: number;
    }>`
      SELECT run.id AS runId, run.candidate_id AS runCandidateId,
        candidate.id AS candidateId, candidate.change_id AS candidateChangeId
      FROM candidates AS candidate
      JOIN validation_runs AS run ON run.candidate_id = candidate.id
      WHERE candidate.change_id = ${internalChangeId(changeId, idPrefix)}
      ORDER BY run.id
    `,
    (rows) =>
      decodePersisted("list Candidate Validation Run IDs", () =>
        rows.map((row) => {
          if (
            row.runCandidateId !== row.candidateId ||
            publicChangeId(idPrefix, row.candidateChangeId) !== changeId
          ) {
            throw new Error("Validation Run cleanup relationship is inconsistent");
          }
          return row.runId;
        }),
      ),
  );
