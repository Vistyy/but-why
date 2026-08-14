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
import {
  listValidationAgentInvocations,
  listValidationArtifacts,
  listValidationFindings,
  listValidationRounds,
  listValidationToolingFailures,
} from "./sqliteValidationEvidenceStorage.js";
import { readValidationRunById } from "./sqliteValidationRunStorage.js";

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
      listAgentInvocations: (validationRunId) =>
        repository.transaction("list Candidate Agent Invocations", (sql) =>
          listValidationAgentInvocations(sql, validationRunId),
        ),
    }),
  );

const listRunsForCandidate = (sql: SqlClient.SqlClient, candidateId: string) =>
  Effect.gen(function* () {
    const selected = yield* sql<{ readonly id: string }>`
      SELECT id FROM candidate_validation_runs WHERE candidate_id = ${candidateId}
    `;
    const runs = yield* Effect.forEach(selected, ({ id }) =>
      readValidationRunById(sql, id, "decode Candidate Validation Run").pipe(
        Effect.flatMap((run) => {
          if (run === undefined) {
            return invalidData(
              "decode Candidate Validation Run",
              "Validation Run history contains an unknown Run",
            );
          }
          return run.candidateId === candidateId
            ? Effect.succeed(run)
            : invalidData(
                "decode Candidate Validation Run",
                "Validation Run belongs to another Candidate",
              );
        }),
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
