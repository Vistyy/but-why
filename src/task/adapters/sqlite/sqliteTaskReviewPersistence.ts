import type * as SqlClient from "@effect/sql/SqlClient";
import type { SqlError } from "@effect/sql/SqlError";
import { Effect } from "effect";
import {
  decodeSqliteAgentInvocation,
  type SqliteAgentInvocationRow,
} from "../../../agent/agentSession/adapters/sqlite/sqliteAgentInvocation.js";
import { settleUnsettledAgentInvocations } from "../../../agent/agentSession/adapters/sqlite/sqliteAgentSessionPersistence.js";
import type {
  AgentInvocationRecord,
  AgentSessionSqlLink,
} from "../../../agent/agentSession/agentSession.js";
import { RepositoryPersistedDataInvalid } from "../../../contracts/repositoryStorageError.js";
import { decodeReviewerFindingCore } from "../../../contracts/reviewerFinding.js";
import { RepositorySql } from "../../../repositoryRuntime/adapters/sqlite/repositorySql.js";
import { decodePersisted } from "../../../repositoryRuntime/adapters/sqlite/sqlitePersistedData.js";
import type { TaskState } from "../../lifecycle.js";
import {
  decodeTaskReviewPolicySnapshot,
  decodeTaskReviewToolingFailure,
  type TaskReviewDependencyEvidence,
  type TaskReviewFinding,
  type TaskReviewPolicySnapshot,
  type TaskReviewProposal,
  type TaskReviewRecord,
  type TaskReviewToolingFailure,
} from "../../review/taskReview.js";
import type {
  AdmitTaskReviewInput,
  AdmitTaskReviewResult,
  CompleteTaskReviewSuccess,
  SettleSimplificationAdviceInput,
  TaskReviewAdmissionRejection,
  TaskReviewPersistence,
} from "../../review/taskReviewPersistence.js";
import { expectedTaskReviewWorkspacePath } from "../../review/taskReviewWorkspace.js";
import {
  decodeTaskSimplificationAdvice,
  decodeTaskSimplificationAdvicePolicy,
  type TaskSimplificationAdviceAttempt,
} from "../../review/taskSimplificationAdvice.js";
import { internalTaskId, publicTaskIdFromInternal } from "../../taskId.js";

const reviewColumns = `
  id, task_id AS taskId, proposal AS proposalSnapshot,
  dependency_evidence AS dependencyEvidence, base_ref AS baseRef,
  base_commit AS baseCommit, outcome, findings, tooling_failure AS toolingFailure,
  cleanup_pending AS cleanupPending, cleanup_blocking_reason AS cleanupBlockingReason
`;

type ReviewRow = {
  readonly id: number;
  readonly taskId: number;
  readonly proposalSnapshot: string;
  readonly dependencyEvidence: string;
  readonly baseRef: string;
  readonly baseCommit: string;
  readonly outcome: string | null;
  readonly findings: string;
  readonly toolingFailure: string | null;
  readonly cleanupPending: number;
  readonly cleanupBlockingReason: string | null;
};

type TaskReviewInvocationEvidenceRow = SqliteAgentInvocationRow & {
  readonly taskOwned: number;
};

export const openSqliteTaskReviewPersistence = (): Effect.Effect<
  TaskReviewPersistence,
  never,
  RepositorySql
> =>
  Effect.map(RepositorySql, (repository) => ({
    getCompletedSimplificationAdvice: (taskId) =>
      repository.transaction("read Task Simplification Advice", (sql) =>
        readCompletedSimplificationAdvice(sql, taskId, repository.idPrefix),
      ),
    recordSimplificationAdviceFailure: (reviewId, failure) =>
      repository.transactionImmediate("record unavailable Task Simplification Advice", (sql) =>
        recordSimplificationAdviceFailure(sql, reviewId, failure),
      ),
    linkSimplificationAdviceInvocation:
      (input): AgentSessionSqlLink =>
      (sql, invocationId) =>
        linkSimplificationAdviceInvocation(sql, input.reviewId, invocationId),
    settleSimplificationAdvice:
      (input): AgentSessionSqlLink =>
      (sql, invocationId) =>
        settleSimplificationAdvice(sql, { ...input, invocationId }),
    reuseJudgment: (taskId, now) =>
      repository.transactionImmediate("reuse Task Review judgment", (sql) =>
        reuseTaskReviewJudgment(sql, taskId, now, repository.idPrefix, repository.commonDirectory),
      ),
    checkAdmission: (taskId) =>
      repository.transaction("check Task Review admission", (sql) =>
        taskReviewAdmissionRejection(sql, taskId, repository.idPrefix),
      ),
    admit: (input) =>
      repository.transactionImmediate("admit Task Review", (sql) =>
        admitTaskReview(sql, input, repository.idPrefix, repository.commonDirectory),
      ),
    recordCleanup: (reviewId, cleanup, _now, cleanupBlockingReason) =>
      repository.transactionImmediate("record Task Review cleanup", (sql) =>
        sql`
          UPDATE task_reviews
          SET cleanup_pending = ${cleanup === "removed" ? 0 : 1},
            cleanup_blocking_reason = ${cleanup === "failed" ? (cleanupBlockingReason ?? "Snapshot Workspace cleanup failed.") : null}
          WHERE id = ${reviewId}
        `.pipe(Effect.asVoid),
      ),
    complete: (input) =>
      repository.transactionImmediate("complete Task Review", (sql) =>
        completeReview(
          sql,
          input.reviewId,
          input.findings,
          input.toolingFailure,
          repository.idPrefix,
          repository.commonDirectory,
          "tooling_failure",
        ),
      ),
    abandon: (reviewId, reason, now) =>
      repository.transactionImmediate("abandon Task Review", (sql) =>
        Effect.gen(function* () {
          const linked = yield* sql<{ readonly invocationId: number }>`
            SELECT agent_invocation_id AS invocationId
            FROM task_review_agent_invocations
            WHERE task_review_id = ${reviewId}
          `;
          const advice = yield* sql<{ readonly invocationId: number }>`
            SELECT agent_invocation_id AS invocationId
            FROM task_review_simplification_advice
            WHERE task_review_id = ${reviewId} AND agent_invocation_id IS NOT NULL
          `;
          yield* settleUnsettledAgentInvocations(
            sql,
            [...linked, ...advice].map(({ invocationId }) => invocationId),
            now,
            `Task Review abandonment confirmed that the reviewer process stopped. ${reason}`,
          );
          yield* sql`
            UPDATE task_review_simplification_advice
            SET outcome = 'unavailable', advice = NULL,
              unavailable = ${JSON.stringify({
                operation: "task_review_abandoned",
                message: `Task Review abandonment confirmed that the Underengineer process stopped. ${reason}`,
              })}
            WHERE task_review_id = ${reviewId}
              AND outcome = 'unavailable'
              AND json_extract(unavailable, '$.operation') = 'underengineer_pending'
          `;
          return yield* completeReview(
            sql,
            reviewId,
            [],
            { operation: "task_review_abandoned", message: reason },
            repository.idPrefix,
            repository.commonDirectory,
            "tooling_failure",
          );
        }),
      ),
    getById: (reviewId) =>
      repository.transaction("read Task Review", (sql) =>
        getReview(sql, reviewId, repository.idPrefix, repository.commonDirectory),
      ),
    listForTask: (taskId) =>
      repository.transaction("list Task Reviews", (sql) =>
        Effect.gen(function* () {
          const rows = yield* readReviewRows(sql, taskId, repository.idPrefix);
          return yield* Effect.forEach(rows, (row) =>
            decodeReview(sql, row, repository.idPrefix, repository.commonDirectory),
          );
        }),
      ),
    getReviewerAgentSession: (taskId) =>
      repository.transaction("read Task Agent Session", (sql) =>
        Effect.map(
          sql<{ readonly agentSessionId: number | null }>`
            SELECT reviewer_agent_session_id AS agentSessionId
            FROM tasks WHERE id = ${internalTaskId(taskId, repository.idPrefix)}
          `,
          (rows) => rows[0]?.agentSessionId ?? undefined,
        ),
      ),
    getReviewerConfiguration: (taskId) =>
      repository.transaction("read Task Reviewer configuration", (sql) =>
        readReviewerConfiguration(sql, taskId, repository.idPrefix),
      ),
    linkAgentInvocation:
      (input): AgentSessionSqlLink =>
      (sql, invocationId) =>
        linkAgentInvocation(sql, invocationId, input, repository.idPrefix),
    settleAgentReview:
      (input): AgentSessionSqlLink =>
      (sql, invocationId) =>
        Effect.gen(function* () {
          const operationName = "settle Task Review with Agent Invocation";
          const toolingFailure =
            input.toolingFailure === undefined
              ? undefined
              : yield* decodeTaskReviewToolingFailureEffect(operationName, input.toolingFailure);
          const invocations = yield* readTaskReviewInvocationEvidence(
            sql,
            input.reviewId,
            operationName,
          );
          const terminal = invocations.at(-1);
          if (terminal?.invocation.id !== invocationId) {
            return yield* invalid(
              operationName,
              "Only the terminal linked Invocation can settle the Task Review",
            );
          }
          if (
            invocations.some(
              (evidence) =>
                evidence.taskOwned !== 1 ||
                evidence.invocation.settledAt === null ||
                evidence.invocation.settlementKind === null,
            )
          ) {
            return yield* invalid(
              operationName,
              "Every Task Review Invocation must be Task-owned and settled",
            );
          }
          if (input.complete && toolingFailure !== undefined) {
            return yield* invalid(
              operationName,
              "A completed Agent Task Review settlement cannot contain a Tooling Failure",
            );
          }
          if (input.complete && terminal.invocation.settlementKind !== "returned") {
            return yield* invalid(
              operationName,
              "Passing and Finding-blocked Task Reviews require a returned terminal Invocation",
            );
          }
          if (input.complete) {
            const completed = yield* completeReview(
              sql,
              input.reviewId,
              input.findings,
              toolingFailure,
              repository.idPrefix,
              repository.commonDirectory,
              "agent_settlement",
            );
            if (!completed.ok)
              return yield* invalid(
                "settle Task Review with Agent Invocation",
                `Task Review did not complete: ${completed.code}`,
              );
          } else {
            if (toolingFailure === undefined)
              return yield* invalid(
                "settle Task Review with Agent Invocation",
                "Active Agent Task Review settlement requires a Tooling Failure",
              );
            yield* sql`
              UPDATE task_reviews SET tooling_failure = ${JSON.stringify(toolingFailure)}
              WHERE id = ${input.reviewId} AND outcome IS NULL
            `;
          }
        }).pipe(Effect.asVoid),
    recordActiveFailure: (reviewId, failure) =>
      repository.transactionImmediate("record active Task Review failure", (sql) =>
        Effect.gen(function* () {
          const validated = yield* decodeTaskReviewToolingFailureEffect(
            "record active Task Review failure",
            failure,
          );
          yield* sql`
            UPDATE task_reviews SET tooling_failure = ${JSON.stringify(validated)}
            WHERE id = ${reviewId} AND outcome IS NULL
          `;
        }).pipe(Effect.asVoid),
      ),
    getLatestForTask: (taskId) =>
      repository.transaction("read current Task Review", (sql) =>
        Effect.gen(function* () {
          const rows = yield* sql.unsafe<ReviewRow>(
            `SELECT ${reviewColumns} FROM task_reviews WHERE task_id = ? ORDER BY id DESC LIMIT 1`,
            [internalTaskId(taskId, repository.idPrefix)],
          );
          const row = rows[0];
          return row === undefined
            ? undefined
            : yield* decodeReview(sql, row, repository.idPrefix, repository.commonDirectory);
        }),
      ),
    proposalIsCurrent: (review) =>
      repository.transaction("compare Task Review proposal", (sql) =>
        currentProposalMatches(sql, review, repository.idPrefix),
      ),
  }));

export const taskReviewAdmissionRejection = (
  sql: SqlClient.SqlClient,
  taskId: string,
  idPrefix: string,
  linkedChangeId?: string,
): Effect.Effect<
  TaskReviewAdmissionRejection | undefined,
  SqlError | RepositoryPersistedDataInvalid
> =>
  Effect.gen(function* () {
    const tasks = yield* sql<{ readonly state: string }>`
      SELECT state FROM tasks WHERE id = ${internalTaskId(taskId, idPrefix)}
    `;
    const task = tasks[0];
    if (task === undefined) return { ok: false as const, code: "task_not_found" as const };
    if (task.state !== "new") {
      return { ok: false as const, code: "invalid_task_state" as const, state: task.state };
    }
    if (linkedChangeId !== undefined) {
      return { ok: false as const, code: "task_change_linked" as const, changeId: linkedChangeId };
    }
    const active = yield* sql<{ readonly id: number }>`
      SELECT id FROM task_reviews
      WHERE task_id = ${internalTaskId(taskId, idPrefix)} AND outcome IS NULL LIMIT 1
    `;
    return active[0] === undefined
      ? undefined
      : { ok: false as const, code: "active_task_review" as const, reviewId: active[0].id };
  });

export const admitTaskReview = (
  sql: SqlClient.SqlClient,
  input: AdmitTaskReviewInput,
  idPrefix: string,
  repositoryCommonDirectory: string,
  linkedChangeId?: string,
): Effect.Effect<AdmitTaskReviewResult, SqlError | RepositoryPersistedDataInvalid> =>
  Effect.gen(function* () {
    const rejected = yield* taskReviewAdmissionRejection(
      sql,
      input.taskId,
      idPrefix,
      linkedChangeId,
    );
    if (rejected !== undefined) return rejected;
    const policy = yield* Effect.try({
      try: () => decodeTaskReviewPolicySnapshot(input.policy),
      catch: (cause) =>
        new RepositoryPersistedDataInvalid({ operationName: "admit Task Review", cause }),
    });
    const tasks = yield* sql<{
      readonly title: string;
      readonly description: string;
      readonly reviewerConfiguration: string | null;
      readonly reviewerAgentSessionId: number | null;
    }>`
      SELECT title, description, reviewer_configuration AS reviewerConfiguration,
        reviewer_agent_session_id AS reviewerAgentSessionId
      FROM tasks WHERE id = ${internalTaskId(input.taskId, idPrefix)}
    `;
    const task = tasks[0];
    if (task === undefined) return yield* invalid("admit Task Review", "Task disappeared");
    if ((task.reviewerConfiguration === null) !== (task.reviewerAgentSessionId === null)) {
      return yield* invalid("admit Task Review", "Task Reviewer authority is incomplete");
    }
    if (task.reviewerConfiguration !== null) {
      const existing = yield* decodeTaskReviewPolicy(
        "admit Task Review",
        task.reviewerConfiguration,
      );
      if (JSON.stringify(existing) !== JSON.stringify(policy)) {
        return yield* invalid(
          "admit Task Review",
          "Task Reviewer policy cannot change for this Agent Session",
        );
      }
    }
    const dependencies = yield* dependencyEvidence(sql, input.taskId, idPrefix);
    const proposal: TaskReviewProposal = {
      title: task.title,
      description: task.description,
      dependencyIds: dependencies.map((dependency) => dependency.id),
    };
    const inserted = yield* sql<{ readonly id: number }>`
      INSERT INTO task_reviews (
        task_id, proposal, dependency_evidence, base_ref, base_commit, outcome,
        findings, tooling_failure, cleanup_pending, cleanup_blocking_reason
      ) VALUES (
        ${internalTaskId(input.taskId, idPrefix)}, ${JSON.stringify(proposal)},
        ${JSON.stringify(dependencies)}, ${input.baseRef}, ${input.baseCommit}, NULL,
        '[]', NULL, 1, NULL
      ) RETURNING id
    `;
    const reviewId = inserted[0]?.id;
    if (reviewId === undefined) return yield* invalid("admit Task Review", "Review ID is missing");
    const completedAdvice = yield* sql<{ readonly adviceExists: number }>`
      SELECT 1 AS adviceExists
      FROM task_review_simplification_advice AS advice
      JOIN task_reviews AS prior_review ON prior_review.id = advice.task_review_id
      WHERE prior_review.task_id = ${internalTaskId(input.taskId, idPrefix)}
        AND advice.outcome = 'completed'
      LIMIT 1
    `;
    const simplificationAdviceAttempt =
      input.simplificationAdvice !== undefined && completedAdvice[0] === undefined;
    if (simplificationAdviceAttempt) {
      yield* sql`
        INSERT INTO task_review_simplification_advice (
          task_review_id, outcome, advice, unavailable, configuration
        ) VALUES (
          ${reviewId}, 'unavailable', NULL, ${JSON.stringify({
            operation: "underengineer_pending",
            message: "Task Simplification Advice attempt is pending.",
          })},
          ${
            input.simplificationAdvice.configuration === undefined
              ? null
              : JSON.stringify(input.simplificationAdvice.configuration)
          }
        )
      `;
    }
    const stored = yield* getReview(sql, reviewId, idPrefix, repositoryCommonDirectory);
    if (stored === undefined) return yield* invalid("admit Task Review", "Review disappeared");
    return {
      ok: true as const,
      review: stored,
      policy,
      proposal,
      dependencyEvidence: dependencies,
    };
  });

const reuseTaskReviewJudgment = (
  sql: SqlClient.SqlClient,
  taskId: string,
  _now: string,
  idPrefix: string,
  repositoryCommonDirectory: string,
) =>
  Effect.gen(function* () {
    const tasks = yield* sql<{
      readonly title: string;
      readonly description: string;
      readonly state: string;
    }>`SELECT title, description, state FROM tasks WHERE id = ${internalTaskId(taskId, idPrefix)}`;
    const task = tasks[0];
    if (task === undefined || task.state !== "new") return undefined;
    const active = yield* sql<{ readonly id: number }>`
      SELECT id FROM task_reviews
      WHERE task_id = ${internalTaskId(taskId, idPrefix)} AND outcome IS NULL LIMIT 1
    `;
    if (active[0] !== undefined) return undefined;
    const currentProposal: TaskReviewProposal = {
      title: task.title,
      description: task.description,
      dependencyIds: yield* directDependencyIds(sql, taskId, idPrefix),
    };
    const rows = yield* sql.unsafe<ReviewRow>(
      `SELECT ${reviewColumns} FROM task_reviews WHERE task_id = ? AND outcome IS NOT NULL ORDER BY id DESC`,
      [internalTaskId(taskId, idPrefix)],
    );
    for (const row of rows) {
      if (JSON.stringify(parseProposal(row.proposalSnapshot)) !== JSON.stringify(currentProposal)) {
        continue;
      }
      if (row.outcome !== "passed") return undefined;
      const review = yield* decodeReview(sql, row, idPrefix, repositoryCommonDirectory);
      const judgment = completedTaskReviewResult(review, "new");
      if (judgment === undefined || judgment.outcome !== "passed") {
        return yield* invalid("reuse Task Review judgment", "Judgment facts are inconsistent");
      }
      yield* sql`
        UPDATE tasks SET state = 'todo'
        WHERE id = ${internalTaskId(taskId, idPrefix)} AND state = 'new'
      `;
      return judgment;
    }
    return undefined;
  });

const completeReview = (
  sql: SqlClient.SqlClient,
  reviewId: number,
  findings: readonly TaskReviewFinding[],
  toolingFailure: TaskReviewToolingFailure | undefined,
  idPrefix: string,
  repositoryCommonDirectory: string,
  authority: "agent_settlement" | "tooling_failure",
) =>
  Effect.gen(function* () {
    const validatedToolingFailure =
      toolingFailure === undefined
        ? undefined
        : yield* decodeTaskReviewToolingFailureEffect("complete Task Review", toolingFailure);
    const current = yield* getReview(sql, reviewId, idPrefix, repositoryCommonDirectory);
    if (current === undefined) {
      return { ok: false as const, code: "task_review_not_found" as const };
    }
    if (current.state === "complete") {
      const completed = completedTaskReviewResult(
        current,
        yield* readTaskState(sql, current.taskId, idPrefix),
      );
      return (
        completed ?? (yield* invalid("complete Task Review", "Completion facts are inconsistent"))
      );
    }
    if (current.workspaceCleanup !== "removed") {
      return { ok: false as const, code: "task_review_not_active" as const };
    }
    const validatedFindings = yield* Effect.try({
      try: () => findings.map(decodeReviewerFindingCore),
      catch: (cause) =>
        new RepositoryPersistedDataInvalid({ operationName: "complete Task Review", cause }),
    });
    const admission = yield* inspectCurrentAdmission(sql, current, idPrefix);
    const failure = admission.ok ? validatedToolingFailure : admission.failure;
    const outcome =
      failure !== undefined
        ? "tooling_failed"
        : validatedFindings.length > 0
          ? "blocked"
          : "passed";
    if (outcome !== "tooling_failed" && authority !== "agent_settlement") {
      return yield* invalid(
        "complete Task Review",
        "Only atomic Agent settlement can pass or block an Active Task Review",
      );
    }
    yield* requireTaskReviewInvocationEvidence(sql, reviewId, outcome);
    if (outcome === "passed") {
      yield* sql`
        UPDATE tasks SET state = 'todo'
        WHERE id = ${internalTaskId(current.taskId, idPrefix)} AND state = 'new'
      `;
    }
    yield* sql`
      UPDATE task_reviews SET outcome = ${outcome}, findings = ${JSON.stringify(validatedFindings)},
        tooling_failure = ${failure === undefined ? null : JSON.stringify(failure)}
      WHERE id = ${reviewId} AND outcome IS NULL
    `;
    const completed = yield* getReview(sql, reviewId, idPrefix, repositoryCommonDirectory);
    if (completed === undefined)
      return yield* invalid("complete Task Review", "Review disappeared");
    const result = completedTaskReviewResult(
      completed,
      yield* readTaskState(sql, current.taskId, idPrefix),
    );
    return result ?? (yield* invalid("complete Task Review", "Completion facts are inconsistent"));
  });

const completedTaskReviewResult = (
  review: TaskReviewRecord,
  taskState: TaskState,
): CompleteTaskReviewSuccess | undefined => {
  if (review.state !== "complete") return undefined;
  switch (review.outcome) {
    case "passed":
      if (review.findings.length !== 0 || review.toolingFailure !== null) return undefined;
      return {
        ok: true,
        outcome: "passed",
        review: {
          ...review,
          state: "complete",
          outcome: "passed",
          findings: [],
          toolingFailure: null,
        },
        task: { id: review.taskId, state: "todo" },
      };
    case "blocked": {
      const first = review.findings[0];
      if (first === undefined || review.toolingFailure !== null || taskState !== "new")
        return undefined;
      return {
        ok: true,
        outcome: "blocked",
        review: {
          ...review,
          state: "complete",
          outcome: "blocked",
          findings: [first, ...review.findings.slice(1)],
          toolingFailure: null,
        },
        task: { id: review.taskId, state: "new" },
      };
    }
    case "tooling_failed":
      return review.toolingFailure === null
        ? undefined
        : {
            ok: true,
            outcome: "tooling_failed",
            review: {
              ...review,
              state: "complete",
              outcome: "tooling_failed",
              toolingFailure: review.toolingFailure,
            },
            task: { id: review.taskId, state: taskState },
          };
    case null:
      return undefined;
  }
};

const readReviewRows = (sql: SqlClient.SqlClient, taskId: string, idPrefix: string) =>
  sql.unsafe<ReviewRow>(
    `SELECT ${reviewColumns} FROM task_reviews WHERE task_id = ? ORDER BY id ASC`,
    [internalTaskId(taskId, idPrefix)],
  );

const getReview = (
  sql: SqlClient.SqlClient,
  reviewId: number,
  idPrefix: string,
  repositoryCommonDirectory: string,
) =>
  Effect.gen(function* () {
    const rows = yield* sql.unsafe<ReviewRow>(
      `SELECT ${reviewColumns} FROM task_reviews WHERE id = ?`,
      [reviewId],
    );
    return rows[0] === undefined
      ? undefined
      : yield* decodeReview(sql, rows[0], idPrefix, repositoryCommonDirectory);
  });

const decodeReview = (
  sql: SqlClient.SqlClient,
  row: ReviewRow,
  idPrefix: string,
  repositoryCommonDirectory: string,
) =>
  Effect.gen(function* () {
    const task = yield* sql<{
      readonly agentSessionId: number | null;
      readonly configuration: string | null;
    }>`
      SELECT reviewer_agent_session_id AS agentSessionId,
        reviewer_configuration AS configuration FROM tasks WHERE id = ${row.taskId}
    `;
    const invocations = yield* readAgentInvocations(sql, row.id);
    const simplificationAdviceAttempt = yield* readSimplificationAdviceAttempt(sql, row.id);
    return yield* Effect.try({
      try: (): TaskReviewRecord => {
        const cleanupPending = decodeBoolean(row.cleanupPending, "Task Review cleanup obligation");
        const taskAuthority = task[0];
        if (taskAuthority === undefined) throw new Error("Task Review owner is missing");
        if ((taskAuthority.configuration === null) !== (taskAuthority.agentSessionId === null)) {
          throw new Error("Task Reviewer authority is incomplete");
        }
        const invocationSessionId = invocations[0]?.agentSessionId;
        if (
          invocationSessionId !== undefined &&
          invocations.some((invocation) => invocation.agentSessionId !== invocationSessionId)
        ) {
          throw new Error("Task Review Invocations do not share one Agent Session");
        }
        const policy =
          invocations.length === 0 || taskAuthority.configuration === null
            ? undefined
            : parsePolicy(taskAuthority.configuration);
        const runtimeConfig = policy?.profile.profile.runtimeConfig;
        const policyMatchesInvocationEvidence =
          policy !== undefined &&
          invocationSessionId === taskAuthority.agentSessionId &&
          invocations.every(
            (invocation) =>
              invocation.harness === "pi" &&
              invocation.provider === null &&
              invocation.model === runtimeConfig?.model &&
              invocation.thinking === (runtimeConfig?.thinking ?? null),
          );
        return {
          id: row.id,
          taskId: publicTaskIdFromInternal(row.taskId, idPrefix),
          proposal: parseProposal(row.proposalSnapshot),
          dependencyEvidence: parseDependencies(row.dependencyEvidence),
          baseRef: row.baseRef,
          baseCommit: row.baseCommit,
          workspacePath: expectedTaskReviewWorkspacePath(repositoryCommonDirectory, row.id),
          state: row.outcome === null ? "running" : "complete",
          outcome: parseReviewOutcome(row.outcome),
          workspaceCleanup: cleanupPending
            ? row.cleanupBlockingReason === null
              ? "not_created"
              : "failed"
            : "removed",
          cleanupBlockingReason: row.cleanupBlockingReason,
          toolingFailure: row.toolingFailure === null ? null : parseFailure(row.toolingFailure),
          findings: parseFindings(row.findings),
          ...(invocationSessionId === undefined ? {} : { agentSessionId: invocationSessionId }),
          ...(invocations.length === 0
            ? {}
            : { agentInvocations: invocations.map(decodeSqliteAgentInvocation) }),
          ...(policyMatchesInvocationEvidence ? { reviewerConfiguration: policy } : {}),
          ...(simplificationAdviceAttempt === null ? {} : { simplificationAdviceAttempt }),
        };
      },
      catch: (cause) =>
        new RepositoryPersistedDataInvalid({ operationName: "read Task Review", cause }),
    });
  });

const readTaskReviewInvocationEvidence = (
  sql: SqlClient.SqlClient,
  reviewId: number,
  operationName: string,
) =>
  Effect.flatMap(
    sql<TaskReviewInvocationEvidenceRow>`
      SELECT invocation.id, continuation.agent_session_id AS agentSessionId,
        invocation.continuation_id AS continuationId, invocation.created_at AS createdAt,
        invocation.settled_at AS settledAt, invocation.settlement_kind AS settlementKind,
        invocation.input_tokens AS inputTokens,
        invocation.cached_input_tokens AS cachedInputTokens,
        invocation.cache_write_tokens AS cacheWriteTokens,
        invocation.output_tokens AS outputTokens,
        invocation.total_tokens AS totalTokens,
        continuation.harness, continuation.provider, continuation.model, continuation.thinking,
        continuation.transcript_path AS transcriptPath,
        continuation.unusable_reason AS unusableReason,
        CASE WHEN task.reviewer_agent_session_id = continuation.agent_session_id
          THEN 1 ELSE 0 END AS taskOwned
        FROM task_review_agent_invocations AS link
        JOIN task_reviews AS review ON review.id = link.task_review_id
        JOIN tasks AS task ON task.id = review.task_id
        JOIN agent_invocations AS invocation ON invocation.id = link.agent_invocation_id
        JOIN agent_continuations AS continuation ON continuation.id = invocation.continuation_id
        WHERE link.task_review_id = ${reviewId}
        ORDER BY link.agent_invocation_id
    `,
    (rows) =>
      decodePersisted(operationName, () =>
        rows.map(({ taskOwned, ...row }) => ({
          taskOwned,
          invocation: decodeSqliteAgentInvocation(row),
        })),
      ),
  );

const requireTaskReviewInvocationEvidence = (
  sql: SqlClient.SqlClient,
  reviewId: number,
  outcome: "passed" | "blocked" | "tooling_failed",
) =>
  Effect.gen(function* () {
    const invocations = yield* readTaskReviewInvocationEvidence(
      sql,
      reviewId,
      "complete Task Review",
    );
    if ((outcome === "passed" || outcome === "blocked") && invocations.length === 0) {
      return yield* invalid(
        "complete Task Review",
        "Passing and Finding-blocked Task Reviews require Agent Invocation evidence",
      );
    }
    if (
      invocations.some(
        (evidence) =>
          evidence.taskOwned !== 1 ||
          evidence.invocation.settledAt === null ||
          evidence.invocation.settlementKind === null,
      )
    ) {
      return yield* invalid(
        "complete Task Review",
        "Every linked Task Review Invocation must be Task-owned and settled",
      );
    }
    if (
      (outcome === "passed" || outcome === "blocked") &&
      invocations.at(-1)?.invocation.settlementKind !== "returned"
    ) {
      return yield* invalid(
        "complete Task Review",
        "Task Review outcome does not match its terminal Invocation",
      );
    }
  }).pipe(Effect.asVoid);

const readCompletedSimplificationAdvice = (
  sql: SqlClient.SqlClient,
  taskId: string,
  idPrefix: string,
) =>
  Effect.flatMap(
    sql<{ readonly advice: string }>`
      SELECT advice FROM task_review_simplification_advice AS advice
      JOIN task_reviews AS review ON review.id = advice.task_review_id
      WHERE review.task_id = ${internalTaskId(taskId, idPrefix)}
        AND advice.outcome = 'completed'
      ORDER BY review.id ASC LIMIT 1
    `,
    (rows) => {
      const row = rows[0];
      return row === undefined
        ? Effect.succeed(undefined)
        : Effect.try({
            try: () => decodeTaskSimplificationAdvice(JSON.parse(row.advice) as unknown),
            catch: (cause) =>
              new RepositoryPersistedDataInvalid({
                operationName: "read Task Simplification Advice",
                cause,
              }),
          });
    },
  );

const recordSimplificationAdviceFailure = (
  sql: SqlClient.SqlClient,
  reviewId: number,
  failure: TaskReviewToolingFailure,
) =>
  sql`
    UPDATE task_review_simplification_advice
    SET outcome = 'unavailable', advice = NULL, unavailable = ${JSON.stringify(failure)}
    WHERE task_review_id = ${reviewId}
      AND outcome = 'unavailable'
      AND json_extract(unavailable, '$.operation') = 'underengineer_pending'
  `.pipe(Effect.asVoid);

const linkSimplificationAdviceInvocation = (
  sql: SqlClient.SqlClient,
  reviewId: number,
  invocationId: number,
) =>
  sql`
    UPDATE task_review_simplification_advice
    SET agent_invocation_id = ${invocationId}
    WHERE task_review_id = ${reviewId} AND agent_invocation_id IS NULL
  `.pipe(Effect.asVoid);

const settleSimplificationAdvice = (
  sql: SqlClient.SqlClient,
  input: SettleSimplificationAdviceInput & {
    readonly invocationId: number;
  },
) =>
  Effect.gen(function* () {
    const row = yield* sql<{ readonly taskId: number }>`
      SELECT task_id AS taskId FROM task_reviews WHERE id = ${input.reviewId}
    `;
    if (row[0] === undefined)
      return yield* invalid("settle Task Simplification Advice", "Review missing");
    if (input.complete) {
      yield* sql`
        UPDATE task_review_simplification_advice
        SET outcome = 'completed', advice = ${JSON.stringify(input.advice)}, unavailable = NULL
        WHERE task_review_id = ${input.reviewId}
      `;
    } else {
      yield* sql`
        UPDATE task_review_simplification_advice
        SET outcome = 'unavailable', advice = NULL, unavailable = ${JSON.stringify(input.failure)}
        WHERE task_review_id = ${input.reviewId}
      `;
    }
  }).pipe(Effect.asVoid);

const agentInvocationProjection = `
  invocation.id, continuation.agent_session_id AS agentSessionId,
  invocation.continuation_id AS continuationId, invocation.created_at AS createdAt,
  invocation.settled_at AS settledAt, invocation.settlement_kind AS settlementKind,
  invocation.input_tokens AS inputTokens, invocation.cached_input_tokens AS cachedInputTokens,
  invocation.cache_write_tokens AS cacheWriteTokens, invocation.output_tokens AS outputTokens,
  invocation.total_tokens AS totalTokens, continuation.harness, continuation.provider,
  continuation.model, continuation.thinking, continuation.transcript_path AS transcriptPath,
  continuation.unusable_reason AS unusableReason
`;

const agentInvocationJoins = `
  FROM agent_invocations AS invocation
  JOIN agent_continuations AS continuation ON continuation.id = invocation.continuation_id
`;

const readSimplificationAdviceAttempt = (
  sql: SqlClient.SqlClient,
  reviewId: number,
): Effect.Effect<
  TaskSimplificationAdviceAttempt | null,
  SqlError | RepositoryPersistedDataInvalid
> =>
  Effect.gen(function* () {
    const attempts = yield* sql<{
      readonly outcome: string;
      readonly advice: string | null;
      readonly unavailable: string | null;
      readonly configuration: string | null;
      readonly agentInvocationId: number | null;
    }>`
      SELECT outcome, advice, unavailable, configuration,
        agent_invocation_id AS agentInvocationId
      FROM task_review_simplification_advice WHERE task_review_id = ${reviewId}
    `;
    const attempt = attempts[0];
    if (attempt === undefined) return null;
    const invocations =
      attempt.agentInvocationId === null
        ? []
        : yield* sql.unsafe<SqliteAgentInvocationRow>(
            `SELECT ${agentInvocationProjection} ${agentInvocationJoins} WHERE invocation.id = ?`,
            [attempt.agentInvocationId],
          );
    return yield* Effect.try({
      try: () => {
        const configuration =
          attempt.configuration === null
            ? null
            : decodeTaskSimplificationAdvicePolicy(JSON.parse(attempt.configuration) as unknown);
        const decodedInvocations = invocations.map(decodeSqliteAgentInvocation);
        const firstInvocation = decodedInvocations[0];
        const firstPersistedInvocation = invocations[0];
        const invocationEvidence =
          firstInvocation === undefined
            ? {}
            : {
                ...(invocations[0] === undefined
                  ? {}
                  : { agentSessionId: invocations[0].agentSessionId }),
                agentInvocations: decodedInvocations,
              };
        if (attempt.outcome === "completed") {
          if (
            attempt.advice === null ||
            attempt.unavailable !== null ||
            configuration === null ||
            firstInvocation === undefined ||
            firstPersistedInvocation === undefined
          ) {
            throw new Error("Completed Task Simplification Advice has inconsistent result fields.");
          }
          const completedInvocations: readonly [AgentInvocationRecord, ...AgentInvocationRecord[]] =
            [firstInvocation, ...decodedInvocations.slice(1)];
          return {
            state: "completed" as const,
            advice: decodeTaskSimplificationAdvice(JSON.parse(attempt.advice) as unknown),
            unavailable: null,
            configuration,
            agentSessionId: firstPersistedInvocation.agentSessionId,
            agentInvocations: completedInvocations,
          };
        }
        if (attempt.outcome === "unavailable") {
          if (attempt.advice !== null || attempt.unavailable === null) {
            throw new Error(
              "Unavailable Task Simplification Advice has inconsistent result fields.",
            );
          }
          return {
            state: "unavailable" as const,
            advice: null,
            unavailable: decodeTaskReviewToolingFailure(JSON.parse(attempt.unavailable) as unknown),
            configuration,
            ...invocationEvidence,
          };
        }
        throw new Error(`Unknown Task Simplification Advice outcome: ${attempt.outcome}`);
      },
      catch: (cause) =>
        new RepositoryPersistedDataInvalid({
          operationName: "read Task Simplification Advice attempt",
          cause,
        }),
    });
  });

const readAgentInvocations = (sql: SqlClient.SqlClient, reviewId: number) =>
  sql.unsafe<SqliteAgentInvocationRow>(
    `SELECT ${agentInvocationProjection}
      FROM task_review_agent_invocations AS link
      JOIN agent_invocations AS invocation ON invocation.id = link.agent_invocation_id
      JOIN agent_continuations AS continuation ON continuation.id = invocation.continuation_id
      WHERE link.task_review_id = ?
      ORDER BY invocation.id ASC`,
    [reviewId],
  );

const linkAgentInvocation = (
  sql: SqlClient.SqlClient,
  invocationId: number,
  input: Parameters<NonNullable<TaskReviewPersistence["linkAgentInvocation"]>>[0],
  idPrefix: string,
) =>
  Effect.gen(function* () {
    const reviewOwners = yield* sql<{ readonly taskId: number; readonly outcome: string | null }>`
      SELECT task_id AS taskId, outcome FROM task_reviews WHERE id = ${input.reviewId}
    `;
    if (
      reviewOwners[0]?.taskId !== internalTaskId(input.taskId, idPrefix) ||
      reviewOwners[0].outcome !== null
    ) {
      return yield* invalid(
        "link Task Agent Invocation",
        "Task Review does not belong to the Task or is not active",
      );
    }
    const sessions = yield* sql<{
      readonly agentSessionId: number;
      readonly harness: string;
      readonly provider: string | null;
      readonly model: string;
      readonly thinking: string | null;
    }>`
      SELECT continuation.agent_session_id AS agentSessionId, continuation.harness,
        continuation.provider, continuation.model, continuation.thinking
      FROM agent_invocations AS invocation
      JOIN agent_continuations AS continuation ON continuation.id = invocation.continuation_id
      WHERE invocation.id = ${invocationId}
    `;
    const session = sessions[0];
    if (session === undefined)
      return yield* invalid("link Task Agent Invocation", "Invocation Session is missing");
    const sessionId = session.agentSessionId;
    const taskAuthority = yield* sql<{
      readonly agentSessionId: number | null;
      readonly configuration: string | null;
    }>`
      SELECT reviewer_agent_session_id AS agentSessionId,
        reviewer_configuration AS configuration
      FROM tasks WHERE id = ${internalTaskId(input.taskId, idPrefix)}
    `;
    const authority = taskAuthority[0];
    if (authority === undefined) {
      return yield* invalid("link Task Agent Invocation", "Task Reviewer authority is missing");
    }
    if ((authority.configuration === null) !== (authority.agentSessionId === null)) {
      return yield* invalid("link Task Agent Invocation", "Task Reviewer authority is incomplete");
    }
    const admittedPolicy = yield* Effect.try({
      try: () => decodeTaskReviewPolicySnapshot(input.admittedPolicy),
      catch: (cause) =>
        new RepositoryPersistedDataInvalid({
          operationName: "link Task Agent Invocation",
          cause,
        }),
    });
    const storedPolicy =
      authority.configuration === null
        ? undefined
        : yield* decodeTaskReviewPolicy("link Task Agent Invocation", authority.configuration);
    const configurationChanged =
      storedPolicy !== undefined && JSON.stringify(storedPolicy) !== JSON.stringify(admittedPolicy);
    if (authority.agentSessionId !== null && authority.agentSessionId !== sessionId) {
      return yield* invalid("link Task Agent Invocation", "Task already has another Agent Session");
    }
    if (configurationChanged) {
      return yield* invalid(
        "link Task Agent Invocation",
        "Task Reviewer policy cannot change for this Agent Session",
      );
    }
    const runtimeConfig = admittedPolicy.profile.profile.runtimeConfig;
    if (
      session.harness !== "pi" ||
      session.provider !== null ||
      session.model !== runtimeConfig.model ||
      session.thinking !== (runtimeConfig.thinking ?? null)
    ) {
      return yield* invalid(
        "link Task Agent Invocation",
        "Agent Continuation configuration does not match the Task Reviewer",
      );
    }
    const changeOwners = yield* sql<{ readonly count: number }>`
      SELECT COUNT(*) AS count FROM change_agent_sessions WHERE agent_session_id = ${sessionId}
    `;
    const taskOwners = yield* sql<{ readonly count: number }>`
      SELECT COUNT(*) AS count FROM tasks
      WHERE reviewer_agent_session_id = ${sessionId}
        AND id <> ${internalTaskId(input.taskId, idPrefix)}
    `;
    if ((changeOwners[0]?.count ?? 0) > 0 || (taskOwners[0]?.count ?? 0) > 0) {
      return yield* invalid(
        "link Task Agent Invocation",
        "Agent Session already has another owner",
      );
    }
    if (authority.configuration === null) {
      yield* sql`
        UPDATE tasks SET reviewer_configuration = ${JSON.stringify(admittedPolicy)},
          reviewer_agent_session_id = ${sessionId}
        WHERE id = ${internalTaskId(input.taskId, idPrefix)}
      `;
    }
    yield* sql`
      INSERT INTO task_review_agent_invocations (task_review_id, agent_invocation_id)
      VALUES (${input.reviewId}, ${invocationId})
    `;
  }).pipe(Effect.asVoid);

const readReviewerConfiguration = (sql: SqlClient.SqlClient, taskId: string, idPrefix: string) =>
  Effect.gen(function* () {
    const rows = yield* sql<{ readonly configuration: string | null }>`
      SELECT reviewer_configuration AS configuration FROM tasks
      WHERE id = ${internalTaskId(taskId, idPrefix)}
    `;
    const configuration = rows[0]?.configuration;
    if (configuration === undefined || configuration === null) return undefined;
    return yield* Effect.try({
      try: () => parsePolicy(configuration),
      catch: (cause) =>
        new RepositoryPersistedDataInvalid({
          operationName: "read Task Reviewer configuration",
          cause,
        }),
    });
  });

const readTaskState = (sql: SqlClient.SqlClient, taskId: string, idPrefix: string) =>
  Effect.gen(function* () {
    const rows = yield* sql<{ readonly state: TaskState }>`
      SELECT state FROM tasks WHERE id = ${internalTaskId(taskId, idPrefix)}
    `;
    return rows[0]?.state ?? (yield* invalid("complete Task Review", "Task disappeared"));
  });

const inspectCurrentAdmission = (
  sql: SqlClient.SqlClient,
  review: TaskReviewRecord,
  idPrefix: string,
) =>
  Effect.gen(function* () {
    const rows = yield* sql<{
      readonly title: string;
      readonly description: string;
      readonly state: TaskState;
    }>`SELECT title, description, state FROM tasks WHERE id = ${internalTaskId(review.taskId, idPrefix)}`;
    const task = rows[0];
    if (task === undefined) {
      return {
        ok: false as const,
        failure: {
          operation: "confirm_task_review_task",
          message: "The selected Task no longer exists.",
        },
      };
    }
    if (task.state !== "new") {
      return {
        ok: false as const,
        failure: {
          operation: "confirm_task_review_task_state",
          message: `Task state changed from new to ${task.state} during review.`,
        },
      };
    }
    if (task.title !== review.proposal.title || task.description !== review.proposal.description) {
      return {
        ok: false as const,
        failure: {
          operation: "confirm_task_review_context",
          message: "Task title or description changed during review.",
        },
      };
    }
    const dependencies = yield* dependencyEvidence(sql, review.taskId, idPrefix);
    if (
      JSON.stringify(dependencies.map((dependency) => dependency.id)) !==
      JSON.stringify(review.proposal.dependencyIds)
    ) {
      return {
        ok: false as const,
        failure: {
          operation: "confirm_task_review_dependencies",
          message: "Direct Task Dependencies changed during review.",
        },
      };
    }
    return { ok: true as const };
  });

const currentProposalMatches = (
  sql: SqlClient.SqlClient,
  review: TaskReviewRecord,
  idPrefix: string,
) =>
  Effect.gen(function* () {
    const rows = yield* sql<{ readonly title: string; readonly description: string }>`
      SELECT title, description FROM tasks WHERE id = ${internalTaskId(review.taskId, idPrefix)}
    `;
    const task = rows[0];
    if (task === undefined) return false;
    const dependencies = yield* dependencyEvidence(sql, review.taskId, idPrefix);
    return (
      task.title === review.proposal.title &&
      task.description === review.proposal.description &&
      JSON.stringify(dependencies.map((dependency) => dependency.id)) ===
        JSON.stringify(review.proposal.dependencyIds)
    );
  });

const directDependencyIds = (sql: SqlClient.SqlClient, taskId: string, idPrefix: string) =>
  Effect.map(
    sql<{ readonly taskId: number }>`
      SELECT prerequisite_task_id AS taskId FROM task_dependencies
      WHERE dependent_task_id = ${internalTaskId(taskId, idPrefix)} ORDER BY prerequisite_task_id ASC
    `,
    (dependencies) =>
      dependencies.map((dependency) => publicTaskIdFromInternal(dependency.taskId, idPrefix)),
  );

const dependencyEvidence = (sql: SqlClient.SqlClient, taskId: string, idPrefix: string) =>
  Effect.map(
    sql<Omit<TaskReviewDependencyEvidence, "id"> & { readonly id: number }>`
      SELECT prerequisite.id, prerequisite.title, prerequisite.description, prerequisite.state
      FROM task_dependencies
      JOIN tasks AS prerequisite ON prerequisite.id = task_dependencies.prerequisite_task_id
      WHERE task_dependencies.dependent_task_id = ${internalTaskId(taskId, idPrefix)}
      ORDER BY prerequisite.id ASC
    `,
    (dependencies) =>
      dependencies.map((dependency) => ({
        ...dependency,
        id: publicTaskIdFromInternal(dependency.id, idPrefix),
      })),
  );

const parseReviewOutcome = (value: string | null): TaskReviewRecord["outcome"] => {
  if (value === null || value === "passed" || value === "blocked" || value === "tooling_failed") {
    return value;
  }
  throw new Error("Invalid Task Review outcome");
};

const parseObject = (source: string): Record<string, unknown> => {
  const value: unknown = JSON.parse(source) as unknown;
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Expected object");
  }
  return value as Record<string, unknown>;
};
const field = (value: Record<string, unknown>, name: string): unknown => value[name];
const requiredString = (value: unknown): string => {
  if (typeof value !== "string") throw new Error("Expected string");
  return value;
};
const parseStringArray = (value: unknown): readonly string[] => {
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === "string")) {
    throw new Error("Expected string array");
  }
  return value;
};
const parseProposal = (source: string): TaskReviewProposal => {
  const value = parseObject(source);
  return {
    title: requiredString(field(value, "title")),
    description: requiredString(field(value, "description")),
    dependencyIds: parseStringArray(field(value, "dependencyIds")),
  };
};
const parseDependencies = (source: string): readonly TaskReviewDependencyEvidence[] => {
  const value: unknown = JSON.parse(source) as unknown;
  if (!Array.isArray(value)) throw new Error("Expected dependencies");
  return value.map((entry) => {
    const item = parseObject(JSON.stringify(entry));
    return {
      id: requiredString(field(item, "id")),
      title: requiredString(field(item, "title")),
      description: requiredString(field(item, "description")),
      state: requiredString(field(item, "state")),
    };
  });
};
const parseFindings = (source: string): readonly TaskReviewFinding[] => {
  const value: unknown = JSON.parse(source) as unknown;
  if (!Array.isArray(value)) throw new Error("Expected Findings array");
  return value.map(decodeReviewerFindingCore);
};
const parseFailure = (source: string): TaskReviewToolingFailure =>
  decodeTaskReviewToolingFailure(JSON.parse(source) as unknown);
const parsePolicy = (source: string): TaskReviewPolicySnapshot =>
  decodeTaskReviewPolicySnapshot(JSON.parse(source) as unknown);

const decodeTaskReviewPolicy = (operationName: string, source: string) =>
  Effect.try({
    try: () => parsePolicy(source),
    catch: (cause) => new RepositoryPersistedDataInvalid({ operationName, cause }),
  });
const decodeTaskReviewToolingFailureEffect = (operationName: string, value: unknown) =>
  Effect.try({
    try: () => decodeTaskReviewToolingFailure(value),
    catch: (cause) => new RepositoryPersistedDataInvalid({ operationName, cause }),
  });
const decodeBoolean = (value: number, name: string): boolean => {
  if (value !== 0 && value !== 1) throw new Error(`${name} is invalid`);
  return value === 1;
};
const invalid = (operationName: string, message: string) =>
  Effect.fail(new RepositoryPersistedDataInvalid({ operationName, cause: new Error(message) }));
