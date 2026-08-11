import type * as SqlClient from "@effect/sql/SqlClient";
import { Effect } from "effect";

import type { ChangeValidationReadPort } from "../change/validation/changeValidationPorts.js";
import { RepositoryPersistedDataInvalid } from "../contracts/repositoryStorageError.js";
import { RepositorySql } from "./repositorySql.js";
import {
  readCandidateById,
  readCandidatesForChange,
  readCurrentCandidateForChange,
} from "./sqliteCandidateStorage.js";
import { decodePersisted } from "./sqliteTaskReadModel.js";
import {
  listValidationArtifacts,
  listValidationFindings,
  listValidationRounds,
  listValidationToolingFailures,
} from "./sqliteValidationEvidenceStorage.js";
import {
  decodeValidationRun,
  readValidationRunById,
  type StoredValidationRunRow,
  validationRunReadColumns,
} from "./sqliteValidationRunStorage.js";

export const openSqliteChangeValidationReadPort = () =>
  Effect.map(
    RepositorySql,
    (repository): ChangeValidationReadPort => ({
      getCandidateById: (candidateId) =>
        repository.transaction("read Candidate for validation history", (sql) =>
          readCandidateById(sql, candidateId, "read Candidate for validation history"),
        ),
      getCurrentCandidateForChange: (changeId) =>
        repository.transaction("read current Candidate", (sql) =>
          readCurrentCandidateForChange(sql, changeId, "read current Candidate"),
        ),
      listCandidatesForChange: (changeId) =>
        repository.transaction("list Candidates for validation history", (sql) =>
          readCandidatesForChange(sql, changeId, "list Candidates for validation history"),
        ),
      getRunById: (validationRunId) =>
        repository.transaction("read Candidate Validation Run", (sql) =>
          readValidationRunById(sql, validationRunId, "decode Candidate Validation Run"),
        ),
      getLatestRunForCandidate: (candidateId) =>
        repository.transaction("read latest Candidate Validation Run", (sql) =>
          getLatestRunForCandidate(sql, candidateId),
        ),
      listRunsForCandidate: (candidateId) =>
        repository.transaction("list Candidate Validation Runs", (sql) =>
          listRunsForCandidate(sql, candidateId),
        ),
      listRounds: (validationRunId) =>
        repository.transaction("list Candidate validation rounds", (sql) =>
          listValidationRounds(sql, validationRunId),
        ),
      listFindings: (validationRunId) =>
        repository.transaction("list Candidate validation Findings", (sql) =>
          listValidationFindings(sql, validationRunId),
        ),
      listToolingFailures: (validationRunId) =>
        repository.transaction("list Candidate validation Tooling Failures", (sql) =>
          listValidationToolingFailures(sql, validationRunId),
        ),
      listArtifacts: (validationRunId) =>
        repository.transaction("list Candidate validation Artifacts", (sql) =>
          listValidationArtifacts(sql, validationRunId),
        ),
    }),
  );

const getLatestRunForCandidate = (sql: SqlClient.SqlClient, candidateId: string) =>
  Effect.gen(function* () {
    const rows = yield* sql<{ readonly id: string }>`
      SELECT id FROM candidate_validation_runs
      WHERE candidate_id = ${candidateId}
      ORDER BY created_at DESC, id DESC LIMIT 1
    `;
    const row = rows[0];
    if (row === undefined) return undefined;
    const run = yield* readValidationRunById(sql, row.id, "decode Candidate Validation Run");
    if (run === undefined || run.candidateId !== candidateId) {
      return yield* invalidData(
        "read latest Candidate Validation Run",
        "Latest Validation Run belongs to another or unknown Candidate",
      );
    }
    return run;
  });

const listRunsForCandidate = (sql: SqlClient.SqlClient, candidateId: string) =>
  Effect.gen(function* () {
    const rows = yield* sql.unsafe<StoredValidationRunRow>(
      `SELECT ${validationRunReadColumns}
       FROM candidate_validation_runs
       WHERE candidate_id = ?`,
      [candidateId],
    );
    if (rows.length === 0) return [];
    const candidate = yield* readCandidateById(sql, candidateId, "decode Candidate Validation Run");
    if (candidate === undefined) {
      return yield* invalidData(
        "decode Candidate Validation Run",
        "Validation Run history belongs to an unknown Candidate",
      );
    }
    const selectedIds = yield* decodePersisted("decode Candidate Validation Run", () =>
      rows.map((row) => {
        const decoded = decodeValidationRun(row);
        if (decoded.record.candidateId !== candidateId)
          throw new Error("Validation Run belongs to another Candidate");
        return decoded.record.id;
      }),
    );
    const runs = yield* Effect.forEach(selectedIds, (validationRunId) =>
      readValidationRunById(sql, validationRunId, "decode Candidate Validation Run").pipe(
        Effect.flatMap((run) =>
          run === undefined
            ? invalidData(
                "decode Candidate Validation Run",
                "Validation Run history contains an unknown Run",
              )
            : Effect.succeed(run),
        ),
      ),
    );
    return runs.sort(
      (left, right) =>
        compareStrings(left.createdAt, right.createdAt) || compareStrings(left.id, right.id),
    );
  });

const invalidData = (operationName: string, message: string) =>
  Effect.fail(new RepositoryPersistedDataInvalid({ operationName, cause: new Error(message) }));

const compareStrings = (left: string, right: string): number =>
  left === right ? 0 : left < right ? -1 : 1;
