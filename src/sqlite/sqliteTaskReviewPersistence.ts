import type * as SqlClient from "@effect/sql/SqlClient";
import { Effect, Schema } from "effect";
import type {
  AgentInvocationRecord,
  AgentSessionSqlLink,
} from "../agent/agentSession/agentSession.js";
import type { TokenUsage } from "../agent/tokenUsage.js";
import { agentProfileSchema } from "../contracts/agentConfig.js";
import { RepositoryPersistedDataInvalid } from "../contracts/repositoryStorageError.js";
import type { TaskState } from "../task/lifecycle.js";
import type {
  TaskReviewDependencyEvidence,
  TaskReviewExecution,
  TaskReviewFinding,
  TaskReviewPolicySnapshot,
  TaskReviewProposal,
  TaskReviewRecord,
  TaskReviewToolingFailure,
  LegacyTaskReviewToolingFailure,
} from "../task/review/taskReview.js";
import type {
  CompleteTaskReviewSuccess,
  TaskReviewPersistence,
} from "../task/review/taskReviewPersistence.js";
import { RepositorySql } from "./repositorySql.js";
import { settleUnsettledAgentInvocations } from "./sqliteAgentSessionPersistence.js";

type ReviewRow = {
  readonly id: string;
  readonly taskId: string;
  readonly proposalSnapshot: string;
  readonly dependencyEvidence: string;
  readonly policySnapshot: string;
  readonly baseRef: string;
  readonly baseCommit: string;
  readonly workspacePath: string;
  readonly state: string;
  readonly outcome: string | null;
  readonly workspaceCleanup: string;
  readonly toolingFailure: string | null;
  readonly abandonReason: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
};

type FindingRow = Omit<TaskReviewFinding, "files"> & {
  readonly files: string;
};

type ExecutionRow = Omit<
  TaskReviewExecution,
  "invocationUsage" | "restartReason" | "sessionReference"
> & {
  readonly restartReason: string | null;
  readonly invocationUsage: string;
  readonly sessionReference: string | null;
};

type TranscriptRow = {
  readonly producer: string;
  readonly piSessionId: string;
  readonly filePath: string;
};

type AgentInvocationRow = {
  readonly id: number;
  readonly agentSessionId: number;
  readonly continuationId: number;
  readonly createdAt: string;
  readonly settledAt: string | null;
  readonly settlementKind: string | null;
  readonly inputTokens: number | null;
  readonly cachedInputTokens: number | null;
  readonly outputTokens: number | null;
  readonly totalTokens: number | null;
  readonly harness: string;
  readonly provider: string | null;
  readonly model: string;
  readonly thinking: string | null;
  readonly transcriptPath: string | null;
  readonly unusableReason: string | null;
};

export const openSqliteTaskReviewPersistence = (): Effect.Effect<
  TaskReviewPersistence,
  never,
  RepositorySql
> =>
  Effect.map(RepositorySql, (repository) => ({
    reuseJudgment: (taskId, now) =>
      repository.transactionImmediate("reuse Task Review judgment", (sql) =>
        reuseTaskReviewJudgment(sql, taskId, now),
      ),
    checkAdmission: (taskId) =>
      repository.transaction("check Task Review admission", (sql) =>
        taskReviewAdmissionRejection(sql, taskId),
      ),
    admit: (input) =>
      repository.transactionImmediate("admit Task Review", (sql) =>
        Effect.gen(function* () {
          const rejected = yield* taskReviewAdmissionRejection(sql, input.taskId);
          if (rejected !== undefined) return rejected;
          const tasks = yield* sql<{
            readonly title: string;
            readonly description: string;
          }>`SELECT title, description FROM tasks WHERE id = ${input.taskId}`;
          const task = tasks[0];
          if (task === undefined) return yield* invalid("admit Task Review", "Task disappeared");
          const dependencies = yield* dependencyEvidence(sql, input.taskId);
          const proposal: TaskReviewProposal = {
            title: task.title,
            description: task.description,
            dependencyIds: dependencies.map((dependency) => dependency.id),
          };
          yield* sql`
            INSERT INTO task_reviews (
              id, task_id, proposal_snapshot, dependency_evidence, policy_snapshot,
              base_ref, base_commit, workspace_path, state, outcome, workspace_cleanup,
              tooling_failure, abandon_reason, created_at, updated_at
            ) VALUES (
              ${input.reviewId}, ${input.taskId}, ${JSON.stringify(proposal)},
              ${JSON.stringify(dependencies)}, ${JSON.stringify(input.policy)}, ${input.baseRef},
              ${input.baseCommit}, ${input.workspacePath}, 'running', NULL, 'not_created',
              NULL, NULL, ${input.now}, ${input.now}
            )
          `;
          const review = yield* getReview(sql, input.reviewId);
          if (review === undefined)
            return yield* invalid("admit Task Review", "Review disappeared");
          return { ok: true as const, review, proposal, dependencyEvidence: dependencies };
        }),
      ),
    recordCleanup: (reviewId, cleanup, now) =>
      repository.transactionImmediate("record Task Review cleanup", (sql) =>
        sql`UPDATE task_reviews SET workspace_cleanup = ${cleanup}, updated_at = ${now} WHERE id = ${reviewId}`.pipe(
          Effect.asVoid,
        ),
      ),
    complete: (input) =>
      repository.transactionImmediate("complete Task Review", (sql) =>
        completeReview(
          sql,
          input.reviewId,
          input.findings,
          input.toolingFailure,
          undefined,
          input.now,
          input.agentSettlement === true,
        ),
      ),
    abandon: (reviewId, reason, now) =>
      repository.transactionImmediate("abandon Task Review", (sql) =>
        Effect.gen(function* () {
          const linked = yield* sql<{ readonly invocationId: number }>`
            SELECT agent_invocation_id AS invocationId
            FROM task_review_agent_invocations
            WHERE review_id = ${reviewId}
          `;
          yield* settleUnsettledAgentInvocations(
            sql,
            linked.map(({ invocationId }) => invocationId),
            now,
            `Task Review abandonment confirmed that the reviewer process stopped. ${reason}`,
          );
          return yield* completeReview(
            sql,
            reviewId,
            [],
            { operation: "task_review_abandoned", message: reason },
            reason,
            now,
          );
        }),
      ),
    getById: (reviewId) =>
      repository.transaction("read Task Review", (sql) => getReview(sql, reviewId)),
    listForTask: (taskId) =>
      repository.transaction("list Task Reviews", (sql) =>
        Effect.gen(function* () {
          const rows = yield* readReviewRows(sql, taskId);
          return yield* Effect.forEach(rows, (row) => decodeReview(sql, row));
        }),
      ),
    getReviewerAgentSession: (taskId) =>
      repository.transaction("read Task Agent Session", (sql) =>
        Effect.map(
          sql<{ readonly agentSessionId: number | null }>`
            SELECT reviewer_agent_session_id AS agentSessionId
            FROM tasks WHERE id = ${taskId}
          `,
          (rows) => rows[0]?.agentSessionId ?? undefined,
        ),
      ),
    getReviewerConfiguration: (taskId) =>
      repository.transaction("read Task Reviewer configuration", (sql) =>
        Effect.gen(function* () {
          const rows = yield* sql<{ readonly configuration: string | null }>`
            SELECT reviewer_configuration AS configuration FROM tasks WHERE id = ${taskId}
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
        }),
      ),
    reviewerConfigurationCanBeCorrected: (taskId) =>
      repository.transaction("check Task Reviewer configuration correction", (sql) =>
        Effect.gen(function* () {
          const sessions = yield* sql<{ readonly agentSessionId: number | null }>`
            SELECT reviewer_agent_session_id AS agentSessionId FROM tasks WHERE id = ${taskId}
          `;
          const sessionId = sessions[0]?.agentSessionId;
          if (sessionId === undefined || sessionId === null) return false;
          const latest = yield* sql<{
            readonly settlementKind: string | null;
            readonly transcriptPath: string | null;
          }>`
            SELECT invocation.settlement_kind AS settlementKind,
              continuation.transcript_path AS transcriptPath
            FROM agent_invocations AS invocation
            JOIN agent_continuations AS continuation
              ON continuation.id = invocation.continuation_id
            WHERE continuation.agent_session_id = ${sessionId}
            ORDER BY invocation.id DESC LIMIT 1
          `;
          const transcript = yield* sql<{ readonly count: number }>`
            SELECT COUNT(*) AS count FROM agent_continuations
            WHERE agent_session_id = ${sessionId} AND transcript_path IS NOT NULL
          `;
          const returned = yield* sql<{ readonly count: number }>`
            SELECT COUNT(*) AS count
            FROM agent_invocations AS invocation
            JOIN agent_continuations AS continuation
              ON continuation.id = invocation.continuation_id
            WHERE continuation.agent_session_id = ${sessionId}
              AND invocation.settlement_kind = 'returned'
          `;
          return (
            latest[0]?.settlementKind === "launch_failed" &&
            latest[0]?.transcriptPath === null &&
            (transcript[0]?.count ?? 0) === 0 &&
            (returned[0]?.count ?? 0) === 0
          );
        }),
      ),
    linkAgentInvocation:
      (input): AgentSessionSqlLink =>
      (sql, invocationId) =>
        Effect.gen(function* () {
          const sessions = yield* sql<{ readonly agentSessionId: number }>`
          SELECT continuation.agent_session_id AS agentSessionId
          FROM agent_invocations AS invocation
          JOIN agent_continuations AS continuation ON continuation.id = invocation.continuation_id
          WHERE invocation.id = ${invocationId}
        `;
          const sessionId = sessions[0]?.agentSessionId;
          if (sessionId === undefined)
            return yield* invalid("link Task Agent Invocation", "Invocation Session is missing");
          const taskSession = yield* sql<{ readonly agentSessionId: number | null }>`
            SELECT reviewer_agent_session_id AS agentSessionId FROM tasks WHERE id = ${input.taskId}
          `;
          if (
            taskSession[0]?.agentSessionId !== undefined &&
            taskSession[0].agentSessionId !== null &&
            taskSession[0].agentSessionId !== sessionId
          )
            return yield* invalid(
              "link Task Agent Invocation",
              "Task already has another Agent Session",
            );
          const changeOwners = yield* sql<{ readonly changeId: string }>`
            SELECT change_id AS changeId FROM change_agent_sessions
            WHERE agent_session_id = ${sessionId}
          `;
          const taskOwners = yield* sql<{ readonly taskId: string }>`
            SELECT id AS taskId FROM tasks
            WHERE reviewer_agent_session_id = ${sessionId} AND id <> ${input.taskId}
          `;
          if (changeOwners.length > 0 || taskOwners.length > 0)
            return yield* invalid(
              "link Task Agent Invocation",
              "Agent Session already has another owner",
            );
          const stored = yield* sql<{ readonly configuration: string | null }>`
            SELECT reviewer_configuration AS configuration FROM tasks WHERE id = ${input.taskId}
          `;
          const latest = yield* sql<{
            readonly settlementKind: string | null;
            readonly transcriptPath: string | null;
          }>`
            SELECT invocation.settlement_kind AS settlementKind,
              continuation.transcript_path AS transcriptPath
            FROM agent_invocations AS invocation
            JOIN agent_continuations AS continuation
              ON continuation.id = invocation.continuation_id
            WHERE continuation.agent_session_id = ${sessionId}
              AND invocation.id <> ${invocationId}
            ORDER BY invocation.id DESC LIMIT 1
          `;
          const transcript = yield* sql<{ readonly count: number }>`
            SELECT COUNT(*) AS count FROM agent_continuations
            WHERE agent_session_id = ${sessionId} AND transcript_path IS NOT NULL
          `;
          const returned = yield* sql<{ readonly count: number }>`
            SELECT COUNT(*) AS count
            FROM agent_invocations AS invocation
            JOIN agent_continuations AS continuation
              ON continuation.id = invocation.continuation_id
            WHERE continuation.agent_session_id = ${sessionId}
              AND invocation.id <> ${invocationId}
              AND invocation.settlement_kind = 'returned'
          `;
          const canCorrect =
            stored[0]?.configuration !== undefined &&
            stored[0]?.configuration !== null &&
            latest[0]?.settlementKind === "launch_failed" &&
            latest[0]?.transcriptPath === null &&
            (transcript[0]?.count ?? 0) === 0 &&
            (returned[0]?.count ?? 0) === 0;
          const configuration =
            stored[0]?.configuration === undefined ||
            stored[0]?.configuration === null ||
            canCorrect
              ? JSON.stringify(input.configurationSnapshot ?? input.configuration)
              : stored[0].configuration;
          yield* sql`
          UPDATE tasks
          SET reviewer_configuration = ${configuration},
              reviewer_agent_session_id = COALESCE(reviewer_agent_session_id, ${sessionId})
          WHERE id = ${input.taskId}
        `;
          yield* sql`
          INSERT INTO task_review_agent_invocations (review_id, agent_invocation_id)
          VALUES (${input.reviewId}, ${invocationId})
        `;
        }).pipe(Effect.asVoid),
    settleAgentReview:
      (input): AgentSessionSqlLink =>
      (sql, invocationId) =>
        Effect.gen(function* () {
          const linked = yield* sql<{ readonly reviewId: string }>`
            SELECT review_id AS reviewId FROM task_review_agent_invocations
            WHERE review_id = ${input.reviewId} AND agent_invocation_id = ${invocationId}
          `;
          if (linked.length === 0)
            return yield* invalid(
              "settle Task Review with Agent Invocation",
              "Invocation is not linked to the Task Review",
            );
          if (input.complete) {
            const completed = yield* completeReview(
              sql,
              input.reviewId,
              input.findings,
              input.toolingFailure,
              undefined,
              input.now,
              true,
            );
            if (!completed.ok)
              return yield* invalid(
                "settle Task Review with Agent Invocation",
                `Task Review did not complete: ${completed.code}`,
              );
          } else {
            const failure = input.toolingFailure;
            if (failure === undefined)
              return yield* invalid(
                "settle Task Review with Agent Invocation",
                "Active Agent Task Review settlement requires a Tooling Failure",
              );
            yield* sql`
              UPDATE task_reviews
              SET tooling_failure = ${JSON.stringify(failure)}, updated_at = ${input.now}
              WHERE id = ${input.reviewId} AND state = 'running'
            `;
          }
        }).pipe(Effect.asVoid),
    recordActiveFailure: (reviewId, failure, now) =>
      repository.transactionImmediate("record active Task Review failure", (sql) =>
        Effect.asVoid(sql`
          UPDATE task_reviews SET tooling_failure = ${JSON.stringify(failure)}, updated_at = ${now}
          WHERE id = ${reviewId} AND state = 'running'
        `),
      ),
    getLatestForTask: (taskId) =>
      repository.transaction("read current Task Review", (sql) =>
        Effect.gen(function* () {
          const rows = yield* sql<ReviewRow>`
            SELECT id, task_id AS taskId, proposal_snapshot AS proposalSnapshot,
              dependency_evidence AS dependencyEvidence, policy_snapshot AS policySnapshot,
              base_ref AS baseRef, base_commit AS baseCommit, workspace_path AS workspacePath,
              state, outcome, workspace_cleanup AS workspaceCleanup,
              tooling_failure AS toolingFailure, abandon_reason AS abandonReason,
              created_at AS createdAt, updated_at AS updatedAt
            FROM task_reviews WHERE task_id = ${taskId}
            ORDER BY sequence DESC LIMIT 1
          `;
          const row = rows[0];
          return row === undefined ? undefined : yield* decodeReview(sql, row);
        }),
      ),
    proposalIsCurrent: (review) =>
      repository.transaction("compare Task Review proposal", (sql) =>
        currentProposalMatches(sql, review),
      ),
  }));

const taskReviewAdmissionRejection = (sql: SqlClient.SqlClient, taskId: string) =>
  Effect.gen(function* () {
    const tasks = yield* sql<{ readonly state: string }>`
      SELECT state FROM tasks WHERE id = ${taskId}
    `;
    const task = tasks[0];
    if (task === undefined) return { ok: false as const, code: "task_not_found" as const };
    if (task.state !== "new") {
      return { ok: false as const, code: "invalid_task_state" as const, state: task.state };
    }
    const linkedChanges = yield* sql<{ readonly id: string }>`
      SELECT id FROM changes WHERE task_id = ${taskId} LIMIT 1
    `;
    const linkedChange = linkedChanges[0];
    if (linkedChange !== undefined) {
      return {
        ok: false as const,
        code: "task_change_linked" as const,
        changeId: linkedChange.id,
      };
    }
    const active = yield* sql<{ readonly id: string }>`
      SELECT id FROM task_reviews WHERE task_id = ${taskId} AND state = 'running' LIMIT 1
    `;
    const activeReview = active[0];
    return activeReview === undefined
      ? undefined
      : {
          ok: false as const,
          code: "active_task_review" as const,
          reviewId: activeReview.id,
        };
  });

const reuseTaskReviewJudgment = (sql: SqlClient.SqlClient, taskId: string, now: string) =>
  Effect.gen(function* () {
    const tasks = yield* sql<{
      readonly title: string;
      readonly description: string;
      readonly state: string;
    }>`SELECT title, description, state FROM tasks WHERE id = ${taskId}`;
    const task = tasks[0];
    if (task === undefined || task.state !== "new") return undefined;

    const active = yield* sql<{ readonly id: string }>`
      SELECT id FROM task_reviews WHERE task_id = ${taskId} AND state = 'running' LIMIT 1
    `;
    if (active[0] !== undefined) return undefined;

    const dependencyIds = yield* directDependencyIds(sql, taskId);
    const currentProposal: TaskReviewProposal = {
      title: task.title,
      description: task.description,
      dependencyIds,
    };
    const rows = yield* sql<ReviewRow>`
      SELECT id, task_id AS taskId, proposal_snapshot AS proposalSnapshot,
        dependency_evidence AS dependencyEvidence, policy_snapshot AS policySnapshot,
        base_ref AS baseRef, base_commit AS baseCommit, workspace_path AS workspacePath,
        state, outcome, workspace_cleanup AS workspaceCleanup,
        tooling_failure AS toolingFailure, abandon_reason AS abandonReason,
        created_at AS createdAt, updated_at AS updatedAt
      FROM task_reviews
      WHERE task_id = ${taskId} AND state = 'complete'
      ORDER BY sequence DESC
    `;
    for (const row of rows) {
      const proposal = yield* decodeProposalSnapshot(row.proposalSnapshot);
      if (JSON.stringify(proposal) !== JSON.stringify(currentProposal)) continue;
      if (row.outcome !== "passed") return undefined;
      const review = yield* decodeReview(sql, row);
      const judgment = completedTaskReviewResult(review, "new");
      if (judgment === undefined || judgment.outcome !== "passed") {
        return yield* invalid("reuse Task Review judgment", "Judgment facts are inconsistent");
      }
      yield* sql`
        UPDATE tasks SET state = 'todo', updated_at = ${now}
        WHERE id = ${taskId} AND state = 'new'
      `;
      return judgment;
    }
    return undefined;
  });

const decodeAgentInvocation = (row: AgentInvocationRow): AgentInvocationRecord => {
  const kinds = ["returned", "launch_failed", "failed", "return_unknown"] as const;
  if (
    row.settlementKind !== null &&
    !kinds.includes(row.settlementKind as (typeof kinds)[number])
  ) {
    throw new Error(`Invalid Agent Invocation settlement kind: ${row.settlementKind}`);
  }
  const tokenValues = [row.inputTokens, row.cachedInputTokens, row.outputTokens, row.totalTokens];
  const hasTokens = tokenValues.some((value) => value !== null);
  if (
    hasTokens &&
    tokenValues.some((value) => value === null || !Number.isSafeInteger(value) || value < 0)
  ) {
    throw new Error("Incomplete Agent Invocation token evidence");
  }
  return {
    id: row.id,
    continuationId: row.continuationId,
    createdAt: row.createdAt,
    settledAt: row.settledAt,
    settlementKind: row.settlementKind as AgentInvocationRecord["settlementKind"],
    usage: hasTokens
      ? {
          inputTokens: row.inputTokens as number,
          cachedInputTokens: row.cachedInputTokens as number,
          outputTokens: row.outputTokens as number,
          totalTokens: row.totalTokens as number,
        }
      : null,
    continuation: {
      id: row.continuationId,
      agentSessionId: row.agentSessionId,
      harness: decodeAgentHarness(row.harness),
      provider: row.provider,
      model: row.model,
      thinking: row.thinking === null ? null : decodeAgentThinking(row.thinking),
      transcriptPath: row.transcriptPath,
      unusableReason: row.unusableReason,
    },
  };
};

const decodeAgentHarness = (value: string): "pi" => {
  if (value !== "pi") throw new Error(`Invalid Agent Harness: ${value}`);
  return "pi";
};

const decodeAgentThinking = (value: string) => {
  if (!["off", "minimal", "low", "medium", "high", "xhigh"].includes(value))
    throw new Error(`Invalid Agent thinking level: ${value}`);
  return value as "off" | "minimal" | "low" | "medium" | "high" | "xhigh";
};

const decodeProposalSnapshot = (source: string) =>
  Effect.try({
    try: () => parseProposal(source),
    catch: (cause) =>
      new RepositoryPersistedDataInvalid({ operationName: "read Task Review", cause }),
  });

const readReviewRows = (sql: SqlClient.SqlClient, taskId: string) => sql<ReviewRow>`
  SELECT id, task_id AS taskId, proposal_snapshot AS proposalSnapshot,
    dependency_evidence AS dependencyEvidence, policy_snapshot AS policySnapshot,
    base_ref AS baseRef, base_commit AS baseCommit, workspace_path AS workspacePath,
    state, outcome, workspace_cleanup AS workspaceCleanup,
    tooling_failure AS toolingFailure, abandon_reason AS abandonReason,
    created_at AS createdAt, updated_at AS updatedAt
  FROM task_reviews WHERE task_id = ${taskId} ORDER BY sequence ASC
`;

const directDependencyIds = (sql: SqlClient.SqlClient, taskId: string) =>
  Effect.map(
    sql<{ readonly id: string }>`
      SELECT prerequisite_task_id AS id FROM task_dependencies
      WHERE dependent_task_id = ${taskId} ORDER BY prerequisite_task_id ASC
    `,
    (dependencies) => dependencies.map((dependency) => dependency.id),
  );

const dependencyEvidence = (sql: SqlClient.SqlClient, taskId: string) =>
  sql<TaskReviewDependencyEvidence>`
    SELECT prerequisite.id, prerequisite.title, prerequisite.description, prerequisite.state
    FROM task_dependencies
    JOIN tasks prerequisite ON prerequisite.id = task_dependencies.prerequisite_task_id
    WHERE task_dependencies.dependent_task_id = ${taskId}
    ORDER BY prerequisite.id ASC
  `;

const completeReview = (
  sql: SqlClient.SqlClient,
  reviewId: string,
  findings: readonly TaskReviewFinding[],
  toolingFailure: TaskReviewToolingFailure | undefined,
  abandonReason: string | undefined,
  now: string,
  allowAlreadyComplete = false,
) =>
  Effect.gen(function* () {
    const current = yield* getReview(sql, reviewId);
    if (current === undefined) {
      return { ok: false as const, code: "task_review_not_found" as const };
    }
    if (current.state === "complete") {
      if (
        abandonReason !== undefined ||
        (!allowAlreadyComplete && current.outcome !== "tooling_failed")
      ) {
        return { ok: false as const, code: "task_review_not_active" as const };
      }
      const taskState = yield* readTaskState(sql, current.taskId);
      const completed = completedTaskReviewResult(current, taskState);
      if (completed === undefined)
        return yield* invalid("complete Task Review", "Completion facts are inconsistent");
      return completed;
    }
    if (current.workspaceCleanup !== "removed") {
      return { ok: false as const, code: "task_review_not_active" as const };
    }
    const admission = yield* inspectCurrentAdmission(sql, current);
    const failure = admission.ok ? toolingFailure : admission.failure;
    const outcome =
      failure !== undefined ? "tooling_failed" : findings.length > 0 ? "blocked" : "passed";
    if (outcome === "passed") {
      yield* sql`
        UPDATE tasks SET state = 'todo', updated_at = ${now}
        WHERE id = ${current.taskId} AND state = 'new'
      `;
    }
    yield* Effect.forEach(
      findings,
      (finding) => sql`
        INSERT INTO task_review_findings (review_id, title, description, evidence, files, created_at)
        VALUES (${reviewId}, ${finding.title}, ${finding.description}, ${finding.evidence}, ${JSON.stringify(finding.files)}, ${now})
      `,
      { discard: true },
    );
    yield* sql`
      UPDATE task_reviews
      SET state = 'complete', outcome = ${outcome},
        tooling_failure = ${failure === undefined ? null : JSON.stringify(failure)},
        abandon_reason = ${abandonReason ?? null}, updated_at = ${now}
      WHERE id = ${reviewId}
    `;
    const completed = yield* getReview(sql, reviewId);
    if (completed === undefined)
      return yield* invalid("complete Task Review", "Review disappeared");
    const taskState = yield* readTaskState(sql, current.taskId);
    const result = completedTaskReviewResult(completed, taskState);
    if (result === undefined)
      return yield* invalid("complete Task Review", "Completion facts are inconsistent");
    return result;
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
        outcome: review.outcome,
        review: {
          ...review,
          state: "complete",
          outcome: review.outcome,
          findings: [],
          toolingFailure: null,
        },
        task: { id: review.taskId, state: "todo" },
      };
    case "blocked": {
      const firstFinding = review.findings[0];
      if (firstFinding === undefined || review.toolingFailure !== null) return undefined;
      if (taskState !== "new") return undefined;
      return {
        ok: true,
        outcome: review.outcome,
        review: {
          ...review,
          state: "complete",
          outcome: review.outcome,
          findings: [firstFinding, ...review.findings.slice(1)],
          toolingFailure: null,
        },
        task: { id: review.taskId, state: "new" },
      };
    }
    case "tooling_failed":
      if (review.toolingFailure === null) return undefined;
      return {
        ok: true,
        outcome: review.outcome,
        review: {
          ...review,
          state: "complete",
          outcome: review.outcome,
          toolingFailure: review.toolingFailure,
        },
        task: { id: review.taskId, state: taskState },
      };
    case null:
      return undefined;
  }
};

const readTaskState = (sql: SqlClient.SqlClient, taskId: string) =>
  Effect.gen(function* () {
    const rows = yield* sql<{ readonly state: TaskState }>`
      SELECT state FROM tasks WHERE id = ${taskId}
    `;
    const row = rows[0];
    return row === undefined
      ? yield* invalid("complete Task Review", "Task disappeared")
      : row.state;
  });

const inspectCurrentAdmission = (sql: SqlClient.SqlClient, review: TaskReviewRecord) =>
  Effect.gen(function* () {
    const rows = yield* sql<{
      readonly title: string;
      readonly description: string;
      readonly state: TaskState;
    }>`
      SELECT title, description, state FROM tasks WHERE id = ${review.taskId}
    `;
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
    const dependencies = yield* dependencyEvidence(sql, review.taskId);
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

const currentProposalMatches = (sql: SqlClient.SqlClient, review: TaskReviewRecord) =>
  Effect.gen(function* () {
    const rows = yield* sql<{ readonly title: string; readonly description: string }>`
      SELECT title, description FROM tasks WHERE id = ${review.taskId}
    `;
    const task = rows[0];
    if (task === undefined) return false;
    const dependencies = yield* dependencyEvidence(sql, review.taskId);
    return (
      task.title === review.proposal.title &&
      task.description === review.proposal.description &&
      JSON.stringify(dependencies.map((dependency) => dependency.id)) ===
        JSON.stringify(review.proposal.dependencyIds)
    );
  });

const getReview = (sql: SqlClient.SqlClient, reviewId: string) =>
  Effect.gen(function* () {
    const rows = yield* sql<ReviewRow>`
      SELECT id, task_id AS taskId, proposal_snapshot AS proposalSnapshot,
        dependency_evidence AS dependencyEvidence, policy_snapshot AS policySnapshot,
        base_ref AS baseRef, base_commit AS baseCommit, workspace_path AS workspacePath,
        state, outcome, workspace_cleanup AS workspaceCleanup,
        tooling_failure AS toolingFailure, abandon_reason AS abandonReason,
        created_at AS createdAt, updated_at AS updatedAt
      FROM task_reviews WHERE id = ${reviewId}
    `;
    const row = rows[0];
    return row === undefined ? undefined : yield* decodeReview(sql, row);
  });

const decodeReview = (sql: SqlClient.SqlClient, row: ReviewRow) =>
  Effect.gen(function* () {
    const findings = yield* sql<FindingRow>`
      SELECT title, description, evidence, files FROM task_review_findings
      WHERE review_id = ${row.id} ORDER BY sequence ASC
    `;
    const executions = yield* sql<ExecutionRow>`
      SELECT continuity, identity_fingerprint AS identityFingerprint,
        restart_reason AS restartReason, duration_ms AS durationMs,
        review_calls AS reviewCalls, invocation_usage AS invocationUsage,
        session_reference AS sessionReference
      FROM task_review_executions WHERE review_id = ${row.id}
    `;
    const agentSession = yield* sql<{
      readonly agentSessionId: number | null;
      readonly configuration: string | null;
    }>`
      SELECT reviewer_agent_session_id AS agentSessionId,
        reviewer_configuration AS configuration
      FROM tasks WHERE id = ${row.taskId}
    `;
    const agentSessionId = agentSession[0]?.agentSessionId ?? undefined;
    const reviewerConfiguration =
      agentSession[0]?.configuration === undefined || agentSession[0].configuration === null
        ? undefined
        : yield* decodeReviewerConfiguration(agentSession[0].configuration);
    const agentInvocations = yield* sql<AgentInvocationRow>`
      SELECT invocation.id, continuation.agent_session_id AS agentSessionId,
        invocation.continuation_id AS continuationId,
        invocation.created_at AS createdAt, invocation.settled_at AS settledAt,
        invocation.settlement_kind AS settlementKind,
        invocation.input_tokens AS inputTokens,
        invocation.cached_input_tokens AS cachedInputTokens,
        invocation.output_tokens AS outputTokens,
        invocation.total_tokens AS totalTokens,
        continuation.harness,
        continuation.provider,
        continuation.model,
        continuation.thinking,
        continuation.transcript_path AS transcriptPath,
        continuation.unusable_reason AS unusableReason
      FROM task_review_agent_invocations link
      JOIN agent_invocations invocation ON invocation.id = link.agent_invocation_id
      JOIN agent_continuations continuation ON continuation.id = invocation.continuation_id
      WHERE link.review_id = ${row.id}
      ORDER BY invocation.id ASC
    `;
    const transcripts = yield* sql<TranscriptRow>`
      SELECT transcript.producer, transcript.pi_session_id AS piSessionId,
        transcript.file_path AS filePath
      FROM task_review_transcript_observations observation
      JOIN task_reviewer_transcripts transcript
        ON transcript.sequence = observation.transcript_sequence
      WHERE observation.review_id = ${row.id}
      ORDER BY transcript.sequence ASC
    `;
    return yield* Effect.try({
      try: (): TaskReviewRecord => ({
        id: row.id,
        taskId: row.taskId,
        proposal: parseProposal(row.proposalSnapshot),
        dependencyEvidence: parseDependencies(row.dependencyEvidence),
        policy: parsePolicy(row.policySnapshot),
        baseRef: row.baseRef,
        baseCommit: row.baseCommit,
        workspacePath: row.workspacePath,
        state: parseReviewState(row.state),
        outcome: parseReviewOutcome(row.outcome),
        workspaceCleanup: parseWorkspaceCleanup(row.workspaceCleanup),
        toolingFailure: row.toolingFailure === null ? null : parseFailure(row.toolingFailure),
        abandonReason: row.abandonReason,
        findings: findings.map((finding) => ({
          title: finding.title,
          description: finding.description,
          evidence: finding.evidence,
          files: parseStringArray(finding.files),
        })),
        sessions: executions.map(({ restartReason, ...execution }) => ({
          ...execution,
          ...(restartReason === null ? {} : { restartReason }),
          invocationUsage: parseInvocationUsage(execution.invocationUsage),
        })),
        transcripts,
        ...(agentSessionId === undefined && agentInvocations.length === 0
          ? {}
          : {
              ...(agentSessionId === undefined ? {} : { agentSessionId }),
              agentInvocations: agentInvocations.map(decodeAgentInvocation),
              ...(reviewerConfiguration === undefined ? {} : { reviewerConfiguration }),
            }),
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      }),
      catch: (cause) =>
        new RepositoryPersistedDataInvalid({ operationName: "read Task Review", cause }),
    });
  });

type TaskReviewJsonObject = Record<string, unknown> & {
  readonly id?: unknown;
  readonly version?: unknown;
  readonly title?: unknown;
  readonly description?: unknown;
  readonly dependencyIds?: unknown;
  readonly state?: unknown;
  readonly profileScope?: unknown;
  readonly agentProfile?: unknown;
  readonly instructions?: unknown;
  readonly profile?: unknown;
  readonly scope?: unknown;
  readonly builtInInstructions?: unknown;
  readonly guidance?: unknown;
  readonly content?: unknown;
  readonly source?: unknown;
  readonly operation?: unknown;
  readonly message?: unknown;
  readonly pendingExecution?: unknown;
  readonly continuity?: unknown;
  readonly identityFingerprint?: unknown;
  readonly restartReason?: unknown;
  readonly durationMs?: unknown;
  readonly reviewCalls?: unknown;
  readonly invocationUsage?: unknown;
  readonly sessionReference?: unknown;
};

const parseObject = (source: string): TaskReviewJsonObject => {
  const value: unknown = JSON.parse(source) as unknown;
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new Error("Expected object");
  return value as TaskReviewJsonObject;
};
const requiredString = (value: unknown): string => {
  if (typeof value !== "string") throw new Error("Expected string");
  return value;
};
const parseInvocationUsage = (source: string): readonly (TokenUsage | null)[] => {
  const value: unknown = JSON.parse(source) as unknown;
  if (!Array.isArray(value)) throw new Error("Expected invocation usage array");
  return value.map((entry) => {
    if (entry === null) return null;
    if (typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error("Expected invocation usage object");
    }
    const {
      inputTokens: inputTokenValue,
      cachedInputTokens: cachedInputTokenValue,
      outputTokens: outputTokenValue,
      totalTokens: totalTokenValue,
    } = entry as Record<string, unknown>;
    const inputTokens = requiredTokenCount(inputTokenValue);
    const cachedInputTokens = requiredTokenCount(cachedInputTokenValue);
    const outputTokens = requiredTokenCount(outputTokenValue);
    const totalTokens = requiredTokenCount(totalTokenValue);
    return { inputTokens, cachedInputTokens, outputTokens, totalTokens };
  });
};
const requiredTokenCount = (value: unknown): number => {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error("Expected non-negative integer token count");
  }
  return value;
};
const parseStringArray = (source: string): readonly string[] => {
  const value: unknown = JSON.parse(source) as unknown;
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === "string"))
    throw new Error("Expected string array");
  return value;
};
const parseProposal = (source: string): TaskReviewProposal => {
  const value = parseObject(source);
  return {
    title: requiredString(value.title),
    description: requiredString(value.description),
    dependencyIds: parseStringArray(JSON.stringify(value.dependencyIds)),
  };
};
const parseDependencies = (source: string): readonly TaskReviewDependencyEvidence[] => {
  const value: unknown = JSON.parse(source) as unknown;
  if (!Array.isArray(value)) throw new Error("Expected dependencies");
  return value.map((entry) => {
    const item = parseObject(JSON.stringify(entry));
    return {
      id: requiredString(item.id),
      title: requiredString(item.title),
      description: requiredString(item.description),
      state: requiredString(item.state),
    };
  });
};
const decodeReviewerConfiguration = (source: string) =>
  Effect.try({
    try: () => parsePolicy(source),
    catch: (cause) =>
      new RepositoryPersistedDataInvalid({
        operationName: "read Task Reviewer configuration",
        cause,
      }),
  });

const parsePolicy = (source: string): TaskReviewPolicySnapshot => {
  const value = parseObject(source);
  const profile = parseObject(JSON.stringify(value.profile));
  const scope = profile.scope;
  if (scope !== "repo" && scope !== "global") throw new Error("Invalid profile scope");
  return {
    profile: {
      agentProfile: requiredString(profile.agentProfile),
      scope,
      profile:
        profile.profile === null
          ? null
          : Schema.decodeUnknownSync(agentProfileSchema, { onExcessProperty: "error" })(
              profile.profile,
            ),
    },
    builtInInstructions: requiredString(value.builtInInstructions),
    guidance: value.guidance === null ? null : parseGuidance(value.guidance),
  };
};
const parseGuidance = (value: unknown): NonNullable<TaskReviewPolicySnapshot["guidance"]> => {
  const parsed = parseObject(JSON.stringify(value));
  if (parsed.source !== "repo" && parsed.source !== "global") {
    throw new Error("Invalid guidance source");
  }
  return {
    content: requiredString(parsed.content),
    source: parsed.source,
  };
};
const parseReviewState = (value: string): TaskReviewRecord["state"] => {
  if (value !== "running" && value !== "complete") throw new Error("Invalid Task Review state");
  return value;
};
const parseReviewOutcome = (value: string | null): TaskReviewRecord["outcome"] => {
  if (value === null || value === "passed" || value === "blocked" || value === "tooling_failed") {
    return value;
  }
  throw new Error("Invalid Task Review outcome");
};
const parseWorkspaceCleanup = (value: string): TaskReviewRecord["workspaceCleanup"] => {
  if (value === "not_created" || value === "removed" || value === "failed") return value;
  throw new Error("Invalid Task Review workspace cleanup");
};
const parseFailure = (
  source: string,
): TaskReviewToolingFailure | LegacyTaskReviewToolingFailure => {
  const value = parseObject(source);
  const failure = {
    operation: requiredString(value.operation),
    message: requiredString(value.message),
  };
  return value.pendingExecution === undefined
    ? failure
    : { ...failure, pendingExecution: parseExecution(value.pendingExecution) };
};
const parseExecution = (source: unknown): TaskReviewExecution => {
  const value = parseObject(JSON.stringify(source));
  if (
    value.continuity !== "fresh" &&
    value.continuity !== "resumed" &&
    value.continuity !== "restarted"
  ) {
    throw new Error("Invalid Task Review execution continuity");
  }
  if (value.restartReason !== undefined && typeof value.restartReason !== "string") {
    throw new Error("Invalid Task Review execution restart reason");
  }
  if (value.sessionReference !== null && typeof value.sessionReference !== "string") {
    throw new Error("Invalid Task Review execution session reference");
  }
  return {
    continuity: value.continuity,
    identityFingerprint: requiredString(value.identityFingerprint),
    ...(value.restartReason === undefined ? {} : { restartReason: value.restartReason }),
    durationMs: requiredTokenCount(value.durationMs),
    reviewCalls: requiredTokenCount(value.reviewCalls),
    invocationUsage: parseInvocationUsage(JSON.stringify(value.invocationUsage)),
    sessionReference: value.sessionReference,
  };
};
const invalid = (operationName: string, message: string) =>
  Effect.fail(new RepositoryPersistedDataInvalid({ operationName, cause: new Error(message) }));
