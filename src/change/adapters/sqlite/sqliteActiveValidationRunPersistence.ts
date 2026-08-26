import { Effect } from "effect";
import { RepositorySql } from "../../../repositoryRuntime/adapters/sqlite/repositorySql.js";
import type { ActiveValidationRunPort } from "../../validation/changeValidationPorts.js";
import { readActiveValidationRunForChange } from "./sqliteValidationRunStorage.js";

export const openSqliteActiveValidationRunPort = () =>
  Effect.map(
    RepositorySql,
    (repository): ActiveValidationRunPort => ({
      getActiveForChange: (changeId) =>
        repository.transaction("read Active Candidate Validation Run", (sql) =>
          readActiveValidationRunForChange(
            sql,
            changeId,
            "read Active Candidate Validation Run",
            repository.idPrefix,
          ),
        ),
    }),
  );
