import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type * as SqlClient from "@effect/sql/SqlClient";
import { Effect } from "effect";
import { internalChangeId, publicChangeId } from "../../src/change/changeId.js";
import type { RepositoryStorageError } from "../../src/contracts/repositoryStorageError.js";
import { RepositorySql } from "../../src/sqlite/repositorySql.js";
import { decodeSqliteAcceptanceContextSnapshot } from "../../src/sqlite/sqliteAcceptanceContextSnapshot.js";
import {
  decodeImplementationBlockerHistory,
  deriveAcceptanceContext,
  implementationBlockerReadColumns,
  type StoredImplementationBlockerRow,
} from "../../src/sqlite/sqliteChangeAuthorityHistory.js";
import { encodeSqliteValidationInputSnapshot } from "../../src/sqlite/sqliteValidationInputSnapshot.js";
import { internalTaskId } from "../../src/task/taskId.js";
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
    `${JSON.stringify({ idPrefix: "BY" }, null, 2)}\n`,
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
          INSERT INTO tasks (id, title, description, state)
          VALUES (${input.numericId}, ${input.title}, ${input.description}, ${input.state})
        `,
      );
    }),
  );

export const createChangeFixture = (
  root: string,
  branchRef: string,
  _createdAt: string,
  options: CreateChangeInspectionFixtureOptions = {},
): Effect.Effect<{ readonly id: string }, RepositoryStorageError> =>
  withTestRepository(
    root,
    Effect.gen(function* () {
      const repository = yield* RepositorySql;
      const taskId = options.taskId;
      let acceptanceContext: string | null = null;
      if (taskId !== undefined) {
        const tasks = yield* repository.operation(
          "read linked Task inspection fixture",
          (sql) => sql<{ readonly title: string; readonly description: string }>`
            SELECT title, description FROM tasks WHERE id = ${internalTaskId(taskId, "BY")}
          `,
        );
        const task = tasks[0];
        if (task === undefined) {
          return yield* Effect.dieMessage(
            `Linked Task inspection fixture ${taskId} does not exist.`,
          );
        }
        acceptanceContext = JSON.stringify({
          version: 1,
          title: task.title,
          description: task.description,
        });
      }
      const inserted = yield* repository.operation(
        "create Change inspection fixture",
        (sql) => sql<{ readonly id: number }>`
          INSERT INTO changes (
            branch_ref, base_ref, base_remote_url, worktree_path,
            initial_acceptance_context, reviewer_configuration,
            checks_definition, cleanup_pending
          ) VALUES (
            ${branchRef}, ${options.baseRef ?? "refs/remotes/origin/main"},
            'https://github.test/acme/repo.git',
            ${options.worktreePath ?? join(root, `worktree-${branchRef.split("/").at(-1) ?? "change"}`)},
            ${acceptanceContext}, '{"acceptanceReview":null,"specialistReviews":[]}', '[]', 0
          )
          RETURNING id
        `,
      );
      const allocatedId = inserted[0]?.id;
      if (typeof allocatedId !== "number") {
        return yield* Effect.dieMessage("Change identity was not allocated.");
      }
      const id = publicChangeId("BY", allocatedId);
      if (taskId !== undefined) {
        yield* repository.operation(
          "link Change inspection fixture to its Task",
          (sql) => sql`
            INSERT INTO task_change_links (task_id, change_id)
            VALUES (${internalTaskId(taskId, "BY")}, ${allocatedId})
          `,
        );
      }
      return { id };
    }),
  );

export const closeChangeFixture = (
  root: string,
  changeId: string,
  reason: "cancelled" | "completed",
  _closedAt: string,
): Effect.Effect<void, RepositoryStorageError> =>
  withTestRepository(
    root,
    Effect.gen(function* () {
      const repository = yield* RepositorySql;
      yield* repository.operation(
        "close Change inspection fixture",
        (sql) => sql`
          UPDATE changes
          SET close_reason = ${reason},
              cancel_reason = ${reason === "cancelled" ? "Cancelled by inspection fixture." : null},
              cleanup_pending = 1
          WHERE id = ${internalChangeId(changeId, "BY")}
        `,
      );
      if (reason === "completed") {
        yield* repository.operation(
          "complete linked Task inspection fixture",
          (sql) => sql`
            UPDATE tasks SET state = 'done'
            WHERE id = (
              SELECT task_id FROM task_change_links WHERE change_id = ${internalChangeId(changeId, "BY")}
            )
          `,
        );
      }
    }),
  );

export const captureCandidateFixture = (
  root: string,
  changeId: string,
  headSha: string,
  _capturedAt: string,
): Effect.Effect<{ readonly id: number; readonly headSha: string }, RepositoryStorageError> =>
  withTestRepository(
    root,
    Effect.gen(function* () {
      const repository = yield* RepositorySql;
      const inserted = yield* repository.operation(
        "create Candidate inspection fixture",
        (sql) => sql<{ readonly id: number }>`
          INSERT INTO candidates (change_id, base_commit, head_commit)
          VALUES (${internalChangeId(changeId, "BY")}, 'target-sha', ${headSha})
          RETURNING id
        `,
      );
      const id = inserted[0]?.id;
      if (id === undefined)
        return yield* Effect.dieMessage("Candidate identity was not allocated.");
      return { id, headSha };
    }),
  );

export const createValidationRunFixture = (
  root: string,
  input: {
    readonly changeId: string;
    readonly candidateId: number;
    readonly state: "running" | "complete";
    readonly outcome: "passed" | "blocked" | "tooling_failed" | null;
    readonly createdAt: string;
    readonly updatedAt: string;
  },
): Effect.Effect<
  { readonly id: number; readonly validationRunId: number },
  RepositoryStorageError
> =>
  withTestRepository(
    root,
    Effect.gen(function* () {
      const repository = yield* RepositorySql;
      const inserted = yield* repository.operation(
        "create Validation Run inspection fixture",
        (sql) =>
          Effect.gen(function* () {
            const changeRows = yield* sql<{ readonly acceptanceContext: string | null }>`
              SELECT initial_acceptance_context AS acceptanceContext
              FROM changes WHERE id = ${internalChangeId(input.changeId, "BY")}
            `;
            const initialContext =
              changeRows[0]?.acceptanceContext === null || changeRows[0] === undefined
                ? null
                : decodeSqliteAcceptanceContextSnapshot(changeRows[0].acceptanceContext);
            const blockerRows = yield* sql.unsafe<StoredImplementationBlockerRow>(
              `SELECT ${implementationBlockerReadColumns}
               FROM implementation_blockers WHERE change_id = ? ORDER BY id`,
              [internalChangeId(input.changeId, "BY")],
            );
            const blockerHistory = decodeImplementationBlockerHistory(
              blockerRows,
              input.changeId,
              "BY",
            );
            const acceptanceContext = deriveAcceptanceContext(initialContext, blockerHistory);
            const validationInputSnapshot = encodeSqliteValidationInputSnapshot(
              acceptanceContext === null ? {} : { acceptanceContext },
            );
            return yield* sql<{ readonly id: number }>`
              INSERT INTO validation_runs (
                candidate_id, validation_input_snapshot, highest_decision_id, highest_blocker_id,
                outcome, cleanup_pending
              ) VALUES (
                ${input.candidateId}, ${validationInputSnapshot},
                (SELECT MAX(id) FROM implementation_decisions WHERE change_id = ${internalChangeId(input.changeId, "BY")}),
                (SELECT MAX(id) FROM implementation_blockers WHERE change_id = ${internalChangeId(input.changeId, "BY")}),
                ${input.state === "running" ? null : input.outcome}, 0
              )
              RETURNING id
            `;
          }),
      );
      const id = inserted[0]?.id;
      if (id === undefined) {
        return yield* Effect.dieMessage("Validation Run identity was not allocated.");
      }
      const completedOutcome = input.state === "complete" ? input.outcome : null;
      if (completedOutcome !== null) {
        yield* repository.operation("create Validation completion evidence fixture", (sql) =>
          recordValidationCompletionEvidence(sql, id, completedOutcome),
        );
      }
      return { id, validationRunId: id };
    }),
  );

export const completeValidationRunFixture = (
  root: string,
  validationRunId: number,
  outcome: "passed" | "blocked" | "tooling_failed",
  _updatedAt: string,
): Effect.Effect<void, RepositoryStorageError> =>
  withTestRepository(
    root,
    Effect.gen(function* () {
      const repository = yield* RepositorySql;
      yield* repository.operation("complete Validation Run inspection fixture", (sql) =>
        Effect.zipRight(
          recordValidationCompletionEvidence(sql, validationRunId, outcome),
          sql`UPDATE validation_runs SET outcome = ${outcome} WHERE id = ${validationRunId}`,
        ),
      );
    }),
  );

const recordValidationCompletionEvidence = (
  sql: SqlClient.SqlClient,
  validationRunId: number,
  outcome: "passed" | "blocked" | "tooling_failed",
) => {
  if (outcome === "tooling_failed") {
    return sql`
      UPDATE validation_runs SET run_tooling_failure = ${JSON.stringify({
        errorKind: "snapshot_workspace_setup_failed",
        operationName: "set_up_snapshot_workspace",
        errorMessage: "Snapshot Workspace setup failed.",
      })}
      WHERE id = ${validationRunId}
    `;
  }
  return sql`
    INSERT INTO validation_phase_results (
      validation_run_id, phase, producer, outcome, findings, artifacts
    ) VALUES (
      ${validationRunId}, 'checks', 'types', ${outcome === "passed" ? "passed" : "failed"},
      ${JSON.stringify(
        outcome === "passed"
          ? []
          : [
              {
                title: "Check failed: types",
                description: "Type checking failed.",
                evidence: "exitCode: 1",
                files: ["src/main.ts"],
                artifactRefs: [],
              },
            ],
      )},
      '[]'
    )
  `;
};

export const createFindingFixture = (
  root: string,
  input: {
    readonly id: string;
    readonly validationRunId: number;
    readonly createdAt: string;
  },
): Effect.Effect<void, RepositoryStorageError> =>
  withTestRepository(
    root,
    Effect.gen(function* () {
      const repository = yield* RepositorySql;
      yield* repository.operation(
        "create Finding inspection fixture",
        (sql) => sql`
          INSERT INTO validation_phase_results (
            validation_run_id, phase, producer, outcome, findings, artifacts
          ) VALUES (
            ${input.validationRunId}, 'checks', 'types', 'failed',
            ${JSON.stringify([
              {
                title: "Check failed: types",
                description: "Type checking failed.",
                evidence: "exitCode: 1",
                files: ["src/main.ts"],
                artifactRefs: [],
              },
            ])},
            '[]'
          )
        `,
      );
    }),
  );

export const createToolingFailureFixture = (
  root: string,
  validationRunId: number,
  _createdAt: string,
): Effect.Effect<void, RepositoryStorageError> =>
  withTestRepository(
    root,
    Effect.gen(function* () {
      const repository = yield* RepositorySql;
      yield* repository.operation(
        "create Validation Tooling Failure inspection fixture",
        (sql) => sql`
          UPDATE validation_phase_results
          SET tooling_failure = ${JSON.stringify({
            errorKind: "snapshot_workspace_setup_failed",
            operationName: "cleanup_snapshot_workspace",
            errorMessage: "Could not remove worktree.",
          })}
          WHERE validation_run_id = ${validationRunId}
            AND phase = 'checks' AND producer = 'types'
        `,
      );
    }),
  );

export const recordImplementationDecisionFixture = (
  root: string,
  changeId: string,
  input: { readonly choice: string; readonly rationale: string; readonly now: string },
): Effect.Effect<{ readonly id: number }, RepositoryStorageError> =>
  withTestRepository(
    root,
    Effect.gen(function* () {
      const repository = yield* RepositorySql;
      const inserted = yield* repository.operation(
        "create Implementation Decision inspection fixture",
        (sql) => sql<{ readonly id: number }>`
          INSERT INTO implementation_decisions (change_id, choice, rationale)
          VALUES (${internalChangeId(changeId, "BY")}, ${input.choice}, ${input.rationale})
          RETURNING id
        `,
      );
      const id = inserted[0]?.id;
      if (id === undefined) return yield* Effect.dieMessage("Decision identity was not allocated.");
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
): Effect.Effect<{ readonly id: number }, RepositoryStorageError> =>
  withTestRepository(
    root,
    Effect.gen(function* () {
      const repository = yield* RepositorySql;
      const inserted = yield* repository.operation(
        "create Implementation Blocker inspection fixture",
        (sql) => sql<{ readonly id: number }>`
          INSERT INTO implementation_blockers (change_id, content, resolution_content)
          VALUES (
            ${internalChangeId(changeId, "BY")}, 'Wait for an external decision.',
            ${input.resolvedAt === undefined ? null : (input.resolutionContent ?? "Proceed.")}
          )
          RETURNING id
        `,
      );
      const id = inserted[0]?.id;
      if (id === undefined) return yield* Effect.dieMessage("Blocker identity was not allocated.");
      return { id };
    }),
  );

export const resolveImplementationBlockerFixture = (
  root: string,
  blockerId: number,
  _resolvedAt: string,
): Effect.Effect<void, RepositoryStorageError> =>
  withTestRepository(
    root,
    Effect.gen(function* () {
      const repository = yield* RepositorySql;
      yield* repository.operation(
        "resolve Implementation Blocker inspection fixture",
        (sql) => sql`
          UPDATE implementation_blockers
          SET resolution_content = 'Proceed with the accepted implementation.'
          WHERE id = ${blockerId}
        `,
      );
    }),
  );
