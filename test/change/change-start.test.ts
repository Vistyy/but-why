import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { describe } from "vitest";
import { prepareChange, startChange } from "../../src/change/changeLifecycle.js";
import type { ChangeStartGitOperations } from "../../src/change/changeStartGitOperations.js";
import { type ChangeStartPersistence } from "../../src/change/changeStartPersistence.js";
import type {
  ChangeStartRecord,
  CreateChangeStartInput,
} from "../../src/change/changeStartStore.js";
import { WorkspaceCommandExecutionFailed } from "../../src/command/workspaceCommand.js";
import type { RepositoryPreparationEffectExecutor } from "../../src/repositoryPreparation/runRepositoryPreparation.js";

const now = "2026-06-30T12:00:00.000Z";
const reviewerConfiguration = { acceptanceReview: null, specialistReviews: [] } as const;

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
  acceptanceContext: null,
  reviewerConfiguration: input.reviewerConfiguration ?? null,
  prepare: input.prepare ?? null,
  prepareFailure: null,
  state: "open",
});

type FixtureOptions = {
  readonly existing?: ChangeStartRecord;
  readonly provision?: ReturnType<ChangeStartGitOperations["provisionWorktree"]>;
  readonly prepare?: Exclude<ChangeStartRecord["prepare"], null>;
  readonly execute?: RepositoryPreparationEffectExecutor;
};

const required = <Value>(value: Value | undefined, message: string): Value => {
  if (value === undefined) throw new Error(message);
  return value;
};

const fixture = (options: FixtureOptions = {}) => {
  const events: string[] = [];
  let current = options.existing;
  const store: ChangeStartPersistence = {
    create: (input) => {
      events.push("create");
      const change = recordFrom({
        ...input,
        ...(options.prepare === undefined ? {} : { prepare: options.prepare }),
      });
      current = change;
      return Effect.succeed({ ok: true as const, change });
    },
    getById: (id) => Effect.succeed(current?.id === id ? current : undefined),
    recordPrepareOutcome: (id, failure) => {
      events.push(`recordPrepareOutcome:${id}`);
      const captured = required(current, "recordPrepareOutcome requires a captured Change");
      if (captured.id !== id)
        throw new Error(`Preparation outcome targeted ${id}, not ${captured.id}`);
      current = {
        ...captured,
        prepareFailure: failure,
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
  const executor: RepositoryPreparationEffectExecutor =
    options.execute ?? (() => Effect.succeed({ exitCode: 0, stdout: "", stderr: "" }));
  const operations = {
    start: (input: Parameters<typeof startChange>[3]) =>
      startChange(store, git, executor, { reviewerConfiguration, ...input }),
    startWithoutReviewerConfiguration: () => startChange(store, git, executor, { now }),
    prepare: (changeId: string, preparedAt: string) =>
      prepareChange(store, git, executor, changeId, preparedAt),
  };
  return { operations: operations, events, current: () => current };
};

describe("Change Start orchestration", () => {
  it.effect("creates an unlinked Change in provisioning order", () =>
    Effect.gen(function* () {
      const changeWithoutTask = fixture();
      const changeWithoutTaskResult = yield* changeWithoutTask.operations.start({ now });
      expect(changeWithoutTaskResult).toMatchObject({
        ok: true,
        change: { acceptanceContext: null },
      });
      expect(changeWithoutTask.events).toEqual([
        "resolveIntent:pending-change-start:default",
        "create",
        "provisionWorktree:create",
        expect.stringMatching(/^recordPrepareOutcome:/u),
      ]);
    }),
  );

  it.effect("requires reviewer configuration before creating a new Change", () =>
    Effect.gen(function* () {
      const captured = fixture();
      expect(yield* captured.operations.startWithoutReviewerConfiguration()).toEqual({
        ok: false,
        code: "reviewer_configuration_invalid",
        message: "A reviewer configuration is required to create a Change.",
      });
      expect(captured.events).toEqual([]);
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
        "resolveIntent:pending-change-start:default",
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
          Effect.Effect<
            { exitCode: number; stdout: string; stderr: string },
            WorkspaceCommandExecutionFailed
          >
        > = [
          Effect.succeed({
            exitCode: 7,
            stdout: "partial",
            stderr: "failed\n__BUTWHY_PREPARE_COMPLETED_prepare__:7\n",
          }),
          Effect.succeed({ exitCode: 0, stdout: "", stderr: "timed out" }),
          Effect.fail(new WorkspaceCommandExecutionFailed({ message: "executor unavailable" })),
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
