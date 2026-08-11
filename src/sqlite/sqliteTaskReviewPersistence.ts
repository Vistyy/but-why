import type * as SqlClient from "@effect/sql/SqlClient";
import { Effect, Schema } from "effect";
import type { TokenUsage } from "../agent/tokenUsage.js";
import { agentProfileSchema } from "../contracts/agentConfig.js";
import { RepositoryPersistedDataInvalid } from "../contracts/repositoryStorageError.js";
import type {
  TaskReviewDependencyEvidence,
  TaskReviewExecution,
  TaskReviewFinding,
  TaskReviewPolicySnapshot,
  TaskReviewProposal,
  TaskReviewRecord,
  TaskReviewToolingFailure,
} from "../task/review/taskReview.js";
import type { TaskReviewPersistence } from "../task/review/taskReviewPersistence.js";
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
    listForTask: (taskId) =>
      repository.transaction("list Task Reviews", (sql) =>
        Effect.gen(function* () {
          const rows = yield* readReviewRows(sql, taskId);
          return yield* Effect.forEach(rows, (row) => decodeReview(sql, row));
        }),
      ),
    getReviewerSession: (taskId, producer) =>
      repository.transaction("read Task Reviewer Session", (sql) =>
        Effect.map(
          sql<{ readonly fingerprint: string; readonly sessionReference: string }>`
            SELECT fingerprint, session_reference AS sessionReference
            FROM task_reviewer_sessions WHERE task_id = ${taskId}
          `,
          (rows) => {
            const row = rows[0];
            return row === undefined ? undefined : { ownerId: taskId, producer, ...row };
          },
        ),
      ),
    saveReviewerSession: (session) =>
      repository.transactionImmediate("save Task Reviewer Session", (sql) =>
        Effect.asVoid(sql`
          INSERT INTO task_reviewer_sessions (task_id, fingerprint, session_reference)
          VALUES (${session.ownerId}, ${session.fingerprint}, ${session.sessionReference})
          ON CONFLICT(task_id) DO UPDATE SET fingerprint = excluded.fingerprint,
            session_reference = excluded.session_reference
        `),
      ),
    removeReviewerSession: (taskId) =>
      repository.transactionImmediate("remove Task Reviewer Session", (sql) =>
        Effect.asVoid(sql`DELETE FROM task_reviewer_sessions WHERE task_id = ${taskId}`),
      ),
    recordExecutionAndTranscripts: (input) =>
      repository.transactionImmediate("record Task Review execution", (sql) =>
        Effect.gen(function* () {
          if (input.execution !== undefined) {
            yield* sql`
              INSERT INTO task_review_executions (
                review_id, continuity, identity_fingerprint, restart_reason, duration_ms,
                review_calls, invocation_usage, session_reference
              ) VALUES (
                ${input.reviewId}, ${input.execution.continuity},
                ${input.execution.identityFingerprint}, ${input.execution.restartReason ?? null},
                ${input.execution.durationMs}, ${input.execution.reviewCalls},
                ${JSON.stringify(input.execution.invocationUsage)},
                ${input.execution.sessionReference}
              )
            `;
          }
          for (const transcript of input.transcripts) {
            yield* sql`
              INSERT INTO task_reviewer_transcripts (
                task_id, producer, pi_session_id, file_path
              ) VALUES (
                ${input.taskId}, ${transcript.producer}, ${transcript.piSessionId},
                ${transcript.filePath}
              ) ON CONFLICT(task_id, producer, file_path) DO NOTHING
            `;
            yield* sql`
              INSERT INTO task_review_transcript_observations (review_id, transcript_sequence)
              SELECT ${input.reviewId}, sequence FROM task_reviewer_transcripts
              WHERE task_id = ${input.taskId} AND producer = ${transcript.producer}
                AND file_path = ${transcript.filePath}
              ON CONFLICT(review_id, transcript_sequence) DO NOTHING
            `;
          }
        }),
      ),
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

const readReviewRows = (sql: SqlClient.SqlClient, taskId: string) => sql<ReviewRow>`
  SELECT id, task_id AS taskId, proposal_snapshot AS proposalSnapshot,
    dependency_evidence AS dependencyEvidence, policy_snapshot AS policySnapshot,
    base_ref AS baseRef, base_commit AS baseCommit, workspace_path AS workspacePath,
    state, outcome, workspace_cleanup AS workspaceCleanup,
    tooling_failure AS toolingFailure, abandon_reason AS abandonReason,
    created_at AS createdAt, updated_at AS updatedAt
  FROM task_reviews WHERE task_id = ${taskId} ORDER BY sequence ASC
`;

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
    if (current.state !== "running" || current.workspaceCleanup !== "removed") {
      return { ok: false as const, code: "task_review_not_active" as const };
    }
    const proposalStillCurrent = yield* currentProposalMatches(sql, current);
    const failure =
      toolingFailure ??
      (proposalStillCurrent
        ? undefined
        : {
            operation: "confirm_task_review_proposal",
            message: "Task title, description, or direct Task Dependencies changed during review.",
          });
    const outcome =
      failure !== undefined ? "tooling_failed" : findings.length > 0 ? "blocked" : "passed";
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
    return { ok: true as const, review: completed };
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
          artifactRefs: [],
        })),
        sessions: executions.map(({ restartReason, ...execution }) => ({
          ...execution,
          ...(restartReason === null ? {} : { restartReason }),
          invocationUsage: parseInvocationUsage(execution.invocationUsage),
        })),
        transcripts,
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
const parsePolicy = (source: string): TaskReviewPolicySnapshot => {
  const value = parseObject(source);
  if (value.id !== "task_advisory_review") throw new Error("Invalid policy");
  if (value.version === 1) {
    if (value.profileScope !== "global") throw new Error("Invalid legacy policy");
    return {
      id: "task_advisory_review",
      version: 1,
      agentProfile: requiredString(value.agentProfile),
      profileScope: "global",
      instructions: requiredString(value.instructions),
    };
  }
  if (value.version !== 2) throw new Error("Invalid policy version");
  const profile = parseObject(JSON.stringify(value.profile));
  const scope = profile.scope;
  if (scope !== "repo" && scope !== "global") throw new Error("Invalid profile scope");
  const guidance = value.guidance === null ? null : parseGuidance(value.guidance);
  return {
    id: "task_advisory_review",
    version: 2,
    profile: {
      agentProfile: requiredString(profile.agentProfile),
      scope,
      profile: Schema.decodeUnknownSync(agentProfileSchema, { onExcessProperty: "error" })(
        profile.profile,
      ),
    },
    builtInInstructions: requiredString(value.builtInInstructions),
    guidance,
  };
};
const parseGuidance = (
  value: unknown,
): NonNullable<Extract<TaskReviewPolicySnapshot, { readonly version: 2 }>["guidance"]> => {
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
