import { Effect } from "effect";

import { parseCliTaskIdValue } from "../../cliTaskId.js";
import { withGlobalHelpFlags } from "../../cliHelp.js";
import {
  repositoryStorageErrorResult,
  runtimeError,
  stateStoreUnavailable,
  success,
  usageError,
  type CliResult,
} from "../../cliResults.js";
import { readHandoffFile, type HandoffFileReadError } from "../../change/handoffFile.js";
import { loadChangeInspection } from "../../localChange/loadChangeInspection.js";
import { withChangeUseCases } from "../../localChange/changeUseCases.js";
import { loadChangeSubmit } from "../../localChange/loadChangeSubmit.js";
import type { InteractiveSessionHost } from "../../change/interactiveSessionHost.js";
import type { ReviewerAgentRuntime } from "../../agent/reviewerAgentRuntime.js";
import type { PublicTaskId } from "../../task/taskId.js";
import type { ChangeRecord } from "../../change/change.js";
import type { ChangeSubmitResult } from "../../change/submitChange.js";
import type {
  ChangeImplementResult,
  ChangePrepareResult,
  ChangeStartResult,
  ChangeUseCases,
} from "../../change/changeUseCases.js";
import type { RepositoryStorageError } from "../../repositoryStorageError.js";

export type ChangeCommandEnvironment = {
  readonly cwd: string;
  readonly globalConfigPath: string;
  readonly now: () => Date;
  readonly reviewerAgentRuntime?: ReviewerAgentRuntime;
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
            command: "by change list [--all]",
            description: "List Changes oldest first.",
          },
          {
            command: "by change show <change-id>",
            description: "Show Change implementation, validation, and delivery facts.",
          },
          {
            command: "by change findings <change-id>",
            description: "Show Findings for the current Change Candidate.",
          },
          {
            command: "by change validation-runs <change-id>",
            description: "List Validation Run History for a Change.",
          },
          {
            command: "by change submit <change-id>",
            description: "Validate and publish a ready Change.",
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
  if (subcommand === "list") return runList(args.slice(1), environment);
  if (subcommand === "show") return runShow(args.slice(1), environment);
  if (subcommand === "findings") return runFindings(args.slice(1), environment);
  if (subcommand === "validation-runs") return runValidationRuns(args.slice(1), environment);
  if (subcommand === "implement") return runImplement(args.slice(1), environment);
  if (subcommand === "submit") return runSubmit(args.slice(1), environment);
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

  return withChanges(environment, (changes) =>
    Effect.map(
      changes.start({
        ...(taskId === undefined ? {} : { taskId }),
        now: environment.now().toISOString(),
      }),
      startResult,
    ),
  );
};

const runList = (
  args: readonly string[],
  environment: ChangeCommandEnvironment,
): Effect.Effect<CliResult> => {
  if (args.length === 1 && args[0] === "--help") {
    return Effect.succeed(
      success({
        usage: "by change list [--all]",
        flags: withGlobalHelpFlags([{ flag: "--all", description: "Include closed Changes." }]),
        examples: ["by change list", "by change list --all", "by change list --output json"],
      }),
    );
  }
  if (args.length > 1 || (args.length === 1 && args[0] !== "--all")) {
    return Effect.succeed(
      usageError({
        code: "invalid_arguments",
        message: "Change List accepts only an optional --all flag.",
        help: ["Run `by change list [--all]`."],
      }),
    );
  }
  const loaded = loadChangeInspection({
    cwd: environment.cwd,
  });
  if (!loaded.ok) return Effect.succeed(loadError(loaded.error));
  try {
    const now = environment.now().getTime();
    return Effect.succeed(
      success({
        changes: loaded.inspection
          .list({
            repositoryCommonDirectory: loaded.commonDirectory,
            includeClosed: args[0] === "--all",
          })
          .map((change) => ({
            id: change.id,
            taskId: change.taskId,
            state: change.state,
            createdAt: change.createdAt,
            ...(change.state === "open"
              ? {
                  ageSeconds: Math.max(0, Math.floor((now - Date.parse(change.createdAt)) / 1_000)),
                }
              : {}),
          })),
      }),
    );
  } catch {
    return Effect.succeed(stateStoreUnavailable("repository"));
  }
};

const runShow = (
  args: readonly string[],
  environment: ChangeCommandEnvironment,
): Effect.Effect<CliResult> => {
  if (args.length === 1 && args[0] === "--help") {
    return Effect.succeed(
      success({
        usage: "by change show <change-id>",
        arguments: [{ argument: "<change-id>", description: "Change ID returned by Change Start" }],
        flags: withGlobalHelpFlags(),
        examples: ["by change show <change-id>", "by change show <change-id> --output json"],
      }),
    );
  }
  if (args.length !== 1 || args[0] === undefined || args[0].startsWith("-")) {
    return Effect.succeed(
      usageError({
        code: "invalid_arguments",
        message: "Change Show requires one Change ID.",
        help: ["Run `by change show <change-id>`."],
      }),
    );
  }
  const loaded = loadChangeInspection({
    cwd: environment.cwd,
  });
  if (!loaded.ok) return Effect.succeed(loadError(loaded.error));
  try {
    const detail = loaded.inspection.inspect(args[0]);
    if (detail === undefined) return Effect.succeed(changeNotFound());
    return Effect.succeed(
      success({
        change: changeInspectionView(detail.change),
        currentCandidate: detail.currentCandidate,
        currentValidationRun: detail.currentValidationRun,
        findings: detail.findings,
        toolingFailures: detail.toolingFailures,
        pullRequest: detail.change.publication?.pullRequest ?? null,
        cleanup: detail.change.cleanup,
      }),
    );
  } catch {
    return Effect.succeed(stateStoreUnavailable("repository"));
  }
};

const changeInspectionView = (change: ChangeRecord) => ({
  id: change.id,
  taskId: change.taskId,
  state: change.state,
  closeReason: change.closeReason,
  readiness: change.readiness,
  branchRef: change.branchRef,
  baseRef: change.baseRef,
  worktreePath: change.worktreePath,
  startingCommit: change.startingCommit,
  createdAt: change.createdAt,
  closedAt: change.closedAt,
});

const changeNotFound = (): CliResult =>
  runtimeError({
    code: "change_not_found",
    message: "Change was not found.",
    help: ["Use a Change ID returned by `by change list --all --output json`."],
  });

const runFindings = (
  args: readonly string[],
  environment: ChangeCommandEnvironment,
): Effect.Effect<CliResult> => {
  const changeId = changeIdArgument(args, "findings");
  if (!changeId.ok) return Effect.succeed(changeId.result);
  const loaded = loadChangeInspection({
    cwd: environment.cwd,
  });
  if (!loaded.ok) return Effect.succeed(loadError(loaded.error));
  try {
    const result = loaded.inspection.findings(changeId.changeId);
    if (result === undefined) return Effect.succeed(changeNotFound());
    return Effect.succeed(
      success({
        change: changeInspectionView(result.change),
        candidate: result.candidate,
        validationRun: result.validationRun,
        findings: result.findings,
        toolingFailures: result.toolingFailures,
        count: result.findings.length,
      }),
    );
  } catch {
    return Effect.succeed(stateStoreUnavailable("repository"));
  }
};

const runValidationRuns = (
  args: readonly string[],
  environment: ChangeCommandEnvironment,
): Effect.Effect<CliResult> => {
  const changeId = changeIdArgument(args, "validation-runs");
  if (!changeId.ok) return Effect.succeed(changeId.result);
  const loaded = loadChangeInspection({
    cwd: environment.cwd,
  });
  if (!loaded.ok) return Effect.succeed(loadError(loaded.error));
  try {
    const result = loaded.inspection.validationRuns(changeId.changeId);
    if (result === undefined) return Effect.succeed(changeNotFound());
    return Effect.succeed(success({ validationRuns: result.validationRuns }));
  } catch {
    return Effect.succeed(stateStoreUnavailable("repository"));
  }
};

type ChangeIdArgumentResult =
  | { readonly ok: true; readonly changeId: string }
  | { readonly ok: false; readonly result: CliResult };

const changeIdArgument = (
  args: readonly string[],
  command: "findings" | "validation-runs",
): ChangeIdArgumentResult => {
  if (args.length === 1 && args[0] === "--help") {
    return {
      ok: false,
      result: success({
        usage: `by change ${command} <change-id>`,
        arguments: [{ argument: "<change-id>", description: "Change ID returned by Change Start" }],
        flags: withGlobalHelpFlags(),
        examples: [
          `by change ${command} <change-id>`,
          `by change ${command} <change-id> --output json`,
        ],
      }),
    };
  }
  if (args.length !== 1 || args[0] === undefined || args[0].startsWith("-")) {
    return {
      ok: false,
      result: usageError({
        code: "invalid_arguments",
        message: `Change ${command === "findings" ? "Findings" : "Validation Runs"} requires one Change ID.`,
        help: [`Run \`by change ${command} <change-id>\`.`],
      }),
    };
  }
  return { ok: true, changeId: args[0] };
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
  const changeId = args[0];
  return withChanges(environment, (changes) =>
    Effect.map(changes.prepare(changeId, environment.now().toISOString()), prepareResult),
  );
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
  return withChanges(
    environment,
    (changes) =>
      Effect.map(
        changes.implement(parsed.changeId, handoff === undefined ? undefined : handoff.content),
        implementResult,
      ),
    () =>
      runtimeError({
        code: "launch_failed",
        message: "But Why? could not launch the Interactive Session.",
        help: ["Confirm Herdr is running, then retry Change Implement."],
      }),
  );
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

const runSubmit = (
  args: readonly string[],
  environment: ChangeCommandEnvironment,
): Effect.Effect<CliResult> => {
  if (args.length === 1 && args[0] === "--help") {
    return Effect.succeed(
      success({
        usage: "by change submit <change-id>",
        arguments: [{ argument: "<change-id>", description: "Ready Change ID" }],
        flags: withGlobalHelpFlags(),
        examples: ["by change submit <change-id>", "by change submit <change-id> --output json"],
      }),
    );
  }
  if (args.length !== 1 || args[0] === undefined || args[0].startsWith("-")) {
    return Effect.succeed(
      usageError({
        code: "invalid_arguments",
        message: "Change Submit requires one Change ID.",
        help: ["Run `by change submit <change-id>`."],
      }),
    );
  }
  const loaded = loadChangeSubmit({
    cwd: environment.cwd,
    globalConfigPath: environment.globalConfigPath,
    ...(environment.reviewerAgentRuntime === undefined
      ? {}
      : { reviewerAgentRuntime: environment.reviewerAgentRuntime }),
  });
  if (!loaded.ok) return Effect.succeed(loadError(loaded.error));
  return loaded.submit.submit({ changeId: args[0], now: environment.now().toISOString() }).pipe(
    Effect.map(submitResult),
    Effect.catchAll((error) => Effect.succeed(repositoryStorageErrorResult(error))),
  );
};

const submitResult = (result: ChangeSubmitResult): CliResult => {
  if (result.ok) {
    if (result.status === "nothing_to_submit") {
      return success({
        changeId: result.changeId,
        status: result.status,
        help: [`Run \`by change cancel ${result.changeId}\` to cancel this unchanged Change.`],
      });
    }
    if (result.status === "reconciled")
      return success({ status: result.status, change: result.change });
    return success({
      changeId: result.changeId,
      candidateId: result.candidateId,
      validationRunId: result.validationRunId,
      status: result.status,
      created: result.created,
      pullRequest: result.pullRequest,
    });
  }
  if (result.code === "change_not_found" || result.code === "change_not_open") {
    return runtimeError({
      code: result.code,
      message: result.code === "change_not_found" ? "Change was not found." : "Change is closed.",
      help: ["Use a Change ID returned by `by change start --output json`."],
    });
  }
  if (result.code === "change_not_ready") {
    return runtimeError({
      code: result.code,
      message: "Change is not ready for Submission.",
      details: { changeId: result.change.id, readiness: result.change.readiness },
      help: [`Run \`by change prepare ${result.change.id}\`, then retry Change Submit.`],
    });
  }
  if (result.code === "dirty_work") {
    return runtimeError({
      code: result.code,
      message: "The Change Managed Worktree has uncommitted Git-visible state.",
      help: ["Commit or remove the visible changes, then retry Change Submit."],
    });
  }
  if (result.code === "validation_findings") {
    return runtimeError({
      code: result.code,
      message: "Validation produced blocking Findings.",
      details: {
        changeId: result.changeId,
        candidateId: result.candidateId,
        validationRunId: result.validationRunId,
        findings: result.findings,
      },
      help: ["Fix the Findings in the Managed Worktree, commit them, then retry Change Submit."],
    });
  }
  if (result.code === "validation_tooling_failed") {
    return runtimeError({
      code: result.code,
      message: "Candidate validation tooling failed.",
      details: {
        changeId: result.changeId,
        candidateId: result.candidateId,
        validationRunId: result.validationRunId,
        toolingFailures: result.toolingFailures,
      },
      help: ["Fix the validation tooling failure, then retry Change Submit."],
    });
  }
  if (result.code === "validation_policy_invalid") {
    return runtimeError({
      code: result.code,
      message: result.message,
      help: ["Fix Repo Config or Global Config, then retry Change Submit."],
    });
  }
  return runtimeError({
    code: result.code,
    message: "Change Submit could not validate or publish the current Candidate.",
    ...(result.code === "reconciliation_rejected" ? { details: { change: result.change } } : {}),
    help: ["Inspect the Change, validation evidence, and owned pull request, then retry."],
  });
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
  return withChanges(environment, (changes) =>
    Effect.sync(() => {
      const result = changes.reconcile(changeId, environment.now().toISOString());
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
    }),
  );
};

const implementResult = (result: ChangeImplementResult): CliResult => {
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

const startResult = (result: ChangeStartResult): CliResult => {
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

const prepareResult = (result: ChangePrepareResult): CliResult => {
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

const withChanges = (
  environment: ChangeCommandEnvironment,
  use: (changes: ChangeUseCases) => Effect.Effect<CliResult, RepositoryStorageError>,
  unexpectedFailure: () => CliResult = () => stateStoreUnavailable("repository"),
): Effect.Effect<CliResult> =>
  withChangeUseCases(
    {
      cwd: environment.cwd,
      ...(environment.interactiveSessionHost === undefined
        ? {}
        : { interactiveSessionHost: environment.interactiveSessionHost }),
      ...(environment.interactiveSessionPath === undefined
        ? {}
        : { interactiveSessionPath: environment.interactiveSessionPath }),
    },
    use,
  ).pipe(
    Effect.map((result) => (result.ok ? result.value : loadError(result.error))),
    Effect.catchAll((error) => Effect.succeed(repositoryStorageErrorResult(error))),
    Effect.catchAllCause(() => Effect.succeed(unexpectedFailure())),
  );

const loadError = (error: { readonly code: string; readonly taskPrefix?: string }): CliResult =>
  error.code === "state_store_unavailable"
    ? stateStoreUnavailable(error.taskPrefix ?? "repository")
    : runtimeError({
        code: error.code,
        message: "But Why repository state is unavailable.",
        help: ["Run `by init --task-prefix <prefix>` in the repository."],
      });
