import type * as SqlClient from "@effect/sql/SqlClient";
import type { SqlError } from "@effect/sql/SqlError";
import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { describe } from "vitest";

import { RepositoryPersistedDataInvalid } from "../../src/contracts/repositoryStorageError.js";
import { RepositorySql } from "../../src/sqlite/repositorySql.js";
import { openSqliteCandidateCapturePersistence } from "../../src/sqlite/sqliteCandidateCapturePersistence.js";
import { openSqliteChangePersistence } from "../../src/sqlite/sqliteChangePersistence.js";
import { openSqliteChangeStartPersistence } from "../../src/sqlite/sqliteChangeStartPersistence.js";
import { withTemporaryRepositoryState } from "../support/repository.js";

const expectPersistedDataInvalid = <A, E>(effect: Effect.Effect<A, E>) =>
  Effect.gen(function* () {
    const error = yield* effect.pipe(Effect.flip);
    expect(error).toBeInstanceOf(RepositoryPersistedDataInvalid);
  });

describe("SQLite Change decoding", () => {
  it.scoped("round-trips taskless Change Start data and historical snapshot arrays exactly", () =>
    withTemporaryRepositoryState((input) =>
      Effect.gen(function* () {
        const starts = yield* openSqliteChangeStartPersistence();
        const changes = yield* openSqliteChangePersistence();
        const repository = yield* RepositorySql;
        const created = yield* starts.create({
          id: "change-decoded",
          repositoryCommonDirectory: input.commonDirectory,
          branchRef: "refs/heads/change-decoded",
          baseRef: "refs/remotes/origin/main",
          baseRemoteUrl: "https://github.com/acme/repo.git",
          startingCommit: "base-sha",
          worktreePath: `${input.commonDirectory}/worktrees/change-decoded`,
          prepare: { command: "just init", timeoutSeconds: 120 },
          now: "2026-08-09T20:00:00.000Z",
        });
        expect(created).toMatchObject({ ok: true, change: { taskId: null } });

        yield* repository.operation("install historical Acceptance Context", (sql) =>
          Effect.gen(function* () {
            yield* sql`
              INSERT INTO tasks (
                id, numeric_id, title, description, state, cancel_reason, created_at, updated_at
              ) VALUES (
                'BY-901', 901, 'Historical intent', 'Preserve snapshots.', 'todo', NULL,
                '2026-08-09T20:00:00.000Z', '2026-08-09T20:00:00.000Z'
              )
            `;
            yield* sql`
              UPDATE changes
              SET task_id = 'BY-901', acceptance_context =
                '{"version":1,"title":"Historical intent","description":"Preserve snapshots.","comments":["first\\ncomment","second"],"resolutions":["keep  spacing"]}'
              WHERE id = 'change-decoded'
            `;
          }),
        );

        const stored = yield* changes.getChangeById("change-decoded");
        expect(stored?.acceptanceContext).toEqual({
          version: 1,
          title: "Historical intent",
          description: "Preserve snapshots.",
          comments: ["first\ncomment", "second"],
          resolutions: ["keep  spacing"],
        });
      }),
    ),
  );

  it.scoped("rejects malformed Change relationships before filtering or selection", () =>
    withTemporaryRepositoryState((input) =>
      Effect.gen(function* () {
        const starts = yield* openSqliteChangeStartPersistence();
        const changes = yield* openSqliteChangePersistence();
        const repository = yield* RepositorySql;
        const created = yield* starts.create({
          id: "change-malformed",
          repositoryCommonDirectory: input.commonDirectory,
          branchRef: "refs/heads/change-malformed",
          baseRef: "refs/remotes/origin/main",
          baseRemoteUrl: "https://github.com/acme/repo.git",
          startingCommit: "base-sha",
          worktreePath: `${input.commonDirectory}/worktrees/change-malformed`,
          now: "2026-08-09T20:10:00.000Z",
        });
        if (!created.ok) throw new Error(created.code);

        yield* repository.operation(
          "inject incomplete Change Start",
          (sql) => sql`UPDATE changes SET starting_commit = NULL WHERE id = 'change-malformed'`,
        );
        expect(yield* changes.getChangeById("change-malformed")).toMatchObject({
          taskId: null,
          startingCommit: null,
        });
        yield* expectPersistedDataInvalid(starts.getById("change-malformed"));
        yield* repository.operation(
          "restore Change Start",
          (sql) =>
            sql`UPDATE changes SET starting_commit = 'base-sha' WHERE id = 'change-malformed'`,
        );

        const corruptAndReject = (
          label: string,
          update: (sql: SqlClient.SqlClient) => Effect.Effect<unknown, SqlError>,
          read: Effect.Effect<unknown, unknown> = changes.getChangeById("change-malformed"),
        ) =>
          Effect.gen(function* () {
            yield* repository.operation(`inject ${label}`, (sql) => Effect.asVoid(update(sql)));
            yield* expectPersistedDataInvalid(read);
          });

        yield* corruptAndReject(
          "incomplete preparation",
          (sql) =>
            sql`UPDATE changes SET prepare_command = 'just init' WHERE id = 'change-malformed'`,
        );
        yield* repository.operation(
          "restore preparation",
          (sql) => sql`UPDATE changes SET prepare_command = NULL WHERE id = 'change-malformed'`,
        );

        yield* corruptAndReject(
          "incomplete publication",
          (sql) =>
            sql`UPDATE changes SET publication_candidate_id = 'candidate' WHERE id = 'change-malformed'`,
        );
        yield* repository.operation(
          "restore publication",
          (sql) =>
            sql`UPDATE changes SET publication_candidate_id = NULL WHERE id = 'change-malformed'`,
        );

        yield* repository.operation("install malformed Acceptance Context", (sql) =>
          Effect.gen(function* () {
            yield* sql`
              INSERT INTO tasks (
                id, numeric_id, title, description, state, cancel_reason, created_at, updated_at
              ) VALUES (
                'BY-902', 902, 'Malformed intent', 'Reject it.', 'todo', NULL,
                '2026-08-09T20:10:00.000Z', '2026-08-09T20:10:00.000Z'
              )
            `;
            yield* sql`
              UPDATE changes SET task_id = 'BY-902', acceptance_context =
                '{"version":1,"title":"Malformed intent","description":"Reject it.","resolutions":"not-an-array"}'
              WHERE id = 'change-malformed'
            `;
          }),
        );
        yield* expectPersistedDataInvalid(changes.getChangeById("change-malformed"));
        yield* repository.operation(
          "restore taskless context",
          (sql) =>
            sql`UPDATE changes SET task_id = NULL, acceptance_context = NULL WHERE id = 'change-malformed'`,
        );

        yield* repository.operation("inject hidden lifecycle corruption", (sql) =>
          Effect.gen(function* () {
            yield* sql`PRAGMA ignore_check_constraints = ON`;
            yield* sql`
              UPDATE changes SET state = 'closed', close_reason = NULL, closed_at = NULL
              WHERE id = 'change-malformed'
            `;
          }),
        );
        yield* expectPersistedDataInvalid(
          changes.listChanges({
            repositoryCommonDirectory: input.commonDirectory,
            includeClosed: false,
          }),
        );
      }),
    ),
  );

  it.scoped("rejects partial blocker resolution and malformed Change-shaped capture rows", () =>
    withTemporaryRepositoryState((input) =>
      Effect.gen(function* () {
        const capture = yield* openSqliteCandidateCapturePersistence();
        const changes = yield* openSqliteChangePersistence();
        const repository = yield* RepositorySql;
        const captured = yield* capture.commitCapture({
          repositoryCommonDirectory: input.commonDirectory,
          branchRef: "refs/heads/capture-decoding",
          baseRef: "refs/remotes/origin/main",
          changeBaseSha: "base-sha",
          headSha: "head-sha",
          now: "2026-08-09T20:20:00.000Z",
        });
        if (!captured.ok) throw new Error(captured.code);
        const raised = yield* changes.raiseImplementationBlocker({
          changeId: captured.changeId,
          content: "Need authority.",
          now: "2026-08-09T20:21:00.000Z",
        });
        if (!raised.ok) throw new Error(raised.code);

        yield* repository.operation(
          "inject partial blocker resolution",
          (sql) =>
            sql`
            UPDATE implementation_blockers
            SET resolved_at = '2026-08-09T20:22:00.000Z', resolution_id = 'resolution-1'
            WHERE id = ${raised.blocker.id}
          `,
        );
        yield* expectPersistedDataInvalid(changes.listImplementationBlockers(captured.changeId));

        yield* repository.operation(
          "complete first blocker resolution",
          (sql) =>
            sql`
            UPDATE implementation_blockers
            SET resolution_recorded_at = '2026-08-09T20:22:00.000Z',
              resolution_content = 'Proceed.'
            WHERE id = ${raised.blocker.id}
          `,
        );
        const second = yield* changes.raiseImplementationBlocker({
          changeId: captured.changeId,
          content: "Need another decision.",
          now: "2026-08-09T20:23:00.000Z",
        });
        if (!second.ok) throw new Error(second.code);
        const secondResolution = yield* changes.resolveImplementationBlocker({
          changeId: captured.changeId,
          content: "Proceed again.",
          now: "2026-08-09T20:24:00.000Z",
        });
        if (!secondResolution.ok) throw new Error(secondResolution.code);
        yield* repository.operation(
          "make a Resolution belong to two Blockers",
          (sql) =>
            sql`
            UPDATE implementation_blockers SET resolution_id = 'resolution-1'
            WHERE id = ${second.blocker.id}
          `,
        );
        yield* expectPersistedDataInvalid(changes.listImplementationBlockers(captured.changeId));

        yield* repository.operation("inject malformed capture lifecycle", (sql) =>
          Effect.gen(function* () {
            yield* sql`PRAGMA ignore_check_constraints = ON`;
            yield* sql`UPDATE changes SET state = 'retired' WHERE id = ${captured.changeId}`;
          }),
        );
        yield* expectPersistedDataInvalid(capture.getChangeById(captured.changeId));
      }),
    ),
  );
});
