import { Effect } from "effect";

import type { ActiveValidationRunPort } from "../../../change/validation/changeValidationPorts.js";
import { RepositorySql } from "./repositorySql.js";
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
