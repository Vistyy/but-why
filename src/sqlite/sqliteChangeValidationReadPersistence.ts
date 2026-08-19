import type * as SqlClient from "@effect/sql/SqlClient";
import { Effect } from "effect";

import type { ChangeValidationReadPort } from "../change/validation/changeValidationPorts.js";
import { RepositoryPersistedDataInvalid } from "../contracts/repositoryStorageError.js";
import { RepositorySql } from "../repositoryRuntime/adapters/sqlite/repositorySql.js";
import {
  readCandidateById,
  readCandidatesForChange,
  readCurrentCandidateForChange,
} from "./sqliteCandidateStorage.js";
import {
  listValidationAgentInvocations,
  listValidationArtifacts,
  listValidationFindings,
  listValidationPhaseResults,
  listValidationToolingFailures,
} from "./sqliteValidationEvidenceStorage.js";
import { readValidationRunById } from "./sqliteValidationRunStorage.js";

export const openSqliteChangeValidationReadPort = () =>
  Effect.map(
    RepositorySql,
    (repository): ChangeValidationReadPort => ({
      getCandidateById: (candidateId) =>
        repository.transaction("read Candidate for validation history", (sql) =>
          readCandidateById(
            sql,
            candidateId,
            "read Candidate for validation history",
            repository.idPrefix,
          ),
        ),
      getCurrentCandidateForChange: (changeId) =>
        repository.transaction("read current Candidate", (sql) =>
          readCurrentCandidateForChange(
            sql,
            changeId,
            "read current Candidate",
            repository.idPrefix,
          ),
        ),
      listCandidatesForChange: (changeId) =>
        repository.transaction("list Candidates for validation history", (sql) =>
          readCandidatesForChange(
            sql,
            changeId,
            "list Candidates for validation history",
            repository.idPrefix,
          ),
        ),
      getRunById: (validationRunId) =>
        repository.transaction("read Candidate Validation Run", (sql) =>
          readValidationRunById(
            sql,
            validationRunId,
            "decode Candidate Validation Run",
            repository.idPrefix,
          ),
        ),
      listRunsForCandidate: (candidateId) =>
        repository.transaction("list Candidate Validation Runs", (sql) =>
          listRunsForCandidate(sql, candidateId, repository.idPrefix),
        ),
      listPhaseResults: (validationRunId) =>
        repository.transaction("list Validation Phase Results", (sql) =>
          listValidationPhaseResults(sql, validationRunId, repository.idPrefix),
        ),
      listFindings: (validationRunId) =>
        repository.transaction("list Candidate validation Findings", (sql) =>
          listValidationFindings(sql, validationRunId, repository.idPrefix),
        ),
      listToolingFailures: (validationRunId) =>
        repository.transaction("list Candidate validation Tooling Failures", (sql) =>
          listValidationToolingFailures(sql, validationRunId, repository.idPrefix),
        ),
      listArtifacts: (validationRunId) =>
        repository.transaction("list Candidate validation Artifacts", (sql) =>
          listValidationArtifacts(sql, validationRunId, repository.idPrefix),
        ),
      listAgentInvocations: (validationRunId) =>
        repository.transaction("list Candidate Agent Invocations", (sql) =>
          listValidationAgentInvocations(sql, validationRunId, repository.idPrefix),
        ),
    }),
  );

const listRunsForCandidate = (sql: SqlClient.SqlClient, candidateId: number, idPrefix: string) =>
  Effect.gen(function* () {
    const selected = yield* sql<{ readonly id: number }>`
      SELECT id FROM validation_runs WHERE candidate_id = ${candidateId} ORDER BY id
    `;
    const runs = yield* Effect.forEach(selected, ({ id }) =>
      readValidationRunById(sql, id, "decode Candidate Validation Run", idPrefix).pipe(
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
    return runs;
  });

const invalidData = (operationName: string, message: string) =>
  Effect.fail(new RepositoryPersistedDataInvalid({ operationName, cause: new Error(message) }));
