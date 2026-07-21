import type * as SqlClient from "@effect/sql/SqlClient";
import type { SqlError } from "@effect/sql/SqlError";
import { Effect } from "effect";
import { randomUUID } from "node:crypto";

import { canTransition, type TaskState } from "../task/lifecycle.js";
import type { TaskPersistence } from "../task/taskPersistence.js";
import type {
  DependencyValidationCode,
  TaskContext,
  TaskDependencyFact,
  TaskSummary,
} from "../task/task.js";
import { generatedPublicTaskId, type PublicTaskId } from "../task/taskId.js";
import type {
  AppendTaskCommentInput,
  ApproveTaskInput,
  CreateTaskInput,
  ListTasksInput,
  ReplaceTaskDependenciesInput,
  StoredTaskRecord,
  TaskStateTransitionResult,
  TransitionTaskStateInput,
  UpdateTaskContextInput,
} from "../task/taskStore.js";
import { RepositoryPersistedDataInvalid } from "../repositoryStorageError.js";
import { RepositorySql } from "./repositorySql.js";

export const openSqliteTaskPersistence = (
  taskPrefix: string,
): Effect.Effect<TaskPersistence, never, RepositorySql> =>
  Effect.map(RepositorySql, (repository) => ({
    createTask: (input) =>
      repository.transactionImmediate("create Task", (sql) => createTask(sql, taskPrefix, input)),
    replaceTaskDependencies: (input) =>
      repository.transactionImmediate("replace Task dependencies", (sql) =>
        replaceTaskDependencies(sql, input),
      ),
    listTasks: (input) => repository.operation("list Tasks", (sql) => listTasks(sql, input)),
    listActionableTasks: () => repository.operation("list actionable Tasks", listActionableTasks),
    getTaskById: (taskId) => repository.operation("read Task", (sql) => getTaskById(sql, taskId)),
    getTaskContextById: (taskId) =>
      repository.transaction("read Task Context", (sql) => getTaskContextById(sql, taskId)),
    approveTask: (input) =>
      repository.transactionImmediate("approve Task", (sql) => approveTask(sql, input)),
    appendTaskComment: (input) =>
      repository.transactionImmediate("append Task comment", (sql) =>
        appendTaskComment(sql, input),
      ),
    updateTaskContext: (input) =>
      repository.transactionImmediate("update Task Context", (sql) =>
        updateTaskContext(sql, input),
      ),
    transitionTaskState: (input) =>
      repository.transactionImmediate("transition Task state", (sql) =>
        transitionTaskState(sql, input),
      ),
  }));

const createTask = (sql: SqlClient.SqlClient, taskPrefix: string, input: CreateTaskInput) =>
  Effect.gen(function* () {
    const numericId = yield* nextTaskNumericId(sql);
    const taskId = generatedPublicTaskId(taskPrefix, numericId);
    const prerequisiteTaskIds = input.dependsOn ?? [];
    const dependencyError = yield* validateDependencies(sql, taskId, prerequisiteTaskIds, false);
    if (dependencyError !== undefined) return dependencyError;

    yield* sql`
      INSERT INTO tasks (id, numeric_id, title, description, state, created_at, updated_at)
      VALUES (${taskId}, ${numericId}, ${input.title}, ${input.description}, 'new', ${input.now}, ${input.now})
    `;
    yield* insertDependencies(sql, taskId, prerequisiteTaskIds);
    const created = yield* getTaskById(sql, taskId);
    if (created === undefined) return yield* invalidData("create Task", "Task disappeared");
    return { ok: true as const, task: created };
  });

const replaceTaskDependencies = (sql: SqlClient.SqlClient, input: ReplaceTaskDependenciesInput) =>
  Effect.gen(function* () {
    const target = yield* taskDependencyReplacementTarget(sql, input.taskId);
    if (!target.ok) return target;

    const dependencyError = yield* validateDependencies(
      sql,
      input.taskId,
      input.prerequisiteTaskIds,
      true,
    );
    if (dependencyError !== undefined) return dependencyError;

    yield* sql`DELETE FROM task_dependencies WHERE dependent_task_id = ${input.taskId}`;
    yield* insertDependencies(sql, input.taskId, input.prerequisiteTaskIds);
    const updated = yield* getTaskById(sql, input.taskId);
    if (updated === undefined) {
      return yield* invalidData("replace Task dependencies", "Task disappeared");
    }
    return { ok: true as const, task: updated };
  });

const listTasks = (sql: SqlClient.SqlClient, input: ListTasksInput) =>
  Effect.gen(function* () {
    const rows = input.state
      ? yield* sql<TaskSummaryRow>`
          SELECT id, title, state, created_at AS createdAt, updated_at AS updatedAt
          FROM tasks
          WHERE state = ${input.state}
          ORDER BY created_at ASC, numeric_id ASC
        `
      : input.includeDone
        ? yield* sql<TaskSummaryRow>`
            SELECT id, title, state, created_at AS createdAt, updated_at AS updatedAt
            FROM tasks
            ORDER BY created_at ASC, numeric_id ASC
          `
        : yield* sql<TaskSummaryRow>`
            SELECT id, title, state, created_at AS createdAt, updated_at AS updatedAt
            FROM tasks
            WHERE state <> 'done'
            ORDER BY created_at ASC, numeric_id ASC
          `;
    return yield* Effect.forEach(rows, (row) => rowToTaskSummary(sql, row));
  });

const listActionableTasks = (sql: SqlClient.SqlClient) =>
  Effect.gen(function* () {
    const rows = yield* sql<TaskSummaryRow>`
      SELECT id, title, state, created_at AS createdAt, updated_at AS updatedAt
      FROM tasks
      WHERE state IN ('new', 'todo', 'ready')
      ORDER BY
        CASE state WHEN 'ready' THEN 0 WHEN 'new' THEN 1 WHEN 'todo' THEN 2 END ASC,
        updated_at DESC,
        numeric_id ASC
    `;
    return yield* Effect.forEach(rows, (row) => rowToTaskSummary(sql, row));
  });

const getTaskById = (sql: SqlClient.SqlClient, taskId: PublicTaskId) =>
  Effect.gen(function* () {
    const rows = yield* sql<StoredTaskRecordRow>`
      SELECT id, title, description, state,
        created_at AS createdAt,
        updated_at AS updatedAt,
        (SELECT COUNT(*) FROM task_comments WHERE task_id = tasks.id) AS commentCount
      FROM tasks
      WHERE id = ${taskId}
    `;
    const row = rows[0];
    return row === undefined ? undefined : yield* rowToStoredTaskRecord(sql, row);
  });

const getTaskContextById = (sql: SqlClient.SqlClient, taskId: PublicTaskId) =>
  Effect.gen(function* () {
    const rows = yield* sql<TaskContextHeaderRow>`
      SELECT id, title, description FROM tasks WHERE id = ${taskId}
    `;
    const task = rows[0];
    if (task === undefined) return undefined;
    const comments = yield* sql<CommentContentRow>`
      SELECT content FROM task_comments
      WHERE task_id = ${taskId}
      ORDER BY sequence ASC
    `;
    return { ...task, comments: comments.map((row) => row.content) } satisfies TaskContext;
  });

const approveTask = (sql: SqlClient.SqlClient, input: ApproveTaskInput) =>
  Effect.gen(function* () {
    const current = yield* getTaskById(sql, input.taskId);
    if (current === undefined) return { ok: false as const, code: "task_not_found" as const };
    if (current.state === "todo") return { ok: true as const, changed: false, task: current };
    if (current.state !== "new") {
      return { ok: false as const, code: "invalid_task_state" as const, state: current.state };
    }
    yield* sql`UPDATE tasks SET state = 'todo', updated_at = ${input.now} WHERE id = ${input.taskId}`;
    const updated = yield* getTaskById(sql, input.taskId);
    if (updated === undefined) return yield* invalidData("approve Task", "Task disappeared");
    return { ok: true as const, changed: true, task: updated };
  });

const appendTaskComment = (sql: SqlClient.SqlClient, input: AppendTaskCommentInput) =>
  Effect.gen(function* () {
    const task = yield* getTaskById(sql, input.taskId);
    if (task === undefined) return { ok: false as const, code: "task_not_found" as const };
    if (task.state !== "new" && task.state !== "todo") {
      return { ok: false as const, code: "invalid_task_state" as const, state: task.state };
    }
    const now = input.now();
    yield* sql`
      INSERT INTO task_comments (id, task_id, created_at, content)
      VALUES (${randomUUID()}, ${input.taskId}, ${now}, ${input.content})
    `;
    yield* sql`UPDATE tasks SET updated_at = ${now} WHERE id = ${input.taskId}`;
    const count = yield* commentCountForTask(sql, input.taskId);
    return { ok: true as const, taskId: input.taskId, commentCount: count };
  });

const updateTaskContext = (sql: SqlClient.SqlClient, input: UpdateTaskContextInput) =>
  Effect.gen(function* () {
    const current = yield* getTaskById(sql, input.taskId);
    if (current === undefined) return { ok: false as const, code: "task_not_found" as const };
    if (current.state !== "new" && current.state !== "todo") {
      return { ok: false as const, code: "invalid_task_state" as const, state: current.state };
    }
    yield* sql`
      UPDATE tasks SET title = ${input.title}, description = ${input.description},
        updated_at = ${input.now} WHERE id = ${input.taskId}
    `;
    const updated = yield* getTaskById(sql, input.taskId);
    if (updated === undefined) {
      return yield* invalidData("update Task Context", "Task disappeared");
    }
    return { ok: true as const, task: updated };
  });

const transitionTaskState = (sql: SqlClient.SqlClient, input: TransitionTaskStateInput) =>
  Effect.gen(function* () {
    const current = yield* getTaskById(sql, input.taskId);
    if (current === undefined) return { ok: false as const, code: "task_not_found" as const };

    const decision = taskTransitionDecision(current, input);
    if (decision !== undefined) return decision;

    const blocked = yield* blockedTaskTransition(sql, input);
    if (blocked !== undefined) return blocked;

    return yield* persistTaskTransition(sql, input);
  });

const taskTransitionDecision = (
  current: StoredTaskRecord,
  input: TransitionTaskStateInput,
): TaskStateTransitionResult | undefined => {
  if (current.state === input.to) {
    return input.to === "implementing"
      ? { ok: true, changed: false, task: current }
      : {
          ok: false,
          code: "invalid_task_state_transition",
          from: current.state,
          to: input.to,
        };
  }
  return canTransition(current.state, input.to)
    ? undefined
    : {
        ok: false,
        code: "invalid_task_state_transition",
        from: current.state,
        to: input.to,
      };
};

const blockedTaskTransition = (sql: SqlClient.SqlClient, input: TransitionTaskStateInput) => {
  if (input.to !== "implementing") return Effect.succeed(undefined);
  return Effect.map(dependencyFacts(sql, input.taskId, "prerequisites"), (dependencies) => {
    const blockedBy = dependencies.filter((dependency) => dependency.state !== "done");
    return blockedBy.length === 0
      ? undefined
      : { ok: false as const, code: "task_dependencies_unsatisfied" as const, blockedBy };
  });
};

const persistTaskTransition = (sql: SqlClient.SqlClient, input: TransitionTaskStateInput) =>
  Effect.gen(function* () {
    yield* sql`
      UPDATE tasks SET state = ${input.to}, updated_at = ${input.now} WHERE id = ${input.taskId}
    `;
    const updated = yield* getTaskById(sql, input.taskId);
    if (updated === undefined) return yield* invalidData("transition Task", "Task disappeared");
    return { ok: true as const, changed: true, task: updated };
  });

const taskDependenciesAreEditable = (state: TaskState): boolean =>
  state === "new" || state === "todo";

const taskDependencyReplacementTarget = (sql: SqlClient.SqlClient, taskId: PublicTaskId) =>
  Effect.map(getTaskById(sql, taskId), (current) => {
    if (current === undefined) return { ok: false as const, code: "task_not_found" as const };
    return taskDependenciesAreEditable(current.state)
      ? { ok: true as const }
      : { ok: false as const, code: "dependencies_locked" as const, state: current.state };
  });

type DependencyValidationResult = {
  readonly ok: false;
  readonly code: DependencyValidationCode;
  readonly taskId?: PublicTaskId;
};

const validateDependencies = (
  sql: SqlClient.SqlClient,
  dependentTaskId: PublicTaskId,
  prerequisiteTaskIds: readonly PublicTaskId[],
  dependentExists: boolean,
): Effect.Effect<
  DependencyValidationResult | undefined,
  SqlError | RepositoryPersistedDataInvalid
> =>
  Effect.gen(function* () {
    const seen = new Set<string>();
    for (const prerequisiteTaskId of prerequisiteTaskIds) {
      const localError = validateDependencyIdentity(seen, dependentTaskId, prerequisiteTaskId);
      if (localError !== undefined) return localError;
      const storedError = yield* validateStoredDependency(
        sql,
        dependentTaskId,
        prerequisiteTaskId,
        dependentExists,
      );
      if (storedError !== undefined) return storedError;
    }
    return undefined;
  });

const validateDependencyIdentity = (
  seen: Set<string>,
  dependentTaskId: PublicTaskId,
  prerequisiteTaskId: PublicTaskId,
): DependencyValidationResult | undefined => {
  if (seen.has(prerequisiteTaskId)) {
    return { ok: false, code: "dependency_duplicate", taskId: prerequisiteTaskId };
  }
  seen.add(prerequisiteTaskId);
  return prerequisiteTaskId === dependentTaskId
    ? { ok: false, code: "dependency_self", taskId: prerequisiteTaskId }
    : undefined;
};

const validateStoredDependency = (
  sql: SqlClient.SqlClient,
  dependentTaskId: PublicTaskId,
  prerequisiteTaskId: PublicTaskId,
  dependentExists: boolean,
) =>
  Effect.gen(function* () {
    if ((yield* getTaskById(sql, prerequisiteTaskId)) === undefined) {
      return {
        ok: false as const,
        code: "dependency_unknown_task" as const,
        taskId: prerequisiteTaskId,
      };
    }
    if (!dependentExists) return undefined;
    return (yield* dependencyPathExists(sql, prerequisiteTaskId, dependentTaskId))
      ? { ok: false as const, code: "dependency_cycle" as const }
      : undefined;
  });

const dependencyPathExists = (
  sql: SqlClient.SqlClient,
  fromTaskId: PublicTaskId,
  targetTaskId: PublicTaskId,
) =>
  Effect.map(
    sql<{ readonly found: number }>`
      WITH RECURSIVE prerequisites(task_id) AS (
        SELECT ${fromTaskId}
        UNION
        SELECT task_dependencies.prerequisite_task_id
        FROM task_dependencies
        JOIN prerequisites ON task_dependencies.dependent_task_id = prerequisites.task_id
      )
      SELECT 1 AS found FROM prerequisites WHERE task_id = ${targetTaskId} LIMIT 1
    `,
    (rows) => rows.length > 0,
  );

const insertDependencies = (
  sql: SqlClient.SqlClient,
  dependentTaskId: PublicTaskId,
  prerequisiteTaskIds: readonly PublicTaskId[],
) =>
  Effect.forEach(
    prerequisiteTaskIds,
    (prerequisiteTaskId) => sql`
      INSERT INTO task_dependencies (dependent_task_id, prerequisite_task_id)
      VALUES (${dependentTaskId}, ${prerequisiteTaskId})
    `,
    { discard: true },
  );

const dependencyFacts = (
  sql: SqlClient.SqlClient,
  taskId: string,
  direction: "prerequisites" | "dependents",
) =>
  direction === "prerequisites"
    ? sql<TaskDependencyFact>`
        SELECT tasks.id, tasks.title, tasks.state
        FROM task_dependencies
        JOIN tasks ON tasks.id = task_dependencies.prerequisite_task_id
        WHERE task_dependencies.dependent_task_id = ${taskId}
        ORDER BY tasks.numeric_id ASC
      `
    : sql<TaskDependencyFact>`
        SELECT tasks.id, tasks.title, tasks.state
        FROM task_dependencies
        JOIN tasks ON tasks.id = task_dependencies.dependent_task_id
        WHERE task_dependencies.prerequisite_task_id = ${taskId}
        ORDER BY tasks.numeric_id ASC
      `;

const nextTaskNumericId = (sql: SqlClient.SqlClient) =>
  Effect.gen(function* () {
    const rows = yield* sql<NumericIdRow>`
      SELECT COALESCE(MAX(numeric_id), 0) + 1 AS numericId FROM tasks
    `;
    const row = rows[0];
    if (row === undefined) return yield* invalidData("create Task", "Missing numeric ID");
    return Number(row.numericId);
  });

const rowToTaskSummary = (sql: SqlClient.SqlClient, row: TaskSummaryRow) =>
  Effect.map(dependencyFacts(sql, row.id, "prerequisites"), (prerequisites): TaskSummary => {
    const blockedBy = prerequisites.filter((dependency) => dependency.state !== "done");
    return { ...row, startable: row.state === "todo" && blockedBy.length === 0, blockedBy };
  });

const rowToStoredTaskRecord = (sql: SqlClient.SqlClient, row: StoredTaskRecordRow) =>
  Effect.gen(function* () {
    const summary = yield* rowToTaskSummary(sql, row);
    const prerequisites = yield* dependencyFacts(sql, row.id, "prerequisites");
    const dependents = yield* dependencyFacts(sql, row.id, "dependents");
    return {
      ...summary,
      description: row.description,
      commentCount: Number(row.commentCount),
      prerequisites,
      dependents,
    } satisfies StoredTaskRecord;
  });

const commentCountForTask = (sql: SqlClient.SqlClient, taskId: PublicTaskId) =>
  Effect.gen(function* () {
    const rows = yield* sql<CommentCountRow>`
      SELECT COUNT(*) AS commentCount FROM task_comments WHERE task_id = ${taskId}
    `;
    const row = rows[0];
    if (row === undefined) return yield* invalidData("append Task comment", "Missing count");
    return Number(row.commentCount);
  });

const invalidData = (operationName: string, message: string) =>
  Effect.fail(
    new RepositoryPersistedDataInvalid({
      operationName,
      cause: new Error(message),
    }),
  );

type NumericIdRow = { readonly numericId: number | bigint };
type TaskSummaryRow = {
  readonly id: PublicTaskId;
  readonly title: string;
  readonly state: TaskState;
  readonly createdAt: string;
  readonly updatedAt: string;
};
type StoredTaskRecordRow = TaskSummaryRow & {
  readonly description: string;
  readonly commentCount: number | bigint;
};
type TaskContextHeaderRow = {
  readonly id: PublicTaskId;
  readonly title: string;
  readonly description: string;
};
type CommentContentRow = { readonly content: string };
type CommentCountRow = { readonly commentCount: number | bigint };
