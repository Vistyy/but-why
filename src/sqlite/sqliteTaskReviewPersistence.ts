import type * as SqlClient from "@effect/sql/SqlClient";
import { Effect, Schema } from "effect";
import { agentProfileSchema } from "../contracts/agentConfig.js";
import { RepositoryPersistedDataInvalid } from "../contracts/repositoryStorageError.js";
import type { TaskState } from "../task/lifecycle.js";
import type {
  TaskReviewDependencyEvidence,
  TaskReviewFinding,
  TaskReviewPolicySnapshot,
  TaskReviewProposal,
  TaskReviewRecord,
  TaskReviewToolingFailure,
} from "../task/review/taskReview.js";
import type {
  CompleteTaskReviewSuccess,
  TaskReviewPersistence,
} from "../task/review/taskReviewPersistence.js";
import { RepositorySql } from "./repositorySql.js";

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

type FindingRow = Omit<TaskReviewFinding, "artifactRefs" | "files"> & {
  readonly files: string;
};

export const openSqliteTaskReviewPersistence = (): Effect.Effect<
  TaskReviewPersistence,
  never,
  RepositorySql
> =>
  Effect.map(RepositorySql, (repository) => ({
    admit: (input) =>
      repository.transactionImmediate("admit Task Review", (sql) =>
        Effect.gen(function* () {
          const tasks = yield* sql<{
            readonly title: string;
            readonly description: string;
            readonly state: string;
          }>`SELECT title, description, state FROM tasks WHERE id = ${input.taskId}`;
          const task = tasks[0];
          if (task === undefined) return { ok: false as const, code: "task_not_found" as const };
          if (task.state !== "new") {
            return { ok: false as const, code: "invalid_task_state" as const, state: task.state };
          }
          const active = yield* sql<{ readonly id: string }>`
            SELECT id FROM task_reviews WHERE task_id = ${input.taskId} AND state = 'running'
          `;
          if (active[0] !== undefined) {
            return {
              ok: false as const,
              code: "active_task_review" as const,
              reviewId: active[0].id,
            };
          }
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
        ),
      ),
    abandon: (reviewId, reason, now) =>
      repository.transactionImmediate("abandon Task Review", (sql) =>
        completeReview(
          sql,
          reviewId,
          [],
          { operation: "task_review_abandoned", message: reason },
          reason,
          now,
        ),
      ),
    getById: (reviewId) =>
      repository.transaction("read Task Review", (sql) => getReview(sql, reviewId)),
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
) =>
  Effect.gen(function* () {
    const current = yield* getReview(sql, reviewId);
    if (current === undefined) {
      return { ok: false as const, code: "task_review_not_found" as const };
    }
    if (current.state === "complete") {
      if (abandonReason !== undefined || current.outcome !== "tooling_failed") {
        return { ok: false as const, code: "task_review_not_active" as const };
      }
      const completed = completedTaskReviewResult(current);
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
    const result = completedTaskReviewResult(completed);
    if (result === undefined)
      return yield* invalid("complete Task Review", "Completion facts are inconsistent");
    return result;
  });

const completedTaskReviewResult = (
  review: TaskReviewRecord,
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
      };
    case null:
      return undefined;
  }
};

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
          artifactRefs: [],
        })),
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
const parsePolicy = (source: string): TaskReviewPolicySnapshot => {
  const value = parseObject(source);
  if (value.id === "task_advisory_review" && value.version === 1) {
    if (value.profileScope !== "global") throw new Error("Invalid legacy policy");
    return {
      id: "task_advisory_review",
      version: 1,
      agentProfile: requiredString(value.agentProfile),
      profileScope: "global",
      instructions: requiredString(value.instructions),
    };
  }
  const legacy = value.id === "task_advisory_review" && value.version === 2;
  const current = value.id === "task_review" && value.version === 3;
  if (!legacy && !current) throw new Error("Invalid policy");
  const profile = parseObject(JSON.stringify(value.profile));
  const scope = profile.scope;
  if (scope !== "repo" && scope !== "global") throw new Error("Invalid profile scope");
  const guidance = value.guidance === null ? null : parseGuidance(value.guidance);
  const body = {
    profile: {
      agentProfile: requiredString(profile.agentProfile),
      scope,
      profile: Schema.decodeUnknownSync(agentProfileSchema, { onExcessProperty: "error" })(
        profile.profile,
      ),
    },
    builtInInstructions: requiredString(value.builtInInstructions),
    guidance,
  } as const;
  return legacy
    ? { id: "task_advisory_review", version: 2, ...body }
    : { id: "task_review", version: 3, ...body };
};
const parseGuidance = (
  value: unknown,
): NonNullable<Extract<TaskReviewPolicySnapshot, { readonly version: 2 | 3 }>["guidance"]> => {
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
const parseFailure = (source: string): TaskReviewToolingFailure => {
  const value = parseObject(source);
  return {
    operation: requiredString(value.operation),
    message: requiredString(value.message),
  };
};
const invalid = (operationName: string, message: string) =>
  Effect.fail(new RepositoryPersistedDataInvalid({ operationName, cause: new Error(message) }));
