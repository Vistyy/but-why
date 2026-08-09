import { randomUUID } from "node:crypto";
import type * as SqlClient from "@effect/sql/SqlClient";
import type { SqlError } from "@effect/sql/SqlError";
import { Effect, Schema } from "effect";

import { nonBlankStringSchema } from "../contracts/agentConfig.js";
import { RepositoryPersistedDataInvalid } from "../contracts/repositoryStorageError.js";
import { isTaskState } from "../task/lifecycle.js";
import { type PublicTaskId, storedPublicTaskId } from "../task/taskId.js";
import {
  decodePersistedTaskReviewDependencyEvidence,
  decodePersistedTaskReviewProposal,
  type TaskReviewAbandonmentContext,
  type TaskReviewDependencyEvidence,
  type TaskReviewFinding,
  type TaskReviewPolicySnapshot,
  type TaskReviewProposal,
  type TaskReviewRecord,
  type TaskReviewToolingFailure,
  type TaskReviewWorkspaceSetup,
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
import { taskReviewTempRefName } from "../task/taskReviewWorkspace.js";
import { RepositorySql } from "./repositorySql.js";
import { decodeSqliteJsonStringArray } from "./sqliteJsonStringArray.js";
import { type DecodedTaskGraph, readDecodedTaskGraph } from "./sqliteTaskReadModel.js";

export const openSqliteTaskReviewPersistence = (): Effect.Effect<
  TaskReviewPersistence,
  never,
  RepositorySql
> =>
  Effect.map(RepositorySql, (repository) => ({
    start: (input) =>
      repository.transactionImmediate("start Task Review", (sql) => start(sql, input)),
    getTaskFact: (taskId) =>
      repository.transaction("read Task Review Task fact", (sql) => getTaskFact(sql, taskId)),
    complete: (input) =>
      repository.transactionImmediate("complete Task Review", (sql) => complete(sql, input)),
    getActiveForTask: (taskId) =>
      repository.operation("read Active Task Review", (sql) => getActiveForTask(sql, taskId)),
    getActiveByReviewId: (reviewId) =>
      repository.operation("read Active Task Review by Review", (sql) =>
        getActiveByReviewId(sql, reviewId),
      ),
    getAbandonmentContext: (reviewId) =>
      repository.transaction("read Task Review abandonment context", (sql) =>
        Effect.gen(function* () {
          const context = yield* getAbandonmentContext(sql, reviewId).pipe(
            Effect.flatMap(decodeAbandonmentContextOptional),
          );
          if (context !== undefined && context.reviewState === "complete") {
            yield* validateStoredTaskReviewEvidence(sql, context.taskId);
          }
          return context;
        }),
      ),
    latestCompletedReviewForTask: (taskId) =>
      repository.transaction("read latest completed Task Review", (sql) =>
        Effect.gen(function* () {
          yield* validateStoredTaskReviewEvidence(sql, taskId);
          return yield* latestCompletedReviewForTask(sql, taskId).pipe(
            Effect.flatMap(decodeReviewOptional),
          );
        }),
      ),
    listFindings: (reviewId) =>
      repository
        .operation("list Task Review Findings", (sql) => listFindings(sql, reviewId))
        .pipe(Effect.flatMap((rows) => Effect.forEach(rows, decodeFinding))),
    listToolingFailures: (reviewId) =>
      repository
        .operation("list Task Review Tooling Failures", (sql) => listToolingFailures(sql, reviewId))
        .pipe(Effect.flatMap((rows) => Effect.forEach(rows, decodeToolingFailure))),
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

const start = (
  sql: SqlClient.SqlClient,
  input: StartTaskReviewInput,
): Effect.Effect<StartTaskReviewResult, SqlError | RepositoryPersistedDataInvalid> =>
  Effect.gen(function* () {
    const taskGraph = yield* readDecodedTaskGraph(sql, "start Task Review");
    const task = taskGraph.tasksById.get(input.taskId);
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

    const dependencyEvidence = readTaskReviewDependencies(taskGraph, input.taskId);
    const proposal: TaskReviewProposal = {
      title: task.title,
      description: task.description,
      dependencyIds: dependencyEvidence.map((dependency) => dependency.taskId),
    };
    const proposalKey = proposalKeyOf(proposal);

    yield* validateStoredTaskReviewEvidence(sql, input.taskId);

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
        id, task_id, proposal_snapshot, proposal_key, dependency_evidence,
        base_commit, policy_snapshot, state, created_at, updated_at
      ) VALUES (
        ${reviewId}, ${input.taskId}, ${JSON.stringify(proposal)}, ${proposalKey},
        ${JSON.stringify(dependencyEvidence)}, ${input.baseCommit},
        ${JSON.stringify(input.policy)}, 'running',
        ${input.now}, ${input.now}
      )
    `;
    yield* sql`
      INSERT INTO active_task_reviews (task_id, review_id, created_at)
      VALUES (${input.taskId}, ${reviewId}, ${input.now})
    `;
    yield* sql`
      INSERT INTO task_review_workspace_setups (
        review_id, temp_ref_name, submitted_sha, worktree_head, worktree_path,
        cleanup_worktree, cleanup_temp_ref, created_at
      ) VALUES (
        ${reviewId}, ${input.workspaceSetup?.tempRefName ?? taskReviewTempRefName(reviewId)},
        ${input.baseCommit}, ${input.baseCommit}, ${input.workspaceSetup?.worktreePath ?? null},
        'not_created', 'not_created', ${input.now}
      )
    `;
    return { ok: true as const, reviewId, proposal, dependencyEvidence };
  });

const getTaskFact = (
  sql: SqlClient.SqlClient,
  taskId: PublicTaskId,
): Effect.Effect<TaskReviewTaskFact | undefined, SqlError | RepositoryPersistedDataInvalid> =>
  Effect.map(readDecodedTaskGraph(sql, "read Task Review Task fact"), (graph) => {
    const task = graph.tasksById.get(taskId);
    return task === undefined ? undefined : { id: task.id, state: task.state };
  });

const complete = (
  sql: SqlClient.SqlClient,
  input: CompleteTaskReviewInput,
): Effect.Effect<CompleteTaskReviewResult, SqlError | RepositoryPersistedDataInvalid> =>
  Effect.gen(function* () {
    const reviewRows = yield* sql<{
      readonly taskId: string;
      readonly state: string;
      readonly baseCommit: string;
    }>`
      SELECT task_id AS taskId, state, base_commit AS baseCommit
      FROM task_reviews WHERE id = ${input.reviewId}
    `;
    const review = reviewRows[0];
    if (review === undefined) return { ok: false as const, code: "review_not_found" as const };
    if (review.state !== "running") {
      return { ok: false as const, code: "review_not_active" as const };
    }
    const findings = "findings" in input && Array.isArray(input.findings) ? input.findings : [];
    const toolingFailure = "toolingFailure" in input ? input.toolingFailure : undefined;
    const evidenceIsValid =
      (input.outcome === "passed" && findings.length === 0 && toolingFailure === undefined) ||
      (input.outcome === "blocked" && findings.length > 0 && toolingFailure === undefined) ||
      (input.outcome === "tooling_failed" && findings.length === 0 && toolingFailure !== undefined);
    if (!evidenceIsValid) {
      return { ok: false as const, code: "invalid_outcome_evidence" as const };
    }
    const existingFindings = yield* sql<{ readonly id: string }>`
      SELECT id FROM task_review_findings WHERE review_id = ${input.reviewId} LIMIT 1
    `;
    const existingToolingFailures = yield* sql<{ readonly sequence: number }>`
      SELECT sequence FROM task_review_tooling_failures WHERE review_id = ${input.reviewId} LIMIT 1
    `;
    if (existingFindings.length > 0 || existingToolingFailures.length > 0) {
      return yield* invalidData(
        "complete Task Review",
        `Running Task Review ${input.reviewId} already has terminal outcome evidence`,
      );
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

    const taskGraph = yield* readDecodedTaskGraph(sql, "complete Task Review");
    if (taskGraph.tasksById.get(taskId)?.state !== "new") {
      return { ok: false as const, code: "task_state_changed" as const };
    }
    const workspaceRows = yield* sql<TaskReviewWorkspaceSetupRow>`
      SELECT review_id AS reviewId, temp_ref_name AS tempRefName,
        submitted_sha AS submittedSha, worktree_head AS worktreeHead,
        worktree_path AS worktreePath, cleanup_worktree AS cleanupWorktree,
        cleanup_temp_ref AS cleanupTempRef, created_at AS createdAt
      FROM task_review_workspace_setups WHERE review_id = ${input.reviewId}
    `;
    const workspace =
      workspaceRows[0] === undefined ? undefined : yield* decodeWorkspaceSetup(workspaceRows[0]);
    if (
      workspace === undefined ||
      workspace.tempRefName !== taskReviewTempRefName(input.reviewId) ||
      workspace.submittedSha !== review.baseCommit ||
      workspace.worktreeHead !== review.baseCommit ||
      (input.outcome === "tooling_failed"
        ? workspace.cleanupWorktree === "failed" || workspace.cleanupTempRef === "failed"
        : workspace.cleanupWorktree !== "removed" || workspace.cleanupTempRef !== "removed")
    ) {
      return yield* invalidData(
        "complete Task Review",
        `Task Review ${input.reviewId} does not have successful owned workspace cleanup evidence`,
      );
    }

    if (toolingFailure !== undefined) {
      yield* sql`
        INSERT INTO task_review_tooling_failures (
          review_id, error_kind, operation_name, error_message, created_at
        ) VALUES (
          ${input.reviewId}, ${toolingFailure.errorKind},
          ${toolingFailure.operationName}, ${toolingFailure.errorMessage}, ${input.now}
        )
      `;
    }

    yield* Effect.forEach(
      findings,
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

    const completedReview = yield* sql<{ readonly id: string }>`
      UPDATE task_reviews SET state = 'complete', outcome = ${input.outcome}, updated_at = ${input.now}
      WHERE id = ${input.reviewId} AND state = 'running'
      RETURNING id
    `;
    const removedActive = yield* sql<{ readonly reviewId: string }>`
      DELETE FROM active_task_reviews
      WHERE review_id = ${input.reviewId} AND task_id = ${taskId}
      RETURNING review_id AS reviewId
    `;
    if (completedReview.length !== 1 || removedActive.length !== 1) {
      return yield* invalidData(
        "complete Task Review",
        "Task Review compare-and-set completion did not update its exact active proposal",
      );
    }
    // Successful completion clears any earlier cleanup or indexing diagnostic so
    // the Review carries no stale recovery state.
    yield* sql`DELETE FROM task_review_completion_failures WHERE review_id = ${input.reviewId}`;

    const updated = yield* readReviewForCompletion(sql, input.reviewId);
    if (updated === undefined) {
      return yield* invalidData("complete Task Review", "Task Review disappeared");
    }
    const taskFact = taskGraph.tasksById.get(taskId);
    if (taskFact === undefined) {
      return yield* invalidData("complete Task Review", "Task disappeared");
    }
    const decoded = yield* decodeReview(updated);
    return {
      ok: true as const,
      review: decoded,
      task: { id: taskFact.id, state: taskFact.state } satisfies TaskReviewTaskFact,
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

const decodeActiveTaskReview = (
  row: ActiveTaskReviewRow,
): Effect.Effect<ActiveTaskReview, RepositoryPersistedDataInvalid> =>
  Effect.try({
    try: () => ({
      taskId: storedPublicTaskId(row.taskId),
      reviewId: Schema.decodeUnknownSync(nonBlankStringSchema)(row.reviewId),
    }),
    catch: (cause) =>
      new RepositoryPersistedDataInvalid({
        operationName: "decode Active Task Review",
        cause,
      }),
  });

const decodeWorkspaceSetup = (
  row: TaskReviewWorkspaceSetupRow,
): Effect.Effect<TaskReviewWorkspaceSetup, RepositoryPersistedDataInvalid> =>
  Effect.try({
    try: () => ({
      reviewId: Schema.decodeUnknownSync(nonBlankStringSchema)(row.reviewId),
      tempRefName: Schema.decodeUnknownSync(nonBlankStringSchema)(row.tempRefName),
      submittedSha: Schema.decodeUnknownSync(nonBlankStringSchema)(row.submittedSha),
      worktreeHead: Schema.decodeUnknownSync(nonBlankStringSchema)(row.worktreeHead),
      ...(row.worktreePath === null
        ? {}
        : { worktreePath: Schema.decodeUnknownSync(nonBlankStringSchema)(row.worktreePath) }),
      cleanupWorktree: Schema.decodeUnknownSync(taskReviewCleanupStateSchema)(row.cleanupWorktree),
      cleanupTempRef: Schema.decodeUnknownSync(taskReviewCleanupStateSchema)(row.cleanupTempRef),
      createdAt: Schema.decodeUnknownSync(nonBlankStringSchema)(row.createdAt),
    }),
    catch: (cause) =>
      new RepositoryPersistedDataInvalid({
        operationName: "decode Task Review workspace setup",
        cause,
      }),
  });

const getAbandonmentContext = (sql: SqlClient.SqlClient, reviewId: string) =>
  Effect.map(
    sql<TaskReviewAbandonmentContextRow>`
      SELECT review.id AS reviewId,
        review.task_id AS taskId,
        review.state AS reviewState,
        review.outcome,
        task.state AS taskState,
        review.base_commit AS submittedSha,
        setup.temp_ref_name AS tempRefName,
        setup.worktree_path AS worktreePath,
        setup.cleanup_worktree AS cleanupWorktree,
        setup.cleanup_temp_ref AS cleanupTempRef,
        active.task_id AS activeTaskId,
        active.review_id AS activeReviewId
      FROM task_reviews AS review
      JOIN tasks AS task ON task.id = review.task_id
      LEFT JOIN task_review_workspace_setups AS setup ON setup.review_id = review.id
      LEFT JOIN active_task_reviews AS active ON active.review_id = review.id
      WHERE review.id = ${reviewId}
    `,
    (rows) => rows[0],
  );

const decodeAbandonmentContextOptional = (
  row: TaskReviewAbandonmentContextRow | undefined,
): Effect.Effect<TaskReviewAbandonmentContext | undefined, RepositoryPersistedDataInvalid> => {
  if (row === undefined) return Effect.succeed(undefined);
  return Effect.try({
    try: (): TaskReviewAbandonmentContext => {
      const reviewId = Schema.decodeUnknownSync(nonBlankStringSchema)(row.reviewId);
      const taskId = storedPublicTaskId(row.taskId);
      const reviewState = Schema.decodeUnknownSync(taskReviewStateSchema)(row.reviewState);
      const outcome = Schema.decodeUnknownSync(taskReviewOutcomeSchema)(row.outcome);
      if (!isTaskState(row.taskState)) throw new Error("Task Review Task has an invalid state");
      if (row.tempRefName !== taskReviewTempRefName(reviewId)) {
        throw new Error("Task Review temporary ref does not identify its owned workspace");
      }
      const hasExactActiveMarker = row.activeTaskId === taskId && row.activeReviewId === reviewId;
      if (
        (reviewState === "running" && (!hasExactActiveMarker || outcome !== null)) ||
        (reviewState === "complete" &&
          (row.activeTaskId !== null || row.activeReviewId !== null || outcome === null))
      ) {
        throw new Error("Task Review state, outcome, and Active Review marker do not agree");
      }
      const context = {
        reviewId,
        taskId,
        submittedSha: Schema.decodeUnknownSync(nonBlankStringSchema)(row.submittedSha),
        ...(row.tempRefName === null
          ? {}
          : { tempRefName: Schema.decodeUnknownSync(nonBlankStringSchema)(row.tempRefName) }),
        ...(row.worktreePath === null
          ? {}
          : { worktreePath: Schema.decodeUnknownSync(nonBlankStringSchema)(row.worktreePath) }),
        cleanupWorktree: Schema.decodeUnknownSync(taskReviewCleanupStateSchema)(
          row.cleanupWorktree,
        ),
        cleanupTempRef: Schema.decodeUnknownSync(taskReviewCleanupStateSchema)(row.cleanupTempRef),
      };
      if (reviewState === "running") {
        if (row.taskState !== "new") throw new Error("Running Task Review Task is not New");
        return { ...context, reviewState, outcome: null, taskState: row.taskState };
      }
      if (outcome === null) throw new Error("Complete Task Review has no outcome");
      return { ...context, reviewState, outcome, taskState: row.taskState };
    },
    catch: (cause) =>
      new RepositoryPersistedDataInvalid({
        operationName: "decode Task Review abandonment context",
        cause,
      }),
  });
};

const validateStoredTaskReviewEvidence = (
  sql: SqlClient.SqlClient,
  taskId: PublicTaskId,
): Effect.Effect<void, SqlError | RepositoryPersistedDataInvalid> =>
  Effect.gen(function* () {
    const rows = yield* sql<TaskReviewRow>`
      SELECT id, task_id AS taskId, proposal_snapshot AS proposalSnapshot,
        proposal_key AS proposalKey, dependency_evidence AS dependencyEvidence,
        base_commit AS baseCommit, policy_snapshot AS policySnapshot, state, outcome,
        created_at AS createdAt, updated_at AS updatedAt
      FROM task_reviews
      WHERE task_id = ${taskId}
      ORDER BY created_at, id
    `;
    const activeRows = yield* sql<ActiveTaskReviewRow>`
      SELECT task_id AS taskId, review_id AS reviewId
      FROM active_task_reviews
      WHERE task_id = ${taskId}
        OR review_id IN (SELECT id FROM task_reviews WHERE task_id = ${taskId})
    `;
    const workspaceRows = yield* sql<TaskReviewWorkspaceSetupRow>`
      SELECT review_id AS reviewId, temp_ref_name AS tempRefName,
        submitted_sha AS submittedSha, worktree_head AS worktreeHead,
        worktree_path AS worktreePath, cleanup_worktree AS cleanupWorktree,
        cleanup_temp_ref AS cleanupTempRef, created_at AS createdAt
      FROM task_review_workspace_setups
      WHERE review_id IN (SELECT id FROM task_reviews WHERE task_id = ${taskId})
    `;
    const activeReviews = yield* Effect.forEach(activeRows, decodeActiveTaskReview);
    const workspaces = yield* Effect.forEach(workspaceRows, decodeWorkspaceSetup);
    const reviewIds = new Set(rows.map((row) => row.id));
    if (
      activeReviews.some((active) => active.taskId !== taskId || !reviewIds.has(active.reviewId))
    ) {
      return yield* invalidData(
        "validate stored Task Review evidence",
        `Task ${taskId} has an Active Review marker that does not match its Review history`,
      );
    }
    yield* Effect.forEach(
      rows,
      (row) =>
        Effect.gen(function* () {
          const review = yield* decodeReview(row);
          const matchingActiveReviews = activeReviews.filter(
            (active) => active.reviewId === review.id,
          );
          const workspace = workspaces.find((setup) => setup.reviewId === review.id);
          if (
            workspace === undefined ||
            workspace.tempRefName !== taskReviewTempRefName(review.id) ||
            workspace.submittedSha !== review.baseCommit ||
            workspace.worktreeHead !== review.baseCommit ||
            (review.state === "complete" &&
              (review.outcome === "tooling_failed"
                ? workspace.cleanupWorktree === "failed" || workspace.cleanupTempRef === "failed"
                : workspace.cleanupWorktree !== "removed" ||
                  workspace.cleanupTempRef !== "removed"))
          ) {
            return yield* invalidData(
              "validate stored Task Review evidence",
              `Task Review ${review.id} workspace does not match its Review Base`,
            );
          }
          if (
            (review.state === "running" &&
              (matchingActiveReviews.length !== 1 || review.outcome !== null)) ||
            (review.state === "complete" &&
              (matchingActiveReviews.length !== 0 || review.outcome === null))
          ) {
            return yield* invalidData(
              "validate stored Task Review evidence",
              `Task Review ${review.id} state does not match its Active Review marker`,
            );
          }
          const findings = yield* listFindings(sql, review.id).pipe(
            Effect.flatMap((findingRows) => Effect.forEach(findingRows, decodeFinding)),
          );
          const toolingFailures = yield* listToolingFailures(sql, review.id).pipe(
            Effect.flatMap((toolingRows) => Effect.forEach(toolingRows, decodeToolingFailure)),
          );
          const completionFailure = yield* getCompletionFailure(sql, review.id).pipe(
            Effect.flatMap(decodeCompletionFailureOptional),
          );
          if (review.state !== "complete") return;
          const validOutcomeEvidence =
            completionFailure === undefined &&
            ((review.outcome === "passed" &&
              findings.length === 0 &&
              toolingFailures.length === 0) ||
              (review.outcome === "blocked" &&
                findings.length > 0 &&
                toolingFailures.length === 0) ||
              (review.outcome === "tooling_failed" &&
                findings.length === 0 &&
                toolingFailures.length === 1));
          if (!validOutcomeEvidence) {
            return yield* invalidData(
              "validate stored Task Review evidence",
              `Task Review ${review.id} has evidence that does not match its outcome`,
            );
          }
        }),
      { discard: true },
    );
  });

const readReviewForCompletion = (sql: SqlClient.SqlClient, reviewId: string) =>
  Effect.map(
    sql<TaskReviewRow>`
      SELECT id, task_id AS taskId, proposal_snapshot AS proposalSnapshot,
        proposal_key AS proposalKey, dependency_evidence AS dependencyEvidence,
        base_commit AS baseCommit, policy_snapshot AS policySnapshot, state, outcome,
        created_at AS createdAt, updated_at AS updatedAt
      FROM task_reviews WHERE id = ${reviewId}
    `,
    (rows) => rows[0],
  );

const latestCompletedReviewForTask = (sql: SqlClient.SqlClient, taskId: PublicTaskId) =>
  Effect.map(
    sql<TaskReviewRow>`
      SELECT id, task_id AS taskId, proposal_snapshot AS proposalSnapshot,
        proposal_key AS proposalKey, dependency_evidence AS dependencyEvidence,
        base_commit AS baseCommit, policy_snapshot AS policySnapshot, state, outcome,
        created_at AS createdAt, updated_at AS updatedAt
      FROM task_reviews
      WHERE task_id = ${taskId} AND state = 'complete'
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
    const reviewRows = yield* sql<{
      readonly state: string;
      readonly taskId: string;
    }>`
      SELECT state, task_id AS taskId FROM task_reviews WHERE id = ${input.reviewId}
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
    const taskId = storedPublicTaskId(review.taskId);
    const taskGraph = yield* readDecodedTaskGraph(sql, "abandon Task Review");
    if (taskGraph.tasksById.get(taskId)?.state !== "new") {
      return yield* invalidData(
        "abandon Task Review",
        `Running Task Review ${input.reviewId} does not belong to a New Task`,
      );
    }
    const active = yield* sql<{ readonly reviewId: string }>`
      SELECT review_id AS reviewId FROM active_task_reviews
      WHERE review_id = ${input.reviewId} AND task_id = ${taskId}
    `;
    if (active.length !== 1) {
      return yield* invalidData(
        "abandon Task Review",
        `Running Task Review ${input.reviewId} does not own its exact Active marker`,
      );
    }
    const updatedWorkspace = yield* sql<{ readonly reviewId: string }>`
      UPDATE task_review_workspace_setups
      SET cleanup_worktree = ${input.cleanupWorktree},
        cleanup_temp_ref = ${input.cleanupTempRef}
      WHERE review_id = ${input.reviewId}
      RETURNING review_id AS reviewId
    `;
    if (updatedWorkspace.length !== 1) {
      return yield* invalidData(
        "abandon Task Review",
        `Running Task Review ${input.reviewId} has no workspace evidence`,
      );
    }
    yield* sql`
      INSERT INTO task_review_tooling_failures (
        review_id, error_kind, operation_name, error_message, created_at
      ) VALUES (
        ${input.reviewId}, ${input.errorKind}, ${input.operationName},
        ${input.errorMessage}, ${input.now}
      )
    `;
    const completedReview = yield* sql<{ readonly id: string }>`
      UPDATE task_reviews SET state = 'complete', outcome = 'tooling_failed', updated_at = ${input.now}
      WHERE id = ${input.reviewId} AND state = 'running'
      RETURNING id
    `;
    const removedActive = yield* sql<{ readonly reviewId: string }>`
      DELETE FROM active_task_reviews WHERE review_id = ${input.reviewId}
      RETURNING review_id AS reviewId
    `;
    if (completedReview.length !== 1 || removedActive.length !== 1) {
      return yield* invalidData(
        "abandon Task Review",
        "Task Review abandonment did not complete its exact Active Review",
      );
    }
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
      const dependencyEvidence = decodeDependencyEvidence(row.dependencyEvidence);
      if (
        dependencyEvidence.length !== proposal.dependencyIds.length ||
        dependencyEvidence.some(
          (dependency, index) => dependency.taskId !== proposal.dependencyIds[index],
        )
      ) {
        throw new Error(
          "Task Review dependency evidence does not match its admitted dependency IDs",
        );
      }
      return {
        id: Schema.decodeUnknownSync(nonBlankStringSchema)(row.id),
        taskId: storedPublicTaskId(row.taskId),
        proposal,
        dependencyEvidence,
        baseCommit: Schema.decodeUnknownSync(nonBlankStringSchema)(row.baseCommit),
        policy: decodePolicy(row.policySnapshot),
        state: Schema.decodeUnknownSync(taskReviewStateSchema)(row.state),
        outcome: Schema.decodeUnknownSync(taskReviewOutcomeSchema)(row.outcome),
        createdAt: Schema.decodeUnknownSync(nonBlankStringSchema)(row.createdAt),
        updatedAt: Schema.decodeUnknownSync(nonBlankStringSchema)(row.updatedAt),
      };
    },
    catch: (cause) =>
      new RepositoryPersistedDataInvalid({ operationName: "decode Task Review", cause }),
  });

const proposalKeyOf = (proposal: TaskReviewProposal): string =>
  JSON.stringify({
    title: proposal.title,
    description: proposal.description,
    dependencyIds: proposal.dependencyIds,
  });

const decodeProposal = (value: string): TaskReviewProposal =>
  decodePersistedTaskReviewProposal(JSON.parse(value));

const decodeDependencyEvidence = (value: string): readonly TaskReviewDependencyEvidence[] =>
  decodePersistedTaskReviewDependencyEvidence(JSON.parse(value));

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
        createdAt: Schema.decodeUnknownSync(nonBlankStringSchema)(finding.createdAt),
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
      reviewId: Schema.decodeUnknownSync(nonBlankStringSchema)(row.reviewId),
      errorKind: Schema.decodeUnknownSync(nonBlankStringSchema)(row.errorKind),
      operationName: Schema.decodeUnknownSync(nonBlankStringSchema)(row.operationName),
      errorMessage: Schema.decodeUnknownSync(nonBlankStringSchema)(row.errorMessage),
      createdAt: Schema.decodeUnknownSync(nonBlankStringSchema)(row.createdAt),
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
      reviewId: Schema.decodeUnknownSync(nonBlankStringSchema)(row.reviewId),
      operationName: Schema.decodeUnknownSync(nonBlankStringSchema)(row.operationName),
      errorMessage: Schema.decodeUnknownSync(nonBlankStringSchema)(row.errorMessage),
      createdAt: Schema.decodeUnknownSync(nonBlankStringSchema)(row.createdAt),
    }),
    catch: (cause) =>
      new RepositoryPersistedDataInvalid({
        operationName: "decode Task Review completion failure",
        cause,
      }),
  });
};

const readTaskReviewDependencies = (
  graph: DecodedTaskGraph,
  taskId: PublicTaskId,
): readonly TaskReviewDependencyEvidence[] =>
  graph.dependencies
    .filter((dependency) => dependency.dependentTask.id === taskId)
    .map((dependency) => dependency.prerequisiteTask)
    .sort((left, right) => left.numericId - right.numericId)
    .map((dependency) => ({
      taskId: dependency.id,
      title: dependency.title,
      description: dependency.description,
      state: dependency.state,
      dependencyIds: graph.dependencies
        .filter((nested) => nested.dependentTask.id === dependency.id)
        .map((nested) => nested.prerequisiteTask)
        .sort((left, right) => left.numericId - right.numericId)
        .map((nested) => nested.id),
    }));

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
type TaskReviewRow = Omit<
  TaskReviewRecord,
  "taskId" | "proposal" | "dependencyEvidence" | "policy"
> & {
  readonly taskId: string;
  readonly proposalSnapshot: string;
  readonly proposalKey: string;
  readonly dependencyEvidence: string;
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
type TaskReviewWorkspaceSetupRow = {
  readonly reviewId: string;
  readonly tempRefName: string;
  readonly submittedSha: string;
  readonly worktreeHead: string;
  readonly worktreePath: string | null;
  readonly cleanupWorktree: string;
  readonly cleanupTempRef: string;
  readonly createdAt: string;
};
type TaskReviewAbandonmentContextRow = {
  readonly reviewId: string;
  readonly taskId: string;
  readonly reviewState: string;
  readonly outcome: string | null;
  readonly taskState: string;
  readonly submittedSha: string;
  readonly tempRefName: string | null;
  readonly worktreePath: string | null;
  readonly cleanupWorktree: TaskReviewAbandonmentContext["cleanupWorktree"];
  readonly cleanupTempRef: TaskReviewAbandonmentContext["cleanupTempRef"];
  readonly activeTaskId: string | null;
  readonly activeReviewId: string | null;
};
