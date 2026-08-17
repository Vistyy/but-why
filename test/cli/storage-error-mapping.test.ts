import { expect } from "@effect/vitest";
import { describe, it as ordinaryIt } from "vitest";

import { repositoryStorageErrorResult } from "../../src/cliResults.js";
import {
  RepositoryIdentityConflict,
  RepositoryMigrationFailed,
  RepositoryPersistedDataInvalid,
  RepositoryPredecessorReconciliationRequired,
  RepositoryRestoredTransientState,
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

  ordinaryIt("preserves predecessor migration recovery guidance", () => {
    const result = repositoryStorageErrorResult(
      new RepositoryPredecessorReconciliationRequired({
        blocked: {
          openChanges: 1,
          activeTaskReviews: 0,
          activeValidationRuns: 0,
          unsettledAgentInvocations: 0,
          pendingTaskReviewCleanup: 0,
          pendingValidationCleanup: 0,
          pendingChangeCleanup: 0,
        },
      }),
    );

    expect(result.exitCode).toBe(1);
    expect(JSON.parse(JSON.stringify(result.stdout))).toEqual({
      error: {
        code: "predecessor_reconciliation_required",
        message:
          "Pinned predecessor reconciliation is required before Shared Repository State can be migrated.",
        blocked: { openChanges: 1 },
      },
      help: [
        "Run the pinned predecessor executable to reconcile the blocked prerelease state, then retry.",
        "Do not restore or initialize Shared Repository State.",
      ],
    });
  });

  ordinaryIt("reports restored retired lifecycle states as restored_transient_state", () => {
    const result = repositoryStorageErrorResult(
      new RepositoryRestoredTransientState({
        tasks: [
          {
            id: "BY-1",
            numericId: 1,
            title: "Restored Task",
            state: "implementing",
            changeId: "change-1",
          },
        ],
        changes: [{ id: "change-1", taskId: "BY-1", state: "blocked" }],
      }),
    );

    expect(result.exitCode).toBe(1);
    expect(JSON.parse(JSON.stringify(result.stdout))).toEqual({
      error: {
        code: "restored_transient_state",
        message: "Shared But Why? state contains retired lifecycle states.",
        tasks: [
          {
            id: "BY-1",
            numericId: 1,
            title: "Restored Task",
            state: "implementing",
            changeId: "change-1",
          },
        ],
        changes: [{ id: "change-1", taskId: "BY-1", state: "blocked" }],
      },
      help: [
        "Restore a known-good copy of <git-common-dir>/but-why/state.sqlite, then retry the command.",
      ],
    });
  });

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
