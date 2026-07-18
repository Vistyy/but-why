import { Effect } from "effect";

import { withGlobalHelpFlags } from "../../cliHelp.js";
import { runtimeError, stateStoreUnavailable, success, usageError, type CliResult } from "../../cliResults.js";
import { loadChangeUseCases } from "../../localChange/changeUseCases.js";
import { parsePublicTaskId, type PublicTaskId } from "../../task/taskId.js";
import type { ChangeStartRecord } from "../../change/changeStartStore.js";

export type ChangeCommandEnvironment = {
  readonly cwd: string;
  readonly now: () => Date;
};

export const routeChange = (
  args: readonly string[],
  environment: ChangeCommandEnvironment,
): Effect.Effect<CliResult> => {
  if (args.length === 1 && args[0] === "--help") {
    return Effect.succeed(
      success({
        usage: "by change <command> [--help]",
        commands: [
          { command: "by change start [--task <task-id>]", description: "Create a prepared Change worktree" },
          { command: "by change prepare <change-id>", description: "Run or retry Repository Preparation" },
        ],
        flags: withGlobalHelpFlags(),
      }),
    );
  }
  const subcommand = args[0];
  if (subcommand === "start") return runStart(args.slice(1), environment);
  if (subcommand === "prepare") return runPrepare(args.slice(1), environment);
  return Effect.succeed(
    usageError({
      code: subcommand?.startsWith("-") === true ? "unknown_flag" : "unknown_command",
      message:
        subcommand?.startsWith("-") === true
          ? `Unknown flag: ${subcommand}`
          : `Unknown change command: ${subcommand ?? ""}`,
      help: ["Run `by change --help`."],
    }),
  );
};

const runStart = (
  args: readonly string[],
  environment: ChangeCommandEnvironment,
): Effect.Effect<CliResult> => {
  if (args.length === 1 && args[0] === "--help") {
    return Effect.succeed(
      success({
        usage: "by change start [--task <task-id>]",
        flags: withGlobalHelpFlags([
          { flag: "--task <task-id>", description: "Link one approved dependency-unblocked Task" },
        ]),
        examples: ["by change start", "by change start --task BY-1", "by change start --output json"],
      }),
    );
  }
  let taskId: PublicTaskId | undefined;
  if (args.length > 0) {
    if (args.length !== 2 || args[0] !== "--task" || args[1] === undefined) {
      return Effect.succeed(
        usageError({
          code: "invalid_arguments",
          message: "Change Start accepts only an optional --task <task-id>.",
          help: ["Run `by change start [--task <task-id>]`."],
        }),
      );
    }
    const parsed = parsePublicTaskId(args[1]);
    if (!parsed.ok) {
      return Effect.succeed(
        usageError({
          code: "invalid_task_id",
          message: `Invalid Task ID: ${args[1]}`,
          help: ["Use a public Task ID such as BY-1."],
        }),
      );
    }
    taskId = parsed.taskId;
  }

  const loaded = loadChangeUseCases({
    cwd: environment.cwd,
    migrationTimestamp: () => environment.now().toISOString(),
  });
  if (!loaded.ok) return Effect.succeed(loadError(loaded.error));

  return Effect.promise(async () => {
    try {
      const result = await loaded.changes.start({
        ...(taskId === undefined ? {} : { taskId }),
        now: environment.now().toISOString(),
      });
      return startResult(result);
    } catch {
      return stateStoreUnavailable("repository");
    }
  });
};

const runPrepare = (
  args: readonly string[],
  environment: ChangeCommandEnvironment,
): Effect.Effect<CliResult> => {
  if (args.length === 1 && args[0] === "--help") {
    return Effect.succeed(
      success({
        usage: "by change prepare <change-id>",
        arguments: [{ argument: "<change-id>", description: "Change ID returned by Change Start" }],
        flags: withGlobalHelpFlags(),
        examples: ["by change prepare <change-id>", "by change prepare <change-id> --output json"],
      }),
    );
  }
  if (args.length !== 1 || args[0] === undefined || args[0].startsWith("-")) {
    return Effect.succeed(
      usageError({
        code: "invalid_arguments",
        message: "Change Prepare requires one Change ID.",
        help: ["Run `by change prepare <change-id>`."],
      }),
    );
  }
  const loaded = loadChangeUseCases({
    cwd: environment.cwd,
    migrationTimestamp: () => environment.now().toISOString(),
  });
  if (!loaded.ok) return Effect.succeed(loadError(loaded.error));
  return Effect.promise(async () => {
    try {
      const result = await loaded.changes.prepare(
        args[0] as string,
        environment.now().toISOString(),
      );
      return prepareResult(result);
    } catch {
      return stateStoreUnavailable("repository");
    }
  });
};

const startResult = (
  result: Awaited<ReturnType<import("../../change/changeUseCases.js").ChangeUseCases["start"]>>,
): CliResult => {
  if (result.ok) return success(changeView(result.change));
  if (result.code === "prepare_failed") return prepareFailure(result.change);
  if (result.code === "task_dependencies_unsatisfied") {
    return runtimeError({
      code: result.code,
      message: "The Task has incomplete prerequisites.",
      details: { blockedBy: result.blockedBy },
      help: ["Complete every prerequisite, then run Change Start again."],
    });
  }
  if (result.code === "invalid_task_state") {
    return runtimeError({
      code: result.code,
      message: `The Task cannot start from state ${result.state}.`,
      details: { state: result.state },
      help: ["Approve the Task before starting its Change."],
    });
  }
  return operationalError(result.code);
};

const prepareResult = (
  result: Awaited<ReturnType<import("../../change/changeUseCases.js").ChangeUseCases["prepare"]>>,
): CliResult => {
  if (result.ok) return success(changeView(result.change));
  if (result.code === "prepare_failed") return prepareFailure(result.change);
  return runtimeError({
    code: result.code,
    message: result.code === "change_not_found" ? "Change was not found." : "Change is closed.",
    help: ["Use an open Change ID returned by `by change start --output json`."],
  });
};

const changeView = (change: ChangeStartRecord) => ({
  change: { id: change.id, taskId: change.taskId, readiness: change.readiness },
  branch: change.branchRef,
  baseRef: change.baseRef,
  startingCommit: change.startingCommit,
  worktreePath: change.worktreePath,
});

const prepareFailure = (change: ChangeStartRecord): CliResult => {
  const failure = change.prepareFailure;
  if (failure === null) throw new Error("Prepare-failed Change has no failure evidence");
  return runtimeError({
    code: "prepare_failed",
    message: "Repository Preparation failed; the Change and worktree were preserved.",
    details: {
      changeId: change.id,
      readiness: change.readiness,
      worktreePath: change.worktreePath,
      command: failure.command,
      exitCode: failure.exitCode,
      timedOut: failure.timedOut,
      stdout: failure.stdout,
      stderr: failure.stderr,
    },
    help: [`Fix the preparation failure, then run \`by change prepare ${change.id}\`.`],
  });
};

const operationalError = (code: string): CliResult =>
  runtimeError({
    code,
    message: "Change Start could not create or recover the Managed Worktree.",
    help: ["Inspect the default branch, committed Repo Config, branch, and worktree path, then retry."],
  });

const loadError = (error: { readonly code: string; readonly taskPrefix?: string }): CliResult =>
  error.code === "state_store_unavailable"
    ? stateStoreUnavailable(error.taskPrefix ?? "repository")
    : runtimeError({
        code: error.code,
        message: "But Why repository state is unavailable.",
        help: ["Run `by init --task-prefix <prefix>` in the repository."],
      });
