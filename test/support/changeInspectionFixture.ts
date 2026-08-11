import { randomUUID } from "node:crypto";
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { Effect } from "effect";

import type { RepositoryStorageError } from "../../src/contracts/repositoryStorageError.js";
import { RepositorySql } from "../../src/sqlite/repositorySql.js";
import { runByInProcessEffect } from "./by-cli.js";
import { withTestRepository } from "./repository.js";
import { createTestWorkspace } from "./testWorkspace.js";

// These fixtures persist only the rows that Change inspection reads.
// The inspection tests use real SQLite for schema constraints, decoding, ordering, and counts.
export const createInspectionRepository = (): string => {
  const root = createTestWorkspace();
  mkdirSync(join(root, ".git", "but-why"), { recursive: true });
  mkdirSync(join(root, ".but-why"), { recursive: true });
  writeFileSync(
    join(root, ".but-why", "config.json"),
    `${JSON.stringify({ taskPrefix: "BY" }, null, 2)}\n`,
  );
  const fakeGitDirectory = join(root, ".inspection-bin");
  mkdirSync(fakeGitDirectory);
  const fakeGit = join(fakeGitDirectory, "git");
  writeFileSync(
    fakeGit,
    `#!/usr/bin/env bash
set -eu
root=$(pwd -P)
case "$*" in
  "rev-parse --path-format=absolute --show-toplevel --git-common-dir")
    printf '%s\\n%s\\n' "$root" "$root/.git"
    ;;
  "worktree list --porcelain -z")
    printf 'worktree %s\\0HEAD inspection-head\\0branch refs/heads/inspection\\0\\0' "$root"
    ;;
  "rev-parse --symbolic-full-name HEAD")
    printf 'refs/heads/inspection\\n'
    ;;
  *)
    exit 1
    ;;
esac
`,
  );
  chmodSync(fakeGit, 0o755);
  return root;
};

export const runInspectionCommand = (
  root: string,
  args: readonly string[],
  now = "2026-06-30T12:00:00.000Z",
) =>
  Effect.acquireUseRelease(
    Effect.sync(() => {
      const { PATH: inheritedPath } = process.env;
      Object.assign(process.env, {
        PATH: `${join(root, ".inspection-bin")}:${inheritedPath ?? ""}`,
      });
      return inheritedPath;
    }),
    () => runByInProcessEffect(root, args, now),
    (inheritedPath) =>
      Effect.sync(() => {
        if (inheritedPath === undefined) Reflect.deleteProperty(process.env, "PATH");
        else Object.assign(process.env, { PATH: inheritedPath });
      }),
  );

export type CreateChangeInspectionFixtureOptions = {
  readonly taskId?: string;
  readonly baseRef?: string | null;
  readonly worktreePath?: string | null;
  readonly startingCommit?: string | null;
};

export const createTaskFixture = (
  root: string,
  input: {
    readonly id: string;
    readonly numericId: number;
    readonly title: string;
    readonly description: string;
    readonly state: "new" | "todo" | "done" | "cancelled";
    readonly createdAt: string;
    readonly updatedAt: string;
  },
): Effect.Effect<void, RepositoryStorageError> =>
  withTestRepository(
    root,
    Effect.gen(function* () {
      const repository = yield* RepositorySql;
      yield* repository.operation(
        "create Task inspection fixture",
        (sql) => sql`
          INSERT INTO tasks (
            id, numeric_id, title, description, state, cancel_reason, created_at, updated_at
          ) VALUES (
            ${input.id}, ${input.numericId}, ${input.title}, ${input.description}, ${input.state},
            NULL, ${input.createdAt}, ${input.updatedAt}
          )
        `,
      );
    }),
  );

export const createChangeFixture = (
  root: string,
  branchRef: string,
  createdAt: string,
  options: CreateChangeInspectionFixtureOptions = {},
): Effect.Effect<{ readonly id: string }, RepositoryStorageError> =>
  withTestRepository(
    root,
    Effect.gen(function* () {
      const id = randomUUID();
      const repository = yield* RepositorySql;
      let acceptanceContext: string | null = null;
      if (options.taskId !== undefined) {
        const tasks = yield* repository.operation(
          "read linked Task inspection fixture",
          (sql) => sql<{ readonly title: string; readonly description: string }>`
            SELECT title, description
            FROM tasks
            WHERE id = ${options.taskId}
          `,
        );
        const task = tasks[0];
        if (task === undefined) {
          return yield* Effect.dieMessage(
            `Linked Task inspection fixture ${options.taskId} does not exist.`,
          );
        }
        acceptanceContext = JSON.stringify({
          version: 1,
          title: task.title,
          description: task.description,
        });
      }
      const taskBacked = options.taskId !== undefined;
      yield* repository.operation(
        "create Change inspection fixture",
        (sql) => sql`
          INSERT INTO changes (
            id, repository_common_directory, branch_ref, task_id, acceptance_context, state,
            close_reason, created_at, updated_at, closed_at, base_ref, base_remote_url,
            worktree_path, starting_commit
          ) VALUES (
            ${id}, ${join(root, ".git")}, ${branchRef}, ${options.taskId ?? null},
            ${acceptanceContext}, 'open', NULL, ${createdAt}, ${createdAt}, NULL,
            ${options.baseRef === undefined && taskBacked ? "refs/remotes/origin/main" : (options.baseRef ?? null)},
            ${taskBacked ? "https://github.test/acme/repo.git" : null},
            ${options.worktreePath === undefined && taskBacked ? join(root, "worktree") : (options.worktreePath ?? null)},
            ${options.startingCommit === undefined && taskBacked ? "inspection-base" : (options.startingCommit ?? null)}
          )
        `,
      );
      return { id };
    }),
  );

export const closeChangeFixture = (
  root: string,
  changeId: string,
  reason: "cancelled" | "completed",
  closedAt: string,
): Effect.Effect<void, RepositoryStorageError> =>
  withTestRepository(
    root,
    Effect.gen(function* () {
      const repository = yield* RepositorySql;
      yield* repository.operation(
        "close Change inspection fixture",
        (sql) => sql`
          UPDATE changes
          SET state = 'closed',
              close_reason = ${reason},
              closed_at = ${closedAt},
              updated_at = ${closedAt},
              cleanup_state = 'pending'
          WHERE id = ${changeId}
        `,
      );
      if (reason === "completed") {
        yield* repository.operation(
          "complete linked Task inspection fixture",
          (sql) => sql`
            UPDATE tasks
            SET state = 'done', updated_at = ${closedAt}
            WHERE id = (SELECT task_id FROM changes WHERE id = ${changeId})
          `,
        );
      }
    }),
  );

export const captureCandidateFixture = (
  root: string,
  changeId: string,
  headSha: string,
  capturedAt: string,
): Effect.Effect<{ readonly id: string; readonly headSha: string }, RepositoryStorageError> =>
  withTestRepository(
    root,
    Effect.gen(function* () {
      const id = randomUUID();
      const repository = yield* RepositorySql;
      yield* repository.operation(
        "create Candidate inspection fixture",
        (sql) => sql`
          INSERT INTO candidates (id, change_id, change_base_sha, head_sha, created_at)
          VALUES (${id}, ${changeId}, 'target-sha', ${headSha}, ${capturedAt})
        `,
      );
      return { id, headSha };
    }),
  );

export const createValidationRunFixture = (
  root: string,
  input: {
    readonly changeId: string;
    readonly candidateId: string;
    readonly state: "running" | "complete";
    readonly outcome: "passed" | "blocked" | "tooling_failed" | null;
    readonly createdAt: string;
    readonly updatedAt: string;
  },
): Effect.Effect<
  { readonly id: string; readonly validationRunId: string },
  RepositoryStorageError
> =>
  withTestRepository(
    root,
    Effect.gen(function* () {
      const id = randomUUID();
      const repository = yield* RepositorySql;
      const authority = yield* repository.operation(
        "read Validation Run authority fixture",
        (sql) => sql<{ readonly acceptance_context: string | null }>`
          SELECT acceptance_context FROM changes WHERE id = ${input.changeId}
        `,
      );
      const acceptanceContext = authority[0]?.acceptance_context;
      const policy = {
        checks: [{ id: "types", command: "typecheck", timeoutSeconds: 60 }],
        copyFiles: [],
        ...(acceptanceContext === null || acceptanceContext === undefined
          ? {}
          : { acceptanceContext: JSON.parse(acceptanceContext) as unknown }),
      };
      yield* repository.operation("create Validation Run inspection fixture", (sql) =>
        Effect.gen(function* () {
          yield* sql`
            INSERT INTO candidate_validation_runs (
              id, candidate_id, policy_snapshot, implementation_decisions,
              latest_resolved_blocker_id, state, outcome, created_at, updated_at
            ) VALUES (
              ${id}, ${input.candidateId}, ${JSON.stringify(policy)}, '[]',
              (
                SELECT id FROM implementation_blockers
                WHERE change_id = ${input.changeId} AND resolved_at <= ${input.createdAt}
                ORDER BY resolved_at DESC, sequence DESC LIMIT 1
              ),
              ${input.state}, ${input.outcome}, ${input.createdAt}, ${input.updatedAt}
            )
          `;
        }),
      );
      if (input.state === "running") {
        yield* repository.operation(
          "create active Validation Run inspection fixture",
          (sql) => sql`
            INSERT INTO active_validation_runs (change_id, validation_run_id, created_at)
            VALUES (${input.changeId}, ${id}, ${input.createdAt})
          `,
        );
      }
      return { id, validationRunId: id };
    }),
  );

export const completeValidationRunFixture = (
  root: string,
  validationRunId: string,
  outcome: "passed" | "blocked" | "tooling_failed",
  updatedAt: string,
): Effect.Effect<void, RepositoryStorageError> =>
  withTestRepository(
    root,
    Effect.gen(function* () {
      const repository = yield* RepositorySql;
      yield* repository.operation(
        "complete Validation Run inspection fixture",
        (sql) => sql`
          UPDATE candidate_validation_runs
          SET state = 'complete', outcome = ${outcome}, updated_at = ${updatedAt}
          WHERE id = ${validationRunId}
        `,
      );
      yield* repository.operation(
        "remove active Validation Run inspection fixture",
        (sql) => sql`
          DELETE FROM active_validation_runs WHERE validation_run_id = ${validationRunId}
        `,
      );
    }),
  );

export const createFindingFixture = (
  root: string,
  input: {
    readonly id: string;
    readonly validationRunId: string;
    readonly createdAt: string;
  },
): Effect.Effect<void, RepositoryStorageError> =>
  withTestRepository(
    root,
    Effect.gen(function* () {
      const repository = yield* RepositorySql;
      yield* repository.operation(
        "create Finding round inspection fixture",
        (sql) => sql`
          INSERT INTO candidate_validation_rounds (
            validation_run_id, phase, producer, round_number, status, created_at
          ) VALUES (${input.validationRunId}, 'checks', 'types', 1, 'failed', ${input.createdAt})
        `,
      );
      yield* repository.operation(
        "create Finding inspection fixture",
        (sql) => sql`
          INSERT INTO candidate_validation_findings (
            id, validation_run_id, phase, producer, title, description,
            evidence, files, artifact_refs, created_at, updated_at
          ) VALUES (
            ${input.id}, ${input.validationRunId}, 'checks', 'types', 'Check failed: types',
            'Type checking failed.', 'exitCode: 1', '["src/main.ts"]', '[]',
            ${input.createdAt}, ${input.createdAt}
          )
        `,
      );
    }),
  );

export const createToolingFailureFixture = (
  root: string,
  validationRunId: string,
  createdAt: string,
): Effect.Effect<void, RepositoryStorageError> =>
  withTestRepository(
    root,
    Effect.gen(function* () {
      const repository = yield* RepositorySql;
      yield* repository.operation(
        "create Validation Tooling Failure inspection fixture",
        (sql) => sql`
          INSERT INTO candidate_validation_tooling_failures (
            validation_run_id, error_kind, operation_name, error_message, created_at
          ) VALUES (
            ${validationRunId}, 'snapshot_workspace_setup_failed',
            'cleanup_snapshot_workspace', 'Could not remove worktree.', ${createdAt}
          )
        `,
      );
    }),
  );

export const recordImplementationDecisionFixture = (
  root: string,
  changeId: string,
  input: { readonly choice: string; readonly rationale: string; readonly now: string },
): Effect.Effect<{ readonly id: string }, RepositoryStorageError> =>
  withTestRepository(
    root,
    Effect.gen(function* () {
      const id = randomUUID();
      const repository = yield* RepositorySql;
      yield* repository.operation(
        "create Implementation Decision inspection fixture",
        (sql) => sql`
          INSERT INTO implementation_decisions (id, change_id, recorded_at, choice, rationale)
          VALUES (${id}, ${changeId}, ${input.now}, ${input.choice}, ${input.rationale})
        `,
      );
      return { id };
    }),
  );

export const createImplementationBlockerFixture = (
  root: string,
  changeId: string,
  input: {
    readonly reportedAt: string;
    readonly resolvedAt?: string;
    readonly resolutionContent?: string;
  },
): Effect.Effect<{ readonly id: string }, RepositoryStorageError> =>
  withTestRepository(
    root,
    Effect.gen(function* () {
      const id = randomUUID();
      const repository = yield* RepositorySql;
      const resolutionId = input.resolvedAt === undefined ? null : randomUUID();
      yield* repository.operation(
        "create Implementation Blocker inspection fixture",
        (sql) => sql`
          INSERT INTO implementation_blockers (
            id, change_id, reported_at, content, resolved_at,
            resolution_id, resolution_recorded_at, resolution_content
          ) VALUES (
            ${id}, ${changeId}, ${input.reportedAt}, 'Wait for an external decision.',
            ${input.resolvedAt ?? null}, ${resolutionId}, ${input.resolvedAt ?? null},
            ${input.resolutionContent ?? null}
          )
        `,
      );
      return { id };
    }),
  );

export const resolveImplementationBlockerFixture = (
  root: string,
  blockerId: string,
  resolvedAt: string,
): Effect.Effect<void, RepositoryStorageError> =>
  withTestRepository(
    root,
    Effect.gen(function* () {
      const repository = yield* RepositorySql;
      yield* repository.operation(
        "resolve Implementation Blocker inspection fixture",
        (sql) => sql`
          UPDATE implementation_blockers
          SET resolved_at = ${resolvedAt},
              resolution_id = ${randomUUID()},
              resolution_recorded_at = ${resolvedAt},
              resolution_content = 'Proceed with the accepted implementation.'
          WHERE id = ${blockerId}
        `,
      );
    }),
  );
