import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { describe } from "vitest";

import { RepositoryPersistedDataInvalid } from "../../src/contracts/repositoryStorageError.js";
import { RepositorySql } from "../../src/sqlite/repositorySql.js";
import { openSqliteCandidateCapturePersistence } from "../../src/sqlite/sqliteCandidateCapturePersistence.js";
import { openSqliteCandidatePublicationPort } from "../../src/sqlite/sqliteCandidatePublicationPersistence.js";
import { openSqliteChangeCancellationPort } from "../../src/sqlite/sqliteChangeCancellationPersistence.js";
import { openSqliteChangeReconciliationPort } from "../../src/sqlite/sqliteChangeReconciliationPersistence.js";
import { openSqliteTerminalChangeCleanupPort } from "../../src/sqlite/sqliteTerminalChangeCleanupPersistence.js";
import { openSqliteTaskChangeCancellationPort } from "../../src/taskChange/adapters/sqlite/sqliteTaskChangeCancellationPersistence.js";
import { openSqliteTaskChangeReconciliationPort } from "../../src/taskChange/adapters/sqlite/sqliteTaskChangeCompletionPersistence.js";
import { openSqliteTaskChangeStartPersistence as openSqliteChangeStartPersistence } from "../../src/taskChange/adapters/sqlite/sqliteTaskChangeStartPersistence.js";
import { openSqliteChangeTestDependencies } from "../support/changePorts.js";
import { withTemporaryRepositoryState } from "../support/repository.js";

const expectPersistedDataInvalid = <A, E>(effect: Effect.Effect<A, E>) =>
  Effect.gen(function* () {
    const error = yield* effect.pipe(Effect.flip);
    expect(error).toBeInstanceOf(RepositoryPersistedDataInvalid);
  });

describe("SQLite Change decoding", () => {
  it.scoped(
    "round-trips Change Start data for a Change without a Task and historical snapshot arrays exactly",
    () =>
      withTemporaryRepositoryState((input) =>
        Effect.gen(function* () {
          const starts = yield* openSqliteChangeStartPersistence();
          const changes = yield* openSqliteChangeTestDependencies();
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
            reviewerConfiguration: { acceptanceReview: null, specialistReviews: [] },
          });
          expect(created).toMatchObject({ ok: true, change: { acceptanceContext: null } });

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
              UPDATE changes SET acceptance_context =
                '{"version":1,"title":"Historical intent","description":"Preserve snapshots.","comments":["first\\ncomment","second"],"resolutions":["keep  spacing"]}'
              WHERE id = 'change-decoded'
            `;
            }),
          );

          const storedWithoutLink = yield* changes.reads.getChangeById("change-decoded");
          expect(storedWithoutLink?.acceptanceContext).toEqual({
            version: 1,
            title: "Historical intent",
            description: "Preserve snapshots.",
            comments: ["first\ncomment", "second"],
            resolutions: ["keep  spacing"],
          });
          yield* expectPersistedDataInvalid(starts.getById("change-decoded"));

          yield* repository.operation(
            "install Change Task link",
            (sql) => sql`
            INSERT INTO task_change_links (task_id, change_id)
            VALUES ('BY-901', 'change-decoded')
          `,
          );

          const stored = yield* changes.reads.getChangeById("change-decoded");
          expect(stored?.acceptanceContext).toEqual({
            version: 1,
            title: "Historical intent",
            description: "Preserve snapshots.",
            comments: ["first\ncomment", "second"],
            resolutions: ["keep  spacing"],
          });
          expect((yield* starts.getById("change-decoded"))?.acceptanceContext).toEqual(
            stored?.acceptanceContext,
          );
        }),
      ),
  );

  it.scoped("scopes malformed Change relationship decoding", () =>
    withTemporaryRepositoryState((input) =>
      Effect.gen(function* () {
        const starts = yield* openSqliteChangeStartPersistence();
        const changes = yield* openSqliteChangeTestDependencies();
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
          reviewerConfiguration: { acceptanceReview: null, specialistReviews: [] },
        });
        if (!created.ok) throw new Error(created.code);

        yield* repository.operation(
          "inject incomplete Change Start",
          (sql) => sql`UPDATE changes SET starting_commit = NULL WHERE id = 'change-malformed'`,
        );
        expect(yield* changes.reads.getChangeById("change-malformed")).toMatchObject({
          startingCommit: null,
        });
        yield* expectPersistedDataInvalid(starts.getById("change-malformed"));
        yield* repository.operation(
          "restore Change Start",
          (sql) =>
            sql`UPDATE changes SET starting_commit = 'base-sha' WHERE id = 'change-malformed'`,
        );

        const other = yield* starts.create({
          id: "change-publication-owner",
          repositoryCommonDirectory: input.commonDirectory,
          branchRef: "refs/heads/change-publication-owner",
          baseRef: "refs/remotes/origin/main",
          baseRemoteUrl: "https://github.com/acme/repo.git",
          startingCommit: "base-sha",
          worktreePath: `${input.commonDirectory}/worktrees/change-publication-owner`,
          now: "2026-08-09T20:10:00.000Z",
          reviewerConfiguration: { acceptanceReview: null, specialistReviews: [] },
        });
        if (!other.ok) throw new Error(other.code);
        yield* repository.operation("inject foreign publication ownership", (sql) =>
          Effect.gen(function* () {
            yield* sql`
              INSERT INTO candidates (id, change_id, change_base_sha, head_sha, created_at)
              VALUES (
                'foreign-candidate', 'change-publication-owner', 'base-sha', 'head-sha',
                '2026-08-09T20:10:00.000Z'
              )
            `;
            yield* sql`
              INSERT INTO candidate_validation_runs (
                id, candidate_id, policy_snapshot, implementation_decisions,
                latest_resolved_blocker_id, state, outcome, created_at, updated_at
              ) VALUES (
                'foreign-run', 'foreign-candidate',
                '{"checks":[],"copyFiles":[],"specialistReviews":[]}', '[]',
                NULL, 'complete', 'passed', '2026-08-09T20:10:00.000Z',
                '2026-08-09T20:10:00.000Z'
              )
            `;
            yield* sql`
              UPDATE changes SET
                publication_candidate_id = 'foreign-candidate',
                publication_validation_run_id = 'foreign-run', publication_owner = 'acme',
                publication_repo = 'repo', publication_base_branch = 'main',
                publication_remote_name = 'origin', publication_head_branch = 'foreign',
                publication_expected_head_sha = 'head-sha'
              WHERE id = 'change-malformed'
            `;
          }),
        );
        yield* expectPersistedDataInvalid(changes.reads.getChangeById("change-malformed"));
        expect(yield* starts.getById("change-malformed")).toMatchObject({
          id: "change-malformed",
          startingCommit: "base-sha",
        });

        yield* repository.operation("inject malformed publication evidence relationships", (sql) =>
          Effect.gen(function* () {
            yield* sql`
              INSERT INTO candidates (id, change_id, change_base_sha, head_sha, created_at)
              VALUES (
                'owned-candidate', 'change-malformed', 'base-sha', 'actual-head',
                '2026-08-09T20:10:00.000Z'
              )
            `;
            yield* sql`
              INSERT INTO candidate_validation_runs (
                id, candidate_id, policy_snapshot, implementation_decisions,
                latest_resolved_blocker_id, state, outcome, created_at, updated_at
              ) VALUES (
                'owned-run', 'owned-candidate',
                '{"checks":[],"copyFiles":[],"specialistReviews":[]}', '[]', NULL,
                'complete', 'passed', '2026-08-09T20:10:00.000Z',
                '2026-08-09T20:10:00.000Z'
              )
            `;
            yield* sql`
              UPDATE changes SET
                publication_candidate_id = 'owned-candidate',
                publication_validation_run_id = 'owned-run', publication_owner = 'acme',
                publication_repo = 'repo', publication_base_branch = 'main',
                publication_remote_name = 'origin', publication_head_branch = 'owned',
                publication_expected_head_sha = 'different-head', publication_pr_number = 7,
                publication_pr_url = 'https://github.test/pull/7'
              WHERE id = 'change-malformed'
            `;
          }),
        );
        yield* expectPersistedDataInvalid(changes.reads.getChangeById("change-malformed"));
        const publicationEvidenceQuery = {
          candidateId: "owned-candidate",
          validationRunId: "owned-run",
          changeBaseSha: "base-sha",
        };
        yield* repository.operation(
          "inject malformed publication snapshots",
          (sql) => sql`
            UPDATE candidate_validation_runs
            SET state = 'complete', policy_snapshot = '{"checks":"invalid"}'
            WHERE id = 'owned-run'
          `,
        );
        expect(
          yield* changes.authority.getCurrentPassingEvidence(
            "change-malformed",
            publicationEvidenceQuery,
          ),
        ).toBeUndefined();
        yield* repository.operation(
          "inject malformed Implementation Decision Snapshot",
          (sql) => sql`
            UPDATE candidate_validation_runs
            SET policy_snapshot = '{"checks":[],"copyFiles":[],"specialistReviews":[]}',
              implementation_decisions = '{}'
            WHERE id = 'owned-run'
          `,
        );
        expect(
          yield* changes.authority.getCurrentPassingEvidence(
            "change-malformed",
            publicationEvidenceQuery,
          ),
        ).toBeUndefined();
        yield* repository.operation(
          "inject foreign publication Implementation Decision",
          (sql) => sql`
            UPDATE candidate_validation_runs
            SET implementation_decisions = '[{"id":"decision-1","changeId":"change-publication-owner","sequence":1,"recordedAt":"2026-08-09T20:10:00.000Z","choice":"Foreign choice","rationale":"Foreign rationale"}]'
            WHERE id = 'owned-run'
          `,
        );
        expect(
          yield* changes.authority.getCurrentPassingEvidence(
            "change-malformed",
            publicationEvidenceQuery,
          ),
        ).toBeUndefined();
        yield* repository.operation("inject foreign latest resolved Blocker", (sql) =>
          Effect.gen(function* () {
            yield* sql`UPDATE candidate_validation_runs SET implementation_decisions = '[]' WHERE id = 'owned-run'`;
            yield* sql`
              INSERT INTO implementation_blockers (
                id, change_id, reported_at, content, resolved_at, resolution_id,
                resolution_recorded_at, resolution_content
              ) VALUES (
                'foreign-blocker', 'change-publication-owner',
                '2026-08-09T20:10:00.000Z', 'Foreign blocker.',
                '2026-08-09T20:10:01.000Z', 'foreign-resolution',
                '2026-08-09T20:10:01.000Z', 'Resolved elsewhere.'
              )
            `;
            yield* sql`
              UPDATE candidate_validation_runs
              SET latest_resolved_blocker_id = 'foreign-blocker'
              WHERE id = 'owned-run'
            `;
          }),
        );
        expect(
          yield* changes.authority.getCurrentPassingEvidence(
            "change-malformed",
            publicationEvidenceQuery,
          ),
        ).toBeUndefined();
        yield* repository.operation(
          "restore absent publication",
          (sql) => sql`
            UPDATE changes SET
              publication_candidate_id = NULL, publication_validation_run_id = NULL,
              publication_owner = NULL, publication_repo = NULL, publication_base_branch = NULL,
              publication_remote_name = NULL, publication_head_branch = NULL,
              publication_expected_head_sha = NULL, publication_pr_number = NULL,
              publication_pr_url = NULL
            WHERE id = 'change-malformed'
          `,
        );

        yield* repository.operation("install unsupported Acceptance Context shape", (sql) =>
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
              UPDATE changes SET acceptance_context =
                '{"version":1,"title":"Malformed intent","description":"Reject it.","unexpected":true}'
              WHERE id = 'change-malformed'
            `;
            yield* sql`
              INSERT INTO task_change_links (task_id, change_id)
              VALUES ('BY-902', 'change-malformed')
            `;
          }),
        );
        yield* expectPersistedDataInvalid(changes.reads.getChangeById("change-malformed"));
        yield* repository.operation(
          "install malformed Acceptance Context resolutions",
          (sql) => sql`
            UPDATE changes SET acceptance_context =
              '{"version":1,"title":"Malformed intent","description":"Reject it.","resolutions":"not-an-array"}'
            WHERE id = 'change-malformed'
          `,
        );
        yield* expectPersistedDataInvalid(changes.reads.getChangeById("change-malformed"));
        yield* repository.operation(
          "restore Change without a Task context",
          (sql) => sql`UPDATE changes SET acceptance_context = NULL WHERE id = 'change-malformed'`,
        );
        yield* repository.operation(
          "remove malformed Change link",
          (sql) => sql`DELETE FROM task_change_links WHERE change_id = 'change-malformed'`,
        );
      }),
    ),
  );

  it.scoped("decodes only Candidate Publication facts", () =>
    withTemporaryRepositoryState((input) =>
      Effect.gen(function* () {
        const starts = yield* openSqliteChangeStartPersistence();
        const publication = yield* openSqliteCandidatePublicationPort();
        const repository = yield* RepositorySql;
        const created = yield* starts.create({
          id: "change-publication-selection",
          repositoryCommonDirectory: input.commonDirectory,
          branchRef: "refs/heads/change-publication-selection",
          baseRef: "refs/remotes/origin/main",
          baseRemoteUrl: "https://github.com/acme/repo.git",
          startingCommit: "base-sha",
          worktreePath: `${input.commonDirectory}/worktrees/change-publication-selection`,
          now: "2026-08-09T20:15:00.000Z",
          reviewerConfiguration: { acceptanceReview: null, specialistReviews: [] },
        });
        if (!created.ok) throw new Error(created.code);

        yield* repository.operation("inject unrelated malformed Change facts", (sql) =>
          Effect.gen(function* () {
            yield* sql`PRAGMA ignore_check_constraints = ON`;
            yield* sql`
              UPDATE changes SET prepare_command = 'just init', cleanup_state = 'unsupported'
              WHERE id = 'change-publication-selection'
            `;
          }),
        );
        expect(yield* publication.getChangeById("change-publication-selection")).toMatchObject({
          id: "change-publication-selection",
          publication: null,
        });

        yield* repository.operation("inject malformed selected publication metadata", (sql) =>
          Effect.gen(function* () {
            yield* sql`
              INSERT INTO tasks (
                id, numeric_id, title, description, state, cancel_reason, created_at, updated_at
              ) VALUES (
                ' BY-904', 904, 'Malformed selected metadata', 'Reject it.', 'todo', NULL,
                '2026-08-09T20:15:00.000Z', '2026-08-09T20:15:00.000Z'
              )
            `;
            yield* sql`
              UPDATE changes SET acceptance_context =
                '{"version":1,"title":"Malformed selected metadata","description":"Reject it."}'
              WHERE id = 'change-publication-selection'
            `;
            yield* sql`
              INSERT INTO task_change_links (task_id, change_id)
              VALUES (' BY-904', 'change-publication-selection')
            `;
          }),
        );
        expect(yield* publication.getChangeById("change-publication-selection")).toMatchObject({
          id: "change-publication-selection",
          publication: null,
        });
      }),
    ),
  );

  it.scoped("keeps workflow projections independent of unrelated Change data", () =>
    withTemporaryRepositoryState((input) =>
      Effect.gen(function* () {
        const capture = yield* openSqliteCandidateCapturePersistence();
        const changes = yield* openSqliteChangeTestDependencies();
        const cancellation = yield* openSqliteTaskChangeCancellationPort();
        const reconciliation = yield* openSqliteTaskChangeReconciliationPort(
          openSqliteChangeReconciliationPort(),
        );
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
        yield* repository.operation("make captured Change linked to a Task", (sql) =>
          Effect.gen(function* () {
            yield* sql`
              INSERT INTO tasks (
                id, numeric_id, title, description, state, cancel_reason, created_at, updated_at
              ) VALUES (
                'BY-903', 903, 'Scoped task lookup', 'Ignore unrelated Blocker history.',
                'todo', NULL, '2026-08-09T20:20:00.000Z', '2026-08-09T20:20:00.000Z'
              )
            `;
            yield* sql`
              UPDATE changes SET acceptance_context =
                '{"version":1,"title":"Scoped task lookup","description":"Ignore unrelated Blocker history."}',
                base_remote_url = 'https://github.com/acme/repo.git',
                starting_commit = 'base-sha', worktree_path = ${input.commonDirectory}
              WHERE id = ${captured.changeId}
            `;
            yield* sql`
              INSERT INTO task_change_links (task_id, change_id)
              VALUES ('BY-903', ${captured.changeId})
            `;
          }),
        );
        const raised = yield* changes.authority.raiseImplementationBlocker({
          changeId: captured.changeId,
          content: "Need authority.",
          now: "2026-08-09T20:21:00.000Z",
        });
        if (!raised.ok) throw new Error(raised.code);

        const firstResolution = yield* changes.authority.resolveImplementationBlocker({
          changeId: captured.changeId,
          content: "Proceed.",
          now: "2026-08-09T20:22:00.000Z",
        });
        if (!firstResolution.ok) throw new Error(firstResolution.code);
        yield* repository.operation("change unrelated Change history", (sql) =>
          Effect.gen(function* () {
            yield* sql`UPDATE implementation_decisions SET choice = 'Changed Decision' WHERE change_id = ${captured.changeId}`;
            yield* sql`UPDATE implementation_blockers SET content = 'Changed Blocker' WHERE id = ${raised.blocker.id}`;
            yield* sql`UPDATE changes SET acceptance_context = 'malformed context' WHERE id = ${captured.changeId}`;
          }),
        );
        expect(
          yield* changes.authority.getCurrentPassingEvidence(captured.changeId),
        ).toBeUndefined();
        yield* repository.operation(
          "restore Acceptance Context",
          (sql) =>
            sql`UPDATE changes SET acceptance_context = '{"version":1,"title":"Scoped task lookup","description":"Ignore unrelated Blocker history."}' WHERE id = ${captured.changeId}`,
        );
        expect(
          yield* changes.authority.recordImplementationDecision({
            changeId: captured.changeId,
            choice: "Record only the new Decision",
            rationale: "Earlier Decision history is not required by this mutation.",
            now: "2026-08-09T20:22:30.000Z",
          }),
        ).toMatchObject({ ok: true });
        expect(
          yield* changes.reads.listChanges({
            repositoryCommonDirectory: input.commonDirectory,
            includeClosed: true,
          }),
        ).toHaveLength(1);
        yield* repository.operation(
          "restore Decision history required by publication",
          (sql) =>
            sql`UPDATE implementation_decisions SET choice = 'Restored Decision'
                WHERE change_id = ${captured.changeId}`,
        );
        const second = yield* changes.authority.raiseImplementationBlocker({
          changeId: captured.changeId,
          content: "Need another decision.",
          now: "2026-08-09T20:23:00.000Z",
        });
        if (!second.ok) throw new Error(second.code);
        yield* repository.operation(
          "change active Blocker outside task cancellation selection",
          (sql) =>
            sql`UPDATE implementation_blockers SET content = 'Changed active Blocker' WHERE id = ${second.blocker.id}`,
        );
        expect(yield* cancellation.getChangeByTaskId("BY-903")).toMatchObject({
          id: captured.changeId,
        });
        expect(yield* changes.publication.getChangeById(captured.changeId)).toMatchObject({
          id: captured.changeId,
          implementationDecisions: [{ choice: "Restored Decision" }],
        });
        yield* repository.operation(
          "restore active Blocker",
          (sql) =>
            sql`UPDATE implementation_blockers SET content = 'Need another decision.' WHERE id = ${second.blocker.id}`,
        );
        const secondResolution = yield* changes.authority.resolveImplementationBlocker({
          changeId: captured.changeId,
          content: "Proceed again.",
          now: "2026-08-09T20:24:00.000Z",
        });
        if (!secondResolution.ok) throw new Error(secondResolution.code);
        expect(yield* cancellation.getChangeById(captured.changeId)).toMatchObject({
          id: captured.changeId,
        });
        expect(yield* changes.submission.getChangeById(captured.changeId)).toMatchObject({
          id: captured.changeId,
        });
        yield* repository.operation(
          "corrupt selected submission data",
          (sql) =>
            sql`UPDATE changes SET acceptance_context = 'malformed context' WHERE id = ${captured.changeId}`,
        );
        yield* expectPersistedDataInvalid(changes.submission.getChangeById(captured.changeId));
        yield* repository.operation(
          "restore selected submission data",
          (sql) =>
            sql`UPDATE changes SET acceptance_context = '{"version":1,"title":"Scoped task lookup","description":"Ignore unrelated Blocker history.","resolutions":["Proceed.","Proceed again."]}' WHERE id = ${captured.changeId}`,
        );
        expect(
          yield* changes.delivery.cancelChange({
            changeId: captured.changeId,
            reason: "Exercise reconciliation selection.",
            now: "2026-08-09T20:25:00.000Z",
          }),
        ).toMatchObject({
          ok: true,
          changed: true,
          change: {
            id: captured.changeId,
            state: "closed",
            closeReason: "cancelled",
            cancelReason: "Exercise reconciliation selection.",
            cleanup: { state: "pending", blockingReason: null },
          },
        });
        yield* repository.operation(
          "add history outside closed projections",
          (sql) =>
            sql`
            INSERT INTO implementation_blockers (id, change_id, reported_at, content)
            VALUES ('closed-active-blocker', ${captured.changeId},
              '2026-08-09T20:26:00.000Z', 'Closed projection does not select this Blocker.')
          `,
        );
        const [closedPublication, closedTaskProjection] = yield* Effect.all([
          Effect.either(changes.publication.getChangeById(captured.changeId)),
          Effect.either(cancellation.getChangeByTaskId("BY-903")),
        ]);
        expect(closedPublication).toMatchObject({ _tag: "Right", right: { state: "closed" } });
        expect(closedTaskProjection).toMatchObject({
          _tag: "Right",
          right: { id: captured.changeId, state: "closed" },
        });
        expect(
          yield* changes.delivery.listChangesForReconciliation(input.commonDirectory),
        ).toHaveLength(1);
        expect(yield* reconciliation.getChangeById(captured.changeId)).toMatchObject({
          id: captured.changeId,
        });
      }),
    ),
  );

  it.scoped("rejects malformed facts selected by each Change workflow", () =>
    withTemporaryRepositoryState((input) =>
      Effect.gen(function* () {
        const starts = yield* openSqliteChangeStartPersistence();
        const changes = yield* openSqliteChangeTestDependencies();
        const publication = yield* openSqliteCandidatePublicationPort();
        const cancellation = yield* openSqliteChangeCancellationPort();
        const reconciliation = yield* openSqliteTaskChangeReconciliationPort(
          openSqliteChangeReconciliationPort(),
        );
        const cleanup = yield* openSqliteTerminalChangeCleanupPort();
        const repository = yield* RepositorySql;
        const created = yield* starts.create({
          id: "change-selected-corruption",
          repositoryCommonDirectory: input.commonDirectory,
          branchRef: "refs/heads/change-selected-corruption",
          baseRef: "refs/remotes/origin/main",
          baseRemoteUrl: "https://github.com/acme/repo.git",
          startingCommit: "base-sha",
          worktreePath: `${input.commonDirectory}/worktrees/change-selected-corruption`,
          now: "2026-08-09T20:27:00.000Z",
          reviewerConfiguration: { acceptanceReview: null, specialistReviews: [] },
        });
        if (!created.ok) throw new Error(created.code);

        yield* repository.operation("inject unsupported selected Change state", (sql) =>
          Effect.gen(function* () {
            yield* sql`PRAGMA ignore_check_constraints = ON`;
            yield* sql`
              UPDATE changes SET state = 'unsupported'
              WHERE id = 'change-selected-corruption'
            `;
          }),
        );
        yield* expectPersistedDataInvalid(starts.getById("change-selected-corruption"));
        yield* expectPersistedDataInvalid(publication.getChangeById("change-selected-corruption"));
        yield* expectPersistedDataInvalid(cancellation.getChangeById("change-selected-corruption"));
        yield* expectPersistedDataInvalid(
          reconciliation.getChangeById("change-selected-corruption"),
        );
        yield* expectPersistedDataInvalid(
          changes.submission.getChangeById("change-selected-corruption"),
        );
        yield* expectPersistedDataInvalid(
          changes.authority.raiseImplementationBlocker({
            changeId: "change-selected-corruption",
            content: "Do not record this Blocker.",
            now: "2026-08-09T20:28:00.000Z",
          }),
        );
        yield* expectPersistedDataInvalid(
          cleanup.recordCleanup({
            changeId: "change-selected-corruption",
            cleanup: { state: "complete", blockingReason: null },
            now: "2026-08-09T20:28:00.000Z",
          }),
        );

        yield* repository.operation(
          "inject incomplete selected publication",
          (sql) =>
            sql`
            UPDATE changes SET state = 'open', publication_owner = 'acme'
            WHERE id = 'change-selected-corruption'
          `,
        );
        yield* expectPersistedDataInvalid(publication.getChangeById("change-selected-corruption"));
        yield* expectPersistedDataInvalid(cancellation.getChangeById("change-selected-corruption"));
        yield* expectPersistedDataInvalid(
          reconciliation.getChangeById("change-selected-corruption"),
        );
        yield* expectPersistedDataInvalid(
          changes.submission.getChangeById("change-selected-corruption"),
        );
        expect(yield* starts.getById("change-selected-corruption")).toMatchObject({
          id: "change-selected-corruption",
        });

        yield* repository.operation(
          "inject unsupported selected cleanup state",
          (sql) =>
            sql`
            UPDATE changes SET publication_owner = NULL, state = 'closed',
              close_reason = 'cancelled', closed_at = '2026-08-09T20:29:00.000Z',
              cleanup_state = 'unsupported'
            WHERE id = 'change-selected-corruption'
          `,
        );
        yield* expectPersistedDataInvalid(cancellation.getChangeById("change-selected-corruption"));
        yield* expectPersistedDataInvalid(
          reconciliation.getChangeById("change-selected-corruption"),
        );
        yield* expectPersistedDataInvalid(
          cleanup.recordCleanup({
            changeId: "change-selected-corruption",
            cleanup: { state: "complete", blockingReason: null },
            now: "2026-08-09T20:30:00.000Z",
          }),
        );
        expect(yield* publication.getChangeById("change-selected-corruption")).toMatchObject({
          state: "closed",
        });
      }),
    ),
  );

  it.scoped(
    "returns authoritative cleanup facts without decoding unrelated Change observations",
    () =>
      withTemporaryRepositoryState((input) =>
        Effect.gen(function* () {
          const starts = yield* openSqliteChangeStartPersistence();
          const cleanup = yield* openSqliteTerminalChangeCleanupPort();
          const repository = yield* RepositorySql;
          const created = yield* starts.create({
            id: "cleanup-selected-data",
            repositoryCommonDirectory: input.commonDirectory,
            branchRef: "refs/heads/cleanup-selected-data",
            baseRef: "refs/remotes/origin/main",
            baseRemoteUrl: "https://github.com/acme/repo.git",
            startingCommit: "base-sha",
            worktreePath: `${input.commonDirectory}/worktrees/cleanup-selected-data`,
            now: "2026-08-09T20:30:00.000Z",
            reviewerConfiguration: { acceptanceReview: null, specialistReviews: [] },
          });
          if (!created.ok) throw new Error(created.code);
          yield* repository.operation("close Change with malformed unrelated data", (sql) =>
            Effect.gen(function* () {
              yield* sql`PRAGMA ignore_check_constraints = ON`;
              yield* sql`
                UPDATE changes
                SET state = 'closed', close_reason = 'cancelled',
                  closed_at = '2026-08-09T20:31:00.000Z', cleanup_state = 'pending',
                  acceptance_context = 'malformed unrelated context'
                WHERE id = 'cleanup-selected-data'
              `;
            }),
          );

          expect(
            yield* cleanup.recordCleanup({
              changeId: "cleanup-selected-data",
              cleanup: { state: "complete", blockingReason: null },
              now: "2026-08-09T20:32:00.000Z",
            }),
          ).toEqual({
            ok: true,
            changed: true,
            cleanup: { state: "complete", blockingReason: null },
          });
        }),
      ),
  );
});
