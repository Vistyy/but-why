import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { describe } from "vitest";
import { prepareChange, startChange } from "../../src/change/changeLifecycle.js";
import type { ChangeStartGitOperations } from "../../src/change/changeStartGitOperations.js";
import type { ChangeStartPersistence } from "../../src/change/changeStartPersistence.js";
import type {
  ChangeStartEligibilityError,
  ChangeStartRecord,
  CreateChangeStartInput,
} from "../../src/change/changeStartStore.js";
import type { RepositoryPreparationEffectExecutor } from "../../src/repositoryPreparation/runRepositoryPreparation.js";
import type { PublicTaskId } from "../../src/task/taskId.js";

const now = "2026-06-30T12:00:00.000Z";
const taskId = "BY-197" as PublicTaskId;

const intent = {
  repositoryCommonDirectory: "/repo/.git",
  baseRef: "refs/remotes/origin/main",
  baseRemoteUrl: "https://github.com/acme/repo.git",
  branchRef: "refs/heads/but-why/change-1",
  startingCommit: "abc123",
  worktreePath: "/repo-worktrees/but-why/change-1",
};

const recordFrom = (input: CreateChangeStartInput): ChangeStartRecord => ({
  ...input,
  taskId: input.taskId ?? null,
  acceptanceContext:
    input.taskId === undefined
      ? null
      : { version: 1, title: "Accepted title", description: "Accepted description" },
  prepare: input.prepare ?? null,
  prepareFailure: null,
  publication: null,
  cleanup: { state: "pending", blockingReason: null },
  state: "open",
  closeReason: null,
  cancelReason: null,
  createdAt: input.now,
  updatedAt: input.now,
  closedAt: null,
});

type FixtureOptions = {
  readonly existing?: ChangeStartRecord;
  readonly eligibility?: ChangeStartEligibilityError;
  readonly provision?: ReturnType<ChangeStartGitOperations["provisionWorktree"]>;
  readonly prepare?: Exclude<ChangeStartRecord["prepare"], null>;
  readonly execute?: RepositoryPreparationEffectExecutor["effect"];
};

const required = <Value>(value: Value | undefined, message: string): Value => {
  if (value === undefined) throw new Error(message);
  return value;
};

const fixture = (options: FixtureOptions = {}) => {
  const events: string[] = [];
  let current = options.existing;
  const store: ChangeStartPersistence = {
    prepareTask: () => {
      events.push("prepareTask");
      return Effect.succeed(options.eligibility ?? { ok: true as const, existing: current });
    },
    create: (input) => {
      events.push("create");
      current = recordFrom({
        ...input,
        ...(options.prepare === undefined ? {} : { prepare: options.prepare }),
      });
      return Effect.succeed({ ok: true as const, change: current });
    },
    getById: (id) => Effect.succeed(current?.id === id ? current : undefined),
    recordPrepareOutcome: (id, failure, updatedAt) => {
      events.push(`recordPrepareOutcome:${id}`);
      const captured = required(current, "recordPrepareOutcome requires a captured Change");
      if (captured.id !== id)
        throw new Error(`Preparation outcome targeted ${id}, not ${captured.id}`);
      current = {
        ...captured,
        prepareFailure: failure,
        updatedAt,
      };
      return Effect.succeed(current);
    },
  };
  const git: ChangeStartGitOperations = {
    resolveIntent: (slug, base) => {
      events.push(`resolveIntent:${slug}:${base ?? "default"}`);
      return { ok: true, intent };
    },
    provisionWorktree: (_change, recovering) => {
      events.push(`provisionWorktree:${recovering ? "recover" : "create"}`);
      return options.provision ?? { ok: true };
    },
  };
  const effect = options.execute ?? (() => Effect.succeed({ exitCode: 0, stdout: "", stderr: "" }));
  const executor: RepositoryPreparationEffectExecutor = Object.assign(
    async () => ({ exitCode: 0, stdout: "", stderr: "" }),
    { effect },
  );
  const operations = {
    start: (input: Parameters<typeof startChange>[3]) => startChange(store, git, executor, input),
    prepare: (changeId: string, preparedAt: string) =>
      prepareChange(store, git, executor, changeId, preparedAt),
  };
  return { operations: operations, events, current: () => current };
};

describe("Change Start orchestration", () => {
  it.effect(
    "creates taskless and Task-backed Changes in provisioning order with captured intent",
    () =>
      Effect.gen(function* () {
        const taskless = fixture();
        const tasklessResult = yield* taskless.operations.start({ now });
        expect(tasklessResult).toMatchObject({
          ok: true,
          change: { taskId: null, acceptanceContext: null },
        });
        expect(taskless.events).toEqual([
          expect.stringMatching(/^resolveIntent:change-/u),
          "create",
          "provisionWorktree:create",
          expect.stringMatching(/^recordPrepareOutcome:/u),
        ]);

        const backed = fixture();
        const backedResult = yield* backed.operations.start({ taskId, baseBranch: "main", now });
        expect(backedResult).toMatchObject({
          ok: true,
          change: {
            taskId,
            acceptanceContext: {
              version: 1,
              title: "Accepted title",
              description: "Accepted description",
            },
          },
        });
        expect(backed.events).toEqual([
          "prepareTask",
          expect.stringMatching(/^resolveIntent:by-197-[a-f0-9]+:main$/u),
          "create",
          "provisionWorktree:create",
          expect.stringMatching(/^recordPrepareOutcome:/u),
        ]);
      }),
  );

  it.effect("returns Task eligibility failures before Git or persistence mutation", () =>
    Effect.gen(function* () {
      const failures: readonly ChangeStartEligibilityError[] = [
        { ok: false, code: "task_not_found" },
        { ok: false, code: "invalid_task_state", state: "new" },
        {
          ok: false,
          code: "task_dependencies_unsatisfied",
          blockedBy: [{ id: "BY-196" as PublicTaskId, title: "Prerequisite", state: "todo" }],
        },
      ];
      for (const failure of failures) {
        const captured = fixture({ eligibility: failure });
        expect(yield* captured.operations.start({ taskId, now })).toEqual(failure);
        expect(captured.events).toEqual(["prepareTask"]);
      }
    }),
  );

  it.effect("recovers and prepares the same existing Task-backed Change", () =>
    Effect.gen(function* () {
      const existing = recordFrom({
        id: "existing",
        ...intent,
        taskId,
        prepare: { command: "prepare repository", timeoutSeconds: 17 },
        now,
      });
      const captured = fixture({ existing });
      const result = yield* captured.operations.start({ taskId, now });
      expect(result).toMatchObject({ ok: true, change: { id: existing.id, taskId } });
      expect(captured.current()?.acceptanceContext).toBe(existing.acceptanceContext);
      expect(captured.events).toEqual([
        "prepareTask",
        "provisionWorktree:recover",
        "recordPrepareOutcome:existing",
      ]);
    }),
  );

  it.effect("rejects a conflicting requested base before recovering the same open Change", () =>
    Effect.gen(function* () {
      const existing = recordFrom({ id: "existing", ...intent, taskId, now });
      const captured = fixture({ existing });
      expect(yield* captured.operations.start({ taskId, baseBranch: "release", now })).toEqual({
        ok: false,
        code: "requested_base_conflict",
        requestedBaseBranch: "release",
        recordedBaseBranch: "main",
      });
      expect(captured.events).toEqual(["prepareTask"]);
    }),
  );

  it.effect("attaches provisioning failure to the same newly persisted Change", () =>
    Effect.gen(function* () {
      const captured = fixture({ provision: { ok: false, code: "git_tooling_error" } });
      const result = yield* captured.operations.start({ now });
      expect(result).toMatchObject({
        ok: false,
        code: "git_tooling_error",
        change: { id: expect.any(String) },
      });
      if (!("change" in result)) return;
      expect(result.change).toBe(captured.current());
      expect(captured.events).toEqual([
        expect.stringMatching(/^resolveIntent:change-/u),
        "create",
        "provisionWorktree:create",
      ]);
    }),
  );

  it.effect(
    "records nonzero, timeout, Tooling Failure, and retry preparation outcomes on one Change",
    () =>
      Effect.gen(function* () {
        const responses: Array<
          Effect.Effect<{ exitCode: number; stdout: string; stderr: string }, unknown>
        > = [
          Effect.succeed({
            exitCode: 7,
            stdout: "partial",
            stderr: "failed\n__BUTWHY_PREPARE_COMPLETED_prepare__:7\n",
          }),
          Effect.succeed({ exitCode: 0, stdout: "", stderr: "timed out" }),
          Effect.fail(new Error("executor unavailable")),
          Effect.succeed({
            exitCode: 0,
            stdout: "",
            stderr: "ok\n__BUTWHY_PREPARE_COMPLETED_prepare__:0\n",
          }),
        ];
        const commands: Array<{ readonly command: string; readonly cwd?: string }> = [];
        const captured = fixture({
          prepare: { command: "prepare repository", timeoutSeconds: 17 },
          execute: (command, options) => {
            commands.push({ command, ...options });
            return command.startsWith("command -v timeout")
              ? Effect.succeed({ exitCode: 0, stdout: "", stderr: "" })
              : required(responses.shift(), "missing captured preparation response");
          },
        });

        const started = yield* captured.operations.start({ now });
        expect(started).toMatchObject({
          ok: true,
          change: { prepareFailure: { exitCode: 7, timedOut: false } },
        });
        const id = required(captured.current(), "Change Start did not capture a Change").id;
        expect(yield* captured.operations.prepare(id, now)).toMatchObject({
          ok: true,
          change: { id, prepareFailure: { exitCode: 124, timedOut: true, stderr: "timed out" } },
        });
        expect(yield* captured.operations.prepare(id, now)).toMatchObject({
          ok: true,
          change: {
            id,
            prepareFailure: { exitCode: 1, timedOut: false, stderr: "executor unavailable" },
          },
        });
        expect(yield* captured.operations.prepare(id, now)).toMatchObject({
          ok: true,
          change: { id, prepareFailure: null },
        });
        expect(commands.filter(({ command }) => command.includes("timeout 17s"))).toHaveLength(4);
        expect(commands.every(({ cwd }) => cwd === intent.worktreePath)).toBe(true);
        expect(
          captured.events.filter((event) => event === "provisionWorktree:recover"),
        ).toHaveLength(3);
      }),
  );
});
