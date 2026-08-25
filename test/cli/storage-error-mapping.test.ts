import { expect } from "@effect/vitest";
import { describe, it as ordinaryIt } from "vitest";

import { StallDetectionBlockerObservationFailed } from "../../src/change/submitChange.js";
import { submitErrorResult } from "../../src/cli/change/submitResult.js";
import { repositoryStorageErrorResult } from "../../src/cliResults.js";
import {
  RepositoryIdentityConflict,
  RepositoryMigrationFailed,
  RepositoryPersistedDataInvalid,
  RepositorySqlOperationFailed,
  RepositoryStateUnavailable,
} from "../../src/contracts/repositoryStorageError.js";

describe("Shared Repository State error classification", () => {
  ordinaryIt(
    "reports malformed persisted data as persisted_data_invalid with the operation",
    () => {
      const result = repositoryStorageErrorResult(
        new RepositoryPersistedDataInvalid({
          operationName: "read Change",
          cause: new Error("Stored Change publication marker is incomplete"),
        }),
      );

      expect(result.exitCode).toBe(1);
      expect(JSON.parse(JSON.stringify(result.stdout))).toEqual({
        error: {
          code: "persisted_data_invalid",
          message: "Shared But Why? state contains malformed persisted data.",
          operation: "read Change",
        },
        help: [
          "Replace <git-common-dir>/but-why/state.sqlite with a known-good copy, then retry the command.",
        ],
      });
    },
  );

  ordinaryIt(
    "keeps unavailable state, SQL failure, and migration failure as infrastructure results",
    () => {
      const unavailable = repositoryStorageErrorResult(
        new RepositoryStateUnavailable({ statePath: "state.sqlite", cause: new Error("missing") }),
      );
      const sqlFailure = repositoryStorageErrorResult(
        new RepositorySqlOperationFailed({
          operationName: "read Task",
          cause: new Error("database is locked"),
        }),
      );
      const migrationFailure = repositoryStorageErrorResult(
        new RepositoryMigrationFailed({ statePath: "state.sqlite", cause: new Error("migration") }),
      );

      for (const result of [unavailable, sqlFailure, migrationFailure]) {
        expect(result.exitCode).toBe(1);
        expect(JSON.parse(JSON.stringify(result.stdout))).toMatchObject({
          error: { code: "state_store_unavailable" },
        });
      }
    },
  );

  ordinaryIt(
    "adds Stall Detection observation guidance without changing storage classification",
    () => {
      const error = new StallDetectionBlockerObservationFailed({
        storageError: new RepositoryStateUnavailable({
          statePath: "state.sqlite",
          cause: new Error("missing"),
        }),
        changeId: "BY-1",
      });
      const result = submitErrorResult(error);

      expect(result.exitCode).toBe(1);
      expect(JSON.parse(JSON.stringify(result.stdout))).toEqual({
        error: {
          code: "state_store_unavailable",
          message: "Shared But Why? state is unavailable.",
          changeId: "BY-1",
          storageError: "RepositoryStateUnavailable",
        },
        help: [
          "Restore <git-common-dir>/but-why/state.sqlite, then run `by init --id-prefix <prefix>`.",
          "Restore access to valid repository state, inspect the blocker with `by change blocker list BY-1`, then retry `by change submit BY-1`.",
        ],
      });
    },
  );

  ordinaryIt("keeps repository identity conflict as its own result", () => {
    const result = repositoryStorageErrorResult(
      new RepositoryIdentityConflict({
        expectedCommonDirectory: "/expected",
        actualCommonDirectory: "/actual",
      }),
    );

    expect(result.exitCode).toBe(1);
    expect(JSON.parse(JSON.stringify(result.stdout))).toMatchObject({
      error: { code: "shared_state_identity_conflict" },
    });
  });
});
