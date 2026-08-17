import type * as SqlClient from "@effect/sql/SqlClient";
import { Effect } from "effect";

import { internalChangeId, publicChangeId } from "../change/changeId.js";
import type { ValidationArtifactLifecyclePort } from "../change/validation/changeValidationPorts.js";

import { RepositorySql } from "./repositorySql.js";

import { decodePersisted } from "./sqliteTaskReadModel.js";

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
  Effect.gen(function* () {
    const rows = yield* sql<{
      readonly runId: string;
      readonly runCandidateId: string;
      readonly candidateId: string;
      readonly candidateChangeId: number;
      readonly createdAt: string;
    }>`
      SELECT run.id AS runId, run.candidate_id AS runCandidateId,
        candidate.id AS candidateId, candidate.change_id AS candidateChangeId,
        run.created_at AS createdAt
      FROM candidates AS candidate
      JOIN candidate_validation_runs AS run ON run.candidate_id = candidate.id
      WHERE candidate.change_id = ${internalChangeId(changeId, idPrefix)}
    `;
    return yield* decodePersisted("list Candidate Validation Run IDs", () =>
      rows
        .map((row) => {
          const runId = row.runId;
          const runCandidateId = row.runCandidateId;
          const candidateId = row.candidateId;
          const candidateChangeId = row.candidateChangeId;
          if (
            runCandidateId !== candidateId ||
            publicChangeId(idPrefix, candidateChangeId) !== changeId
          ) {
            throw new Error("Validation Run cleanup relationship is inconsistent");
          }
          return {
            id: runId,
            createdAt: row.createdAt,
          };
        })
        .sort(
          (left, right) =>
            compareStrings(left.createdAt, right.createdAt) || compareStrings(left.id, right.id),
        )
        .map(({ id }) => id),
    );
  });

const compareStrings = (left: string, right: string): number =>
  left === right ? 0 : left < right ? -1 : 1;
