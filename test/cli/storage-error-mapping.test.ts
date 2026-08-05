import { expect } from "@effect/vitest";
import { describe, it as ordinaryIt } from "vitest";

import { mapRuntimeError } from "../../src/cli.js";
import { repositoryStorageErrorResult } from "../../src/cliResults.js";
import {
  RepositoryIdentityConflict,
  RepositoryMigrationFailed,
  RepositoryPersistedDataInvalid,
  RepositorySqlOperationFailed,
  RepositoryStateUnavailable,
} from "../../src/contracts/repositoryStorageError.js";
import { encodeToon } from "../../src/output/toon.js";

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
      expect(encodeToon(result.stdout)).toBe(`error:
  code: persisted_data_invalid
  message: Shared But Why? state contains malformed persisted data.
  operation: read Change
help[1]: "Replace <git-common-dir>/but-why/state.sqlite with a known-good copy, then retry the command."`);
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

  ordinaryIt("keeps programmer defects as internal_error at the CLI entry boundary", () => {
    const result = mapRuntimeError();

    expect(result.exitCode).toBe(1);
    expect(JSON.parse(JSON.stringify(result.stdout))).toEqual({
      error: { code: "internal_error", message: "The command failed unexpectedly" },
      help: ["Report this failure with the command and workspace path"],
    });
  });
});
