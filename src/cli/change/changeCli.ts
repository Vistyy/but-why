import { Effect } from "effect";

import { parseCliTaskIdValue } from "../../cliTaskId.js";
import { withGlobalHelpFlags } from "../../cliHelp.js";
import {
  runtimeError,
  stateStoreUnavailable,
  success,
  usageError,
  type CliResult,
} from "../../cliResults.js";
import { readHandoffFile, type HandoffFileReadError } from "../../change/handoffFile.js";
import { loadChangeUseCases } from "../../localChange/changeUseCases.js";
import type { InteractiveSessionHost } from "../../change/interactiveSessionHost.js";
import type { PublicTaskId } from "../../task/taskId.js";
import type { ChangeRecord } from "../../change/change.js";

export type ChangeCommandEnvironment = {
  readonly cwd: string;
  readonly now: () => Date;
  readonly interactiveSessionHost?: InteractiveSessionHost;
  readonly interactiveSessionPath?: string;
};

export const routeChange = (
  args: readonly string[],
  environment: ChangeCommandEnvironment,
): Effect.Effect<CliResult> => {
  if (args.length === 0 || (args.length === 1 && args[0] === "--help")) {
    return Effect.succeed(
      success({
        usage: "by change <command> [--help]",
        commands: [
          {
            command: "by change start [--task <task-id>]",
            description: "Create a prepared Change worktree.",
          },
          {
            command: "by change prepare <change-id>",
            description: "Run or retry Repository Preparation.",
          },
          {
            command: "by change reconcile [<change-id>]",
            description: "Read owned pull requests and clean up terminal Changes.",
          },
          {
            command: "by change implement <change-id> [--handoff-file <path>]",
            description: "Launch an Interactive Session in a ready Change worktree.",
          },
        ],
        flags: withGlobalHelpFlags(),
      }),
    );
  }
  const subcommand = args[0];
  if (subcommand === "start") return runStart(args.slice(1), environment);
  if (subcommand === "prepare") return runPrepare(args.slice(1), environment);
  if (subcommand === "implement") return runImplement(args.slice(1), environment);
  if (subcommand === "reconcile") return runReconcile(args.slice(1), environment);
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
          {
            flag: "--task <task-id>",
            description: "Link one approved Task with satisfied prerequisites.",
          },
        ]),
        examples: [
          "by change start",
          "by change start --task BY-1",
          "by change start --output json",
        ],
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
    const parsed = parseCliTaskIdValue(args[1]);
    if (!parsed.ok) return Effect.succeed(parsed.result);
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

const runImplement = (
  args: readonly string[],
  environment: ChangeCommandEnvironment,
): Effect.Effect<CliResult> => {
  if (args.length === 1 && args[0] === "--help") {
    return Effect.succeed(
      success({
        usage: "by change implement <change-id> [--handoff-file <path>]",
        arguments: [
          { argument: "<change-id>", description: "Ready Change ID returned by Change Start" },
        ],
        flags: withGlobalHelpFlags([
          { flag: "--handoff-file <path>", description: "Optional compact handoff file" },
        ]),
        examples: [
          "by change implement <change-id>",
          "by change implement <change-id> --handoff-file /tmp/handoff.md --output json",
        ],
      }),
    );
  }
  const parsed = parseImplementArgs(args);
  if (!parsed.ok) return Effect.succeed(parsed.result);
  if (parsed.handoffFile === "-") {
    return Effect.succeed(
      usageError({
        code: "unsupported_stdin_handoff_file",
        message: "Reading a Change handoff from standard input is not supported.",
        help: [
          "Write the handoff to a file, then rerun Change Implement with --handoff-file <path>.",
        ],
      }),
    );
  }
  const handoff =
    parsed.handoffFile === undefined
      ? undefined
      : readHandoffFile(environment.cwd, parsed.handoffFile);
  if (handoff !== undefined && !handoff.ok) return Effect.succeed(handoffFileError(handoff.error));
  const loaded = loadChangeUseCases({
    cwd: environment.cwd,
    migrationTimestamp: () => environment.now().toISOString(),
    ...(environment.interactiveSessionHost === undefined
      ? {}
      : { interactiveSessionHost: environment.interactiveSessionHost }),
    ...(environment.interactiveSessionPath === undefined
      ? {}
      : { interactiveSessionPath: environment.interactiveSessionPath }),
  });
  if (!loaded.ok) return Effect.succeed(loadError(loaded.error));
  return Effect.promise(async () => {
    try {
      return implementResult(
        await loaded.changes.implement(
          parsed.changeId,
          handoff === undefined ? undefined : handoff.content,
        ),
      );
    } catch {
      return runtimeError({
        code: "launch_failed",
        message: "But Why? could not launch the Interactive Session.",
        help: ["Confirm Herdr is running, then retry Change Implement."],
      });
    }
  });
};

type ImplementArgsParseResult =
  | { readonly ok: true; readonly changeId: string; readonly handoffFile: string | undefined }
  | { readonly ok: false; readonly result: CliResult };

const parseImplementArgs = (args: readonly string[]): ImplementArgsParseResult => {
  const changeId = args[0];
  if (changeId === undefined || changeId.startsWith("-")) {
    return {
      ok: false,
      result: usageError({
        code: "invalid_arguments",
        message: "Change Implement requires one Change ID.",
        help: ["Run `by change implement <change-id> [--handoff-file <path>]`."],
      }),
    };
  }
  if (args.length === 1) return { ok: true, changeId, handoffFile: undefined };
  if (args.length === 3 && args[1] === "--handoff-file" && args[2] !== undefined) {
    return { ok: true, changeId, handoffFile: args[2] };
  }
  return {
    ok: false,
    result: usageError({
      code: "invalid_arguments",
      message: "Change Implement accepts one Change ID and an optional --handoff-file <path>.",
      help: ["Run `by change implement <change-id> [--handoff-file <path>]`."],
    }),
  };
};

const handoffFileError = (error: HandoffFileReadError): CliResult => {
  switch (error.code) {
    case "handoff_file_not_found":
      return usageError({
        code: error.code,
        message: "Change handoff file was not found.",
        details: { path: error.path },
        help: ["Create the handoff file, then rerun Change Implement."],
      });
    case "handoff_file_unreadable":
      return usageError({
        code: error.code,
        message: "Change handoff must be a readable regular file.",
        details: { path: error.path },
        help: ["Use a readable regular file for --handoff-file."],
      });
    case "handoff_file_too_large":
      return usageError({
        code: error.code,
        message: "Change handoff file is larger than 256 KiB.",
        details: { path: error.path, maxBytes: error.maxBytes },
        help: ["Shorten the handoff file to 256 KiB or less."],
      });
    case "invalid_handoff_encoding":
      return usageError({
        code: error.code,
        message: "Change handoff file must be valid UTF-8.",
        details: { path: error.path },
        help: ["Rewrite the handoff file as UTF-8, then retry Change Implement."],
      });
    case "empty_handoff_file":
      return usageError({
        code: error.code,
        message: "Change handoff file must not be empty.",
        details: { path: error.path },
        help: ["Write a non-empty handoff file, then retry Change Implement."],
      });
  }
};

const runReconcile = (
  args: readonly string[],
  environment: ChangeCommandEnvironment,
): Effect.Effect<CliResult> => {
  if (args.length === 1 && args[0] === "--help") {
    return Effect.succeed(
      success({
        usage: "by change reconcile [<change-id>]",
        arguments: [
          {
            argument: "<change-id>",
            description: "Optional Change ID. Without one, reconcile all eligible Changes.",
          },
        ],
        flags: withGlobalHelpFlags(),
        examples: [
          "by change reconcile",
          "by change reconcile <change-id>",
          "by change reconcile --output json",
        ],
      }),
    );
  }
  if (args.length > 1 || args[0]?.startsWith("-") === true) {
    return Effect.succeed(
      usageError({
        code: "invalid_arguments",
        message: "Change Reconcile accepts at most one Change ID.",
        help: ["Run `by change reconcile [<change-id>]`."],
      }),
    );
  }
  const changeId = args[0];
  const loaded = loadChangeUseCases({
    cwd: environment.cwd,
    migrationTimestamp: () => environment.now().toISOString(),
  });
  if (!loaded.ok) return Effect.succeed(loadError(loaded.error));
  return Effect.promise(async () => {
    try {
      const result = loaded.changes.reconcile(changeId, environment.now().toISOString());
      if (changeId !== undefined && result.changes.length === 0) {
        return runtimeError({
          code: "change_not_found",
          message: "Change was not found.",
          help: ["Use a Change ID returned by `by change start --output json`."],
        });
      }
      return result.rejected
        ? runtimeError({
            code: "reconciliation_rejected",
            message: "The owned pull request does not match the recorded Change facts.",
            details: { changes: result.changes },
            help: [
              "Inspect the Change and resolve the remote mismatch. Do not adopt the pull request.",
            ],
          })
        : success({ changes: result.changes });
    } catch {
      return stateStoreUnavailable("repository");
    }
  });
};

const implementResult = (
  result: Awaited<ReturnType<import("../../change/changeUseCases.js").ChangeUseCases["implement"]>>,
): CliResult => {
  if (result.ok) {
    return success({
      changeId: result.change.id,
      worktreePath: result.change.worktreePath,
      host: result.host,
      status: result.status,
    });
  }
  if (result.code === "change_not_found" || result.code === "change_not_open") {
    return runtimeError({
      code: result.code,
      message: result.code === "change_not_found" ? "Change was not found." : "Change is closed.",
      help: ["Use an open ready Change ID returned by `by change start --output json`."],
    });
  }
  if (result.code === "change_not_ready") {
    return runtimeError({
      code: result.code,
      message: "Change is not ready for an Interactive Session.",
      details: { changeId: result.change.id, readiness: result.change.readiness },
      help: [`Run \`by change prepare ${result.change.id}\`, then retry Change Implement.`],
    });
  }
  if ("message" in result) {
    return runtimeError({
      code: result.code,
      message: result.message,
      details: {
        changeId: result.change.id,
        worktreePath: result.change.worktreePath,
        host: "herdr",
      },
      help: ["Confirm Herdr is installed and running, then retry Change Implement."],
    });
  }
  throw new Error("Unhandled Change Implement result");
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
  if (result.code === "task_not_found") {
    return runtimeError({
      code: result.code,
      message: "Task was not found.",
      help: ["Run `by task list --all` to see known Tasks."],
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
  return operationalError(result.code, "change" in result ? result.change : undefined);
};

const prepareResult = (
  result: Awaited<ReturnType<import("../../change/changeUseCases.js").ChangeUseCases["prepare"]>>,
): CliResult => {
  if (result.ok) return success(changeView(result.change));
  if (result.code === "prepare_failed") return prepareFailure(result.change);
  if (result.code === "change_not_found" || result.code === "change_not_open") {
    return runtimeError({
      code: result.code,
      message: result.code === "change_not_found" ? "Change was not found." : "Change is closed.",
      help: ["Use an open Change ID returned by `by change start --output json`."],
    });
  }
  return operationalError(result.code, result.change);
};

const changeView = (change: ChangeRecord) => ({
  change: { id: change.id, taskId: change.taskId, readiness: change.readiness },
  branch: change.branchRef,
  baseRef: change.baseRef,
  startingCommit: change.startingCommit,
  worktreePath: change.worktreePath,
});

const prepareFailure = (change: ChangeRecord): CliResult => {
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
      stdout: boundedEvidence(failure.stdout),
      stderr: boundedEvidence(failure.stderr),
    },
    help: [`Fix the preparation failure, then run \`by change prepare ${change.id}\`.`],
  });
};

const boundedEvidence = (value: string): string =>
  value.length <= 1000
    ? value
    : `${value.slice(0, 1000)}\n... (truncated, ${value.length} chars total)`;

const operationalError = (code: string, change?: ChangeRecord): CliResult =>
  runtimeError({
    code,
    message: "Change Start could not create or recover the Managed Worktree.",
    ...(change === undefined
      ? {}
      : {
          details: {
            changeId: change.id,
            branch: change.branchRef,
            startingCommit: change.startingCommit,
            worktreePath: change.worktreePath,
          },
        }),
    help: [
      "Inspect the default branch, committed Repo Config, branch, and worktree path, then retry.",
    ],
  });

const loadError = (error: { readonly code: string; readonly taskPrefix?: string }): CliResult =>
  error.code === "state_store_unavailable"
    ? stateStoreUnavailable(error.taskPrefix ?? "repository")
    : runtimeError({
        code: error.code,
        message: "But Why repository state is unavailable.",
        help: ["Run `by init --task-prefix <prefix>` in the repository."],
      });
