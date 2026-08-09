import { randomUUID } from "node:crypto";
import type * as SqlClient from "@effect/sql/SqlClient";
import type { SqlError } from "@effect/sql/SqlError";
import { Effect, Schema } from "effect";

import { nonBlankStringSchema } from "../contracts/agentConfig.js";
import { RepositoryPersistedDataInvalid } from "../contracts/repositoryStorageError.js";
import type { TaskState } from "../task/lifecycle.js";
import { type PublicTaskId, storedPublicTaskId } from "../task/taskId.js";
import {
  decodePersistedTaskReviewProposal,
  type TaskReviewAbandonmentContext,
  type TaskReviewFinding,
  type TaskReviewPolicySnapshot,
  type TaskReviewProposal,
  type TaskReviewProposalDependency,
  type TaskReviewRecord,
  type TaskReviewToolingFailure,
  taskReviewCleanupStateSchema,
  taskReviewOutcomeSchema,
  taskReviewPolicySnapshotSchema,
  taskReviewStateSchema,
} from "../task/taskReview.js";
import type {
  AbandonTaskReviewInput,
  AbandonTaskReviewPersistenceResult,
  ActiveTaskReview,
  CompleteTaskReviewInput,
  CompleteTaskReviewResult,
  StartTaskReviewInput,
  StartTaskReviewResult,
  TaskReviewCompletionFailure,
  TaskReviewPersistence,
  TaskReviewTaskFact,
} from "../task/taskReviewStore.js";
import { RepositorySql } from "./repositorySql.js";
import { decodeSqliteJsonStringArray } from "./sqliteJsonStringArray.js";

export const openSqliteTaskReviewPersistence = (): Effect.Effect<
  TaskReviewPersistence,
  never,
  RepositorySql
> =>
  Effect.map(RepositorySql, (repository) => ({
    startOrReuse: (input) =>
      repository.transactionImmediate("start Task Review", (sql) => startOrReuse(sql, input)),
    getTaskFact: (taskId) =>
      repository.operation("read Task Review Task fact", (sql) => getTaskFact(sql, taskId)),
    complete: (input) =>
      repository.transactionImmediate("complete Task Review", (sql) => complete(sql, input)),
    getActiveForTask: (taskId) =>
      repository.operation("read Active Task Review", (sql) => getActiveForTask(sql, taskId)),
    getActiveByReviewId: (reviewId) =>
      repository.operation("read Active Task Review by Review", (sql) =>
        getActiveByReviewId(sql, reviewId),
      ),
    getAbandonmentContext: (reviewId) =>
      repository
        .operation("read Task Review abandonment context", (sql) =>
          getAbandonmentContext(sql, reviewId),
        )
        .pipe(Effect.flatMap(decodeAbandonmentContextOptional)),
    getReviewById: (reviewId) =>
      repository
        .operation("read Task Review", (sql) => getReviewById(sql, reviewId))
        .pipe(Effect.flatMap(decodeReviewOptional)),
    listReviewsForTask: (taskId) =>
      repository
        .operation("list Task Reviews", (sql) => listReviewsForTask(sql, taskId))
        .pipe(Effect.flatMap((rows) => Effect.forEach(rows, decodeReview))),
    listFindings: (reviewId) =>
      repository
        .operation("list Task Review Findings", (sql) => listFindings(sql, reviewId))
        .pipe(Effect.flatMap((rows) => Effect.forEach(rows, decodeFinding))),
    listToolingFailures: (reviewId) =>
      repository
        .operation("list Task Review Tooling Failures", (sql) => listToolingFailures(sql, reviewId))
        .pipe(Effect.flatMap((rows) => Effect.forEach(rows, decodeToolingFailure))),
    latestCompletedReviewForTask: (taskId) =>
      repository
        .operation("read latest completed Task Review", (sql) =>
          latestCompletedReviewForTask(sql, taskId),
        )
        .pipe(Effect.flatMap(decodeReviewOptional)),
    latestApplicableReviewForTask: (taskId) =>
      repository
        .operation("read latest applicable Task Review", (sql) =>
          latestApplicableReviewForTask(sql, taskId),
        )
        .pipe(Effect.flatMap(decodeReviewOptional)),
    recordWorkspaceSetup: (input) =>
      repository.operation("record Task Review workspace setup", (sql) =>
        Effect.asVoid(sql`
          INSERT INTO task_review_workspace_setups (
            review_id, temp_ref_name, submitted_sha, worktree_head, worktree_path,
            cleanup_worktree, cleanup_temp_ref, created_at
          ) VALUES (
            ${input.reviewId}, ${input.tempRefName}, ${input.submittedSha},
            ${input.worktreeHead}, ${input.worktreePath ?? null},
            ${input.cleanupWorktree ?? "not_created"}, ${input.cleanupTempRef ?? "not_created"},
            ${input.createdAt}
          )
          ON CONFLICT (review_id) DO UPDATE SET
            temp_ref_name = excluded.temp_ref_name,
            submitted_sha = excluded.submitted_sha,
            worktree_head = excluded.worktree_head,
            worktree_path = excluded.worktree_path,
            cleanup_worktree = excluded.cleanup_worktree,
            cleanup_temp_ref = excluded.cleanup_temp_ref,
            created_at = excluded.created_at
        `),
      ),
    recordToolingFailure: (input) =>
      repository.operation("record Task Review Tooling Failure", (sql) =>
        Effect.asVoid(sql`
          INSERT INTO task_review_tooling_failures (
            review_id, error_kind, operation_name, error_message, created_at
          ) VALUES (
            ${input.reviewId}, ${input.errorKind}, ${input.operationName},
            ${input.errorMessage}, ${input.now}
          )
        `),
      ),
    recordCompletionFailure: (input) =>
      repository.operation("record Task Review completion failure", (sql) =>
        Effect.asVoid(sql`
          INSERT INTO task_review_completion_failures (
            review_id, operation_name, error_message, created_at
          ) VALUES (
            ${input.reviewId}, ${input.operationName}, ${input.errorMessage}, ${input.now}
          )
          ON CONFLICT (review_id) DO UPDATE SET
            operation_name = excluded.operation_name,
            error_message = excluded.error_message,
            created_at = excluded.created_at
        `),
      ),
    getCompletionFailure: (reviewId) =>
      repository
        .operation("read Task Review completion failure", (sql) =>
          getCompletionFailure(sql, reviewId),
        )
        .pipe(Effect.flatMap(decodeCompletionFailureOptional)),
    abandon: (input) =>
      repository.transactionImmediate("abandon Task Review", (sql) => abandon(sql, input)),
  }));

const startOrReuse = (
  sql: SqlClient.SqlClient,
  input: StartTaskReviewInput,
): Effect.Effect<StartTaskReviewResult, SqlError | RepositoryPersistedDataInvalid> =>
  Effect.gen(function* () {
    const taskRows = yield* sql<{
      readonly title: string;
      readonly description: string;
      readonly state: TaskState;
    }>`
      SELECT title, description, state FROM tasks WHERE id = ${input.taskId}
    `;
    const task = taskRows[0];
    if (task === undefined) return { ok: false as const, code: "task_not_found" as const };
    if (task.state !== "new") {
      return { ok: false as const, code: "invalid_task_state" as const, state: task.state };
    }
    const linked = yield* sql<{ readonly id: string }>`
      SELECT id FROM changes WHERE task_id = ${input.taskId} LIMIT 1
    `;
    if (linked.length > 0) {
      return { ok: false as const, code: "task_linked_to_change" as const };
    }

    const dependencies = yield* readTaskReviewDependencies(sql, input.taskId);
    const proposal: TaskReviewProposal = {
      title: task.title,
      description: task.description,
      dependencies,
    };
    const proposalKey = JSON.stringify({
      title: proposal.title,
      description: proposal.description,
      dependencyIds: proposal.dependencies.map((dependency) => dependency.taskId),
    });

    const active = yield* sql<{ readonly reviewId: string }>`
      SELECT review_id AS reviewId FROM active_task_reviews WHERE task_id = ${input.taskId}
    `;
    if (active[0] !== undefined) {
      return {
        ok: false as const,
        code: "review_active" as const,
        reviewId: active[0].reviewId,
      };
    }

    const reviewId = input.reviewId ?? randomUUID();
    yield* sql`
      INSERT INTO task_reviews (
        id, task_id, proposal_snapshot, proposal_key, base_commit, policy_snapshot,
        state, created_at, updated_at
      ) VALUES (
        ${reviewId}, ${input.taskId}, ${JSON.stringify(proposal)}, ${proposalKey},
        ${input.baseCommit}, ${JSON.stringify(input.policy)}, 'running',
        ${input.now}, ${input.now}
      )
    `;
    yield* sql`
      INSERT INTO active_task_reviews (task_id, review_id, created_at)
      VALUES (${input.taskId}, ${reviewId}, ${input.now})
    `;
    if (input.workspaceSetup !== undefined) {
      yield* sql`
        INSERT INTO task_review_workspace_setups (
          review_id, temp_ref_name, submitted_sha, worktree_head, worktree_path,
          cleanup_worktree, cleanup_temp_ref, created_at
        ) VALUES (
          ${reviewId}, ${input.workspaceSetup.tempRefName}, ${input.baseCommit}, ${input.baseCommit},
          ${input.workspaceSetup.worktreePath}, 'not_created', 'not_created', ${input.now}
        )
      `;
    }
    return { ok: true as const, reused: false as const, reviewId, proposal };
  });

const getTaskFact = (
  sql: SqlClient.SqlClient,
  taskId: PublicTaskId,
): Effect.Effect<TaskReviewTaskFact | undefined, SqlError> =>
  Effect.map(
    sql<{ readonly state: TaskState }>`SELECT state FROM tasks WHERE id = ${taskId}`,
    (rows) => {
      const row = rows[0];
      return row === undefined ? undefined : { id: taskId, state: row.state };
    },
  );

const complete = (
  sql: SqlClient.SqlClient,
  input: CompleteTaskReviewInput,
): Effect.Effect<CompleteTaskReviewResult, SqlError | RepositoryPersistedDataInvalid> =>
  Effect.gen(function* () {
    const reviewRows = yield* sql<{ readonly taskId: string; readonly state: string }>`
      SELECT task_id AS taskId, state FROM task_reviews WHERE id = ${input.reviewId}
    `;
    const review = reviewRows[0];
    if (review === undefined) return { ok: false as const, code: "review_not_found" as const };
    if (review.state !== "running") {
      return { ok: false as const, code: "review_not_active" as const };
    }
    if (input.outcome === "passed" && (input.findings ?? []).length > 0) {
      // A passing Review cannot retain Findings: approval and blocking findings
      // are mutually exclusive lifecycle outcomes.
      return { ok: false as const, code: "passed_with_findings" as const };
    }
    const taskId = storedPublicTaskId(review.taskId);
    // Completion must apply to the exact Review that owns the Active marker for
    // the same Task, so a stale or corrupted running Review cannot approve.
    const active = yield* sql<{ readonly reviewId: string }>`
      SELECT review_id AS reviewId FROM active_task_reviews
      WHERE review_id = ${input.reviewId} AND task_id = ${taskId}
    `;
    if (active[0] === undefined) {
      return { ok: false as const, code: "review_not_active" as const };
    }

    if (input.outcome === "passed") {
      const transitioned = yield* sql<{ readonly id: string }>`
        UPDATE tasks SET state = 'todo', updated_at = ${input.now}
        WHERE id = ${taskId} AND state = 'new'
        RETURNING id
      `;
      if (transitioned.length !== 1) {
        return { ok: false as const, code: "task_state_changed" as const };
      }
    }

    yield* Effect.forEach(
      input.findings ?? [],
      (finding) => sql`
        INSERT INTO task_review_findings (
          id, review_id, title, description, evidence, files, created_at
        ) VALUES (
          ${finding.id}, ${input.reviewId}, ${finding.title}, ${finding.description},
          ${finding.evidence}, ${JSON.stringify(finding.files)}, ${input.now}
        )
      `,
      { discard: true },
    );

    yield* sql`
      UPDATE task_reviews SET state = 'complete', outcome = ${input.outcome}, updated_at = ${input.now}
      WHERE id = ${input.reviewId} AND state = 'running'
    `;
    yield* sql`DELETE FROM active_task_reviews WHERE review_id = ${input.reviewId}`;
    // Successful completion clears any earlier cleanup or indexing diagnostic so
    // the Review carries no stale recovery state.
    yield* sql`DELETE FROM task_review_completion_failures WHERE review_id = ${input.reviewId}`;

    const updated = yield* getReviewById(sql, input.reviewId);
    if (updated === undefined) {
      return yield* invalidData("complete Task Review", "Task Review disappeared");
    }
    const taskFacts = yield* sql<{ readonly state: TaskState }>`
      SELECT state FROM tasks WHERE id = ${taskId}
    `;
    const taskFact = taskFacts[0];
    if (taskFact === undefined) {
      return yield* invalidData("complete Task Review", "Task disappeared");
    }
    const decoded = yield* decodeReview(updated);
    return {
      ok: true as const,
      review: decoded,
      task: { id: taskId, state: taskFact.state } satisfies TaskReviewTaskFact,
    };
  });

const getActiveForTask = (sql: SqlClient.SqlClient, taskId: PublicTaskId) =>
  Effect.map(
    sql<ActiveTaskReviewRow>`
      SELECT task_id AS taskId, review_id AS reviewId
      FROM active_task_reviews WHERE task_id = ${taskId}
    `,
    (rows) => mapActiveTaskReview(rows[0]),
  );

const getActiveByReviewId = (sql: SqlClient.SqlClient, reviewId: string) =>
  Effect.map(
    sql<ActiveTaskReviewRow>`
      SELECT task_id AS taskId, review_id AS reviewId
      FROM active_task_reviews WHERE review_id = ${reviewId}
    `,
    (rows) => mapActiveTaskReview(rows[0]),
  );

const mapActiveTaskReview = (
  row: ActiveTaskReviewRow | undefined,
): ActiveTaskReview | undefined => {
  if (row === undefined) return undefined;
  return { taskId: storedPublicTaskId(row.taskId), reviewId: row.reviewId };
};

const getAbandonmentContext = (sql: SqlClient.SqlClient, reviewId: string) =>
  Effect.map(
    sql<TaskReviewAbandonmentContextRow>`
      SELECT review.id AS reviewId,
        review.task_id AS taskId,
        review.base_commit AS submittedSha,
        setup.temp_ref_name AS tempRefName,
        setup.worktree_path AS worktreePath,
        setup.cleanup_worktree AS cleanupWorktree,
        setup.cleanup_temp_ref AS cleanupTempRef
      FROM task_reviews AS review
      LEFT JOIN task_review_workspace_setups AS setup ON setup.review_id = review.id
      WHERE review.id = ${reviewId}
    `,
    (rows) => rows[0],
  );

const decodeAbandonmentContextOptional = (
  row: TaskReviewAbandonmentContextRow | undefined,
): Effect.Effect<TaskReviewAbandonmentContext | undefined, RepositoryPersistedDataInvalid> => {
  if (row === undefined) return Effect.succeed(undefined);
  return Effect.try({
    try: (): TaskReviewAbandonmentContext => ({
      reviewId: Schema.decodeUnknownSync(nonBlankStringSchema)(row.reviewId),
      taskId: storedPublicTaskId(row.taskId),
      submittedSha: Schema.decodeUnknownSync(nonBlankStringSchema)(row.submittedSha),
      ...(row.tempRefName === null
        ? {}
        : { tempRefName: Schema.decodeUnknownSync(nonBlankStringSchema)(row.tempRefName) }),
      ...(row.worktreePath === null
        ? {}
        : { worktreePath: Schema.decodeUnknownSync(nonBlankStringSchema)(row.worktreePath) }),
      cleanupWorktree: Schema.decodeUnknownSync(taskReviewCleanupStateSchema)(row.cleanupWorktree),
      cleanupTempRef: Schema.decodeUnknownSync(taskReviewCleanupStateSchema)(row.cleanupTempRef),
    }),
    catch: (cause) =>
      new RepositoryPersistedDataInvalid({
        operationName: "decode Task Review abandonment context",
        cause,
      }),
  });
};

const getReviewById = (sql: SqlClient.SqlClient, reviewId: string) =>
  Effect.map(
    sql<TaskReviewRow>`
      SELECT id, task_id AS taskId, proposal_snapshot AS proposalSnapshot,
        proposal_key AS proposalKey, base_commit AS baseCommit,
        policy_snapshot AS policySnapshot, state, outcome, created_at AS createdAt,
        updated_at AS updatedAt
      FROM task_reviews WHERE id = ${reviewId}
    `,
    (rows) => rows[0],
  );

const listReviewsForTask = (sql: SqlClient.SqlClient, taskId: PublicTaskId) =>
  sql<TaskReviewRow>`
    SELECT id, task_id AS taskId, proposal_snapshot AS proposalSnapshot,
      proposal_key AS proposalKey, base_commit AS baseCommit,
      policy_snapshot AS policySnapshot, state, outcome, created_at AS createdAt,
      updated_at AS updatedAt
    FROM task_reviews
    WHERE task_id = ${taskId}
    ORDER BY created_at ASC, id ASC
  `;

const latestCompletedReviewForTask = (sql: SqlClient.SqlClient, taskId: PublicTaskId) =>
  Effect.map(
    sql<TaskReviewRow>`
      SELECT id, task_id AS taskId, proposal_snapshot AS proposalSnapshot,
        proposal_key AS proposalKey, base_commit AS baseCommit,
        policy_snapshot AS policySnapshot, state, outcome, created_at AS createdAt,
        updated_at AS updatedAt
      FROM task_reviews
      WHERE task_id = ${taskId} AND state = 'complete'
      ORDER BY created_at DESC, id DESC
      LIMIT 1
    `,
    (rows) => rows[0],
  );

const latestApplicableReviewForTask = (sql: SqlClient.SqlClient, taskId: PublicTaskId) =>
  Effect.map(
    sql<TaskReviewRow>`
      SELECT id, task_id AS taskId, proposal_snapshot AS proposalSnapshot,
        proposal_key AS proposalKey, base_commit AS baseCommit,
        policy_snapshot AS policySnapshot, state, outcome, created_at AS createdAt,
        updated_at AS updatedAt
      FROM task_reviews
      WHERE task_id = ${taskId} AND state = 'complete' AND outcome IN ('passed', 'blocked')
      ORDER BY created_at DESC, id DESC
      LIMIT 1
    `,
    (rows) => rows[0],
  );

const listFindings = (sql: SqlClient.SqlClient, reviewId: string) =>
  sql<TaskReviewFindingRow>`
    SELECT id, review_id AS reviewId, title, description, evidence, files,
      created_at AS createdAt
    FROM task_review_findings
    WHERE review_id = ${reviewId}
    ORDER BY id
  `;

const listToolingFailures = (sql: SqlClient.SqlClient, reviewId: string) =>
  sql<TaskReviewToolingFailureRow>`
    SELECT sequence, review_id AS reviewId, error_kind AS errorKind,
      operation_name AS operationName, error_message AS errorMessage,
      created_at AS createdAt
    FROM task_review_tooling_failures
    WHERE review_id = ${reviewId}
    ORDER BY sequence
  `;

const getCompletionFailure = (sql: SqlClient.SqlClient, reviewId: string) =>
  Effect.map(
    sql<TaskReviewCompletionFailureRow>`
      SELECT review_id AS reviewId, operation_name AS operationName,
        error_message AS errorMessage, created_at AS createdAt
      FROM task_review_completion_failures
      WHERE review_id = ${reviewId}
    `,
    (rows) => rows[0],
  );

const abandon = (
  sql: SqlClient.SqlClient,
  input: AbandonTaskReviewInput,
): Effect.Effect<AbandonTaskReviewPersistenceResult, SqlError | RepositoryPersistedDataInvalid> =>
  Effect.gen(function* () {
    const reviewRows = yield* sql<{ readonly state: string }>`
      SELECT state FROM task_reviews WHERE id = ${input.reviewId}
    `;
    const review = reviewRows[0];
    if (review === undefined)
      return {
        ok: false as const,
        status: "not_found" as const,
        reviewId: input.reviewId,
        cleanup: { worktree: "not_created", tempRef: "not_created" },
      };
    if (review.state === "complete") {
      return { ok: true as const, status: "already_complete" as const };
    }
    yield* sql`
      INSERT INTO task_review_tooling_failures (
        review_id, error_kind, operation_name, error_message, created_at
      ) VALUES (
        ${input.reviewId}, ${input.errorKind}, ${input.operationName},
        ${input.errorMessage}, ${input.now}
      )
    `;
    yield* sql`
      UPDATE task_reviews SET state = 'complete', outcome = 'tooling_failed', updated_at = ${input.now}
      WHERE id = ${input.reviewId} AND state = 'running'
    `;
    yield* sql`DELETE FROM active_task_reviews WHERE review_id = ${input.reviewId}`;
    // Successful abandonment clears any earlier cleanup or indexing diagnostic so
    // the Review carries no stale recovery state.
    yield* sql`DELETE FROM task_review_completion_failures WHERE review_id = ${input.reviewId}`;
    return { ok: true as const, status: "abandoned" as const };
  });

const decodeReviewOptional = (row: TaskReviewRow | undefined) =>
  row === undefined ? Effect.succeed(undefined) : decodeReview(row);

const decodeReview = (
  row: TaskReviewRow,
): Effect.Effect<TaskReviewRecord, RepositoryPersistedDataInvalid> =>
  Effect.try({
    try: (): TaskReviewRecord => {
      const proposal = decodeProposal(row.proposalSnapshot);
      if (proposalKeyOf(proposal) !== row.proposalKey) {
        throw new Error("Task Review proposal snapshot does not match its stored proposal key");
      }
      return {
        id: row.id,
        taskId: storedPublicTaskId(row.taskId),
        proposal,
        baseCommit: row.baseCommit,
        policy: decodePolicy(row.policySnapshot),
        state: Schema.decodeUnknownSync(taskReviewStateSchema)(row.state),
        outcome: Schema.decodeUnknownSync(taskReviewOutcomeSchema)(row.outcome),
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      };
    },
    catch: (cause) =>
      new RepositoryPersistedDataInvalid({ operationName: "decode Task Review", cause }),
  });

const proposalKeyOf = (proposal: TaskReviewProposal): string =>
  JSON.stringify({
    title: proposal.title,
    description: proposal.description,
    dependencyIds: proposal.dependencies.map((dependency) => dependency.taskId),
  });

const decodeProposal = (value: string): TaskReviewProposal =>
  decodePersistedTaskReviewProposal(JSON.parse(value));

const decodePolicy = (value: string): TaskReviewPolicySnapshot => {
  const parsed: unknown = JSON.parse(value);
  return Schema.decodeUnknownSync(taskReviewPolicySnapshotSchema, {
    onExcessProperty: "error",
  })(parsed);
};

const decodeFinding = (row: TaskReviewFindingRow) =>
  Effect.try({
    try: (): TaskReviewFinding => {
      const { files, ...finding } = row;
      return {
        id: Schema.decodeUnknownSync(nonBlankStringSchema)(finding.id),
        reviewId: Schema.decodeUnknownSync(nonBlankStringSchema)(finding.reviewId),
        title: Schema.decodeUnknownSync(nonBlankStringSchema)(finding.title),
        description: Schema.decodeUnknownSync(nonBlankStringSchema)(finding.description),
        evidence: Schema.decodeUnknownSync(nonBlankStringSchema)(finding.evidence),
        files: decodeSqliteJsonStringArray(files),
        createdAt: finding.createdAt,
      };
    },
    catch: (cause) =>
      new RepositoryPersistedDataInvalid({
        operationName: "decode Task Review Finding",
        cause,
      }),
  });

const decodeToolingFailure = (row: TaskReviewToolingFailureRow) =>
  Effect.try({
    try: (): TaskReviewToolingFailure => ({
      sequence: Schema.decodeUnknownSync(Schema.Number)(row.sequence),
      reviewId: row.reviewId,
      errorKind: Schema.decodeUnknownSync(nonBlankStringSchema)(row.errorKind),
      operationName: Schema.decodeUnknownSync(nonBlankStringSchema)(row.operationName),
      errorMessage: Schema.decodeUnknownSync(nonBlankStringSchema)(row.errorMessage),
      createdAt: row.createdAt,
    }),
    catch: (cause) =>
      new RepositoryPersistedDataInvalid({
        operationName: "decode Task Review Tooling Failure",
        cause,
      }),
  });

const decodeCompletionFailureOptional = (
  row: TaskReviewCompletionFailureRow | undefined,
): Effect.Effect<TaskReviewCompletionFailure | undefined, RepositoryPersistedDataInvalid> => {
  if (row === undefined) return Effect.succeed(undefined);
  return Effect.try({
    try: (): TaskReviewCompletionFailure => ({
      reviewId: row.reviewId,
      operationName: Schema.decodeUnknownSync(nonBlankStringSchema)(row.operationName),
      errorMessage: Schema.decodeUnknownSync(nonBlankStringSchema)(row.errorMessage),
      createdAt: row.createdAt,
    }),
    catch: (cause) =>
      new RepositoryPersistedDataInvalid({
        operationName: "decode Task Review completion failure",
        cause,
      }),
  });
};

const readTaskReviewDependencies = (
  sql: SqlClient.SqlClient,
  taskId: PublicTaskId,
): Effect.Effect<
  readonly TaskReviewProposalDependency[],
  SqlError | RepositoryPersistedDataInvalid
> =>
  Effect.gen(function* () {
    const rows = yield* sql<{
      readonly taskId: string;
      readonly title: string;
      readonly description: string;
      readonly state: TaskState;
    }>`
      SELECT tasks.id AS taskId, tasks.title, tasks.description, tasks.state
      FROM task_dependencies
      JOIN tasks ON tasks.id = task_dependencies.prerequisite_task_id
      WHERE task_dependencies.dependent_task_id = ${taskId}
      ORDER BY tasks.numeric_id ASC
    `;
    const nested = yield* sql<{
      readonly dependentTaskId: string;
      readonly prerequisiteTaskId: string;
    }>`
      SELECT nested.dependent_task_id AS dependentTaskId,
        nested.prerequisite_task_id AS prerequisiteTaskId
      FROM task_dependencies AS direct
      JOIN task_dependencies AS nested ON nested.dependent_task_id = direct.prerequisite_task_id
      WHERE direct.dependent_task_id = ${taskId}
      ORDER BY nested.prerequisite_task_id
    `;
    const nestedByDependent = new Map<string, readonly string[]>();
    for (const row of nested) {
      const existing = nestedByDependent.get(row.dependentTaskId) ?? [];
      nestedByDependent.set(row.dependentTaskId, [...existing, row.prerequisiteTaskId]);
    }
    return yield* Effect.forEach(rows, (row) =>
      Effect.try({
        try: (): TaskReviewProposalDependency => ({
          taskId: storedPublicTaskId(row.taskId),
          title: row.title,
          description: row.description,
          state: row.state,
          dependencyIds: nestedByDependent.get(row.taskId) ?? [],
        }),
        catch: (cause) =>
          new RepositoryPersistedDataInvalid({
            operationName: "read Task Review dependencies",
            cause,
          }),
      }),
    );
  });

const invalidData = (operationName: string, message: string) =>
  Effect.fail(
    new RepositoryPersistedDataInvalid({
      operationName,
      cause: new Error(message),
    }),
  );

type ActiveTaskReviewRow = {
  readonly taskId: string;
  readonly reviewId: string;
};
type TaskReviewRow = Omit<TaskReviewRecord, "taskId" | "proposal" | "policy"> & {
  readonly taskId: string;
  readonly proposalSnapshot: string;
  readonly proposalKey: string;
  readonly policySnapshot: string;
};
type TaskReviewFindingRow = Omit<TaskReviewFinding, "files"> & {
  readonly files: string;
};
type TaskReviewToolingFailureRow = {
  readonly sequence: number;
  readonly reviewId: string;
  readonly errorKind: string;
  readonly operationName: string;
  readonly errorMessage: string;
  readonly createdAt: string;
};
type TaskReviewCompletionFailureRow = {
  readonly reviewId: string;
  readonly operationName: string;
  readonly errorMessage: string;
  readonly createdAt: string;
};
type TaskReviewAbandonmentContextRow = {
  readonly reviewId: string;
  readonly taskId: string;
  readonly submittedSha: string;
  readonly tempRefName: string | null;
  readonly worktreePath: string | null;
  readonly cleanupWorktree: TaskReviewAbandonmentContext["cleanupWorktree"];
  readonly cleanupTempRef: TaskReviewAbandonmentContext["cleanupTempRef"];
};
