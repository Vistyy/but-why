import { Effect } from "effect";

import { parseCliTaskIdValue } from "../../cliTaskId.js";
import { withGlobalHelpFlags } from "../../cliHelp.js";
import {
  repositoryStorageErrorResult,
  repoStateLoadError,
  runtimeError,
  stateStoreUnavailable,
  success,
  usageError,
  type CliResult,
} from "../../cliResults.js";
import { readHandoffFile, type HandoffFileReadError } from "../../change/handoffFile.js";
import {
  readImplementationDecisionFile,
  type ImplementationDecisionFileError,
} from "../../change/implementationDecisionFile.js";
import { loadChangeInspection } from "../../change/loadChangeInspection.js";
import { withChangeUseCases } from "../../change/loadChangeUseCases.js";
import { loadChangeSubmit } from "../../change/loadChangeSubmit.js";
import type { ChangeCancellationResult, CancellationUseCases } from "../../change/cancelChange.js";
import { withCancellation } from "../../change/loadChangeCancellation.js";
import type { InteractiveSessionHost } from "../../change/interactiveSessionHost.js";
import type { ReviewerAgentRuntime } from "../../agent/reviewerAgentRuntime.js";
import type { PublicTaskId } from "../../task/taskId.js";
import type { ChangeRecord } from "../../change/change.js";
import type { ChangeReconciliationResult } from "../../change/reconcileChange.js";
import type { ChangeSubmitResult } from "../../change/submitChange.js";
import type {
  ChangeImplementResult,
  ChangePrepareResult,
  ChangeStartResult,
  ChangeUseCases,
} from "../../change/changeUseCases.js";
import type { RepositoryStorageError } from "../../contracts/repositoryStorageError.js";
import type { RepoStateLoadError } from "../../cliResults.js";
import type { TextInputStdin } from "../../cli/input/textInput.js";
import { structuredValue } from "../../output/structuredValue.js";

export type ChangeCommandEnvironment = {
  readonly cwd: string;
  readonly globalConfigPath: string;
  readonly now: () => Date;
  readonly stdin: TextInputStdin;
  readonly reviewerAgentRuntime?: ReviewerAgentRuntime;
  readonly interactiveSessionHost?: InteractiveSessionHost;
  readonly interactiveSessionPath?: string;
  readonly cancellationUseCases?: CancellationUseCases;
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
            command: "by change start [--task <task-id>] [--base <branch>]",
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
            command: "by change cancel <change-id>",
            description: "Cancel an open taskless Change.",
          },
          {
            command: "by change reconcile [<change-id>]",
            description: "Read owned pull requests and clean up terminal Changes.",
          },
          {
            command: "by change implement <change-id> [--handoff-file <path>]",
            description: "Launch an Interactive Session in a ready Change worktree.",
          },
          {
            command: "by change decision add <change-id> --file <path>",
            description: "Record one Implementer Implementation Decision.",
          },
          {
            command: "by change blocker raise <change-id> --file <path>",
            description: "Report an Implementation Blocker.",
          },
          {
            command: "by change blocker resolve <change-id> --file <path>",
            description: "Record an approved Implementation Blocker Resolution.",
          },
          {
            command: "by change blocker list <change-id>",
            description: "List blocker and Resolution history.",
          },
          {
            command: "by change decision list <change-id>",
            description: "List the Change Implementation Decision Log.",
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
  if (subcommand === "decision") return runDecision(args.slice(1), environment);
  if (subcommand === "blocker") return runBlocker(args.slice(1), environment);
  if (subcommand === "submit") return runSubmit(args.slice(1), environment);
  if (subcommand === "cancel") return runCancel(args.slice(1), environment);
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
        usage: "by change start [--task <task-id>] [--base <branch>]",
        flags: withGlobalHelpFlags([
          {
            flag: "--task <task-id>",
            description: "Link one approved Task with satisfied prerequisites.",
          },
          {
            flag: "--base <branch>",
            description: "Use this freshly fetched publication-remote branch as the Change Base.",
          },
        ]),
        examples: [
          "by change start",
          "by change start --task BY-1",
          "by change start --base release --output json",
        ],
      }),
    );
  }
  const parsed = parseStartArgs(args);
  if (!parsed.ok) return Effect.succeed(parsed.result);

  return withChanges(environment, (changes) =>
    Effect.map(
      changes.start({
        ...(parsed.taskId === undefined ? {} : { taskId: parsed.taskId }),
        ...(parsed.baseBranch === undefined ? {} : { baseBranch: parsed.baseBranch }),
        now: environment.now().toISOString(),
      }),
      startResult,
    ),
  );
};

type StartArgsParseResult =
  | {
      readonly ok: true;
      readonly taskId: PublicTaskId | undefined;
      readonly baseBranch: string | undefined;
    }
  | { readonly ok: false; readonly result: CliResult };

const parseStartArgs = (args: readonly string[]): StartArgsParseResult => {
  let taskId: PublicTaskId | undefined;
  let baseBranch: string | undefined;
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];
    if (value === undefined || value.startsWith("-")) return invalidStartArgs();
    if (flag === "--task" && taskId === undefined) {
      const parsed = parseCliTaskIdValue(value);
      if (!parsed.ok) return { ok: false, result: parsed.result };
      taskId = parsed.taskId;
    } else if (flag === "--base" && baseBranch === undefined) {
      baseBranch = value;
    } else {
      return invalidStartArgs();
    }
  }
  return { ok: true, taskId, baseBranch };
};

const invalidStartArgs = (): StartArgsParseResult => ({
  ok: false,
  result: usageError({
    code: "invalid_arguments",
    message: "Change Start accepts optional --task <task-id> and --base <branch> flags.",
    help: ["Run `by change start [--task <task-id>] [--base <branch>]`."],
  }),
});

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
  const now = environment.now().getTime();
  return loaded.inspection
    .list({
      repositoryCommonDirectory: loaded.commonDirectory,
      includeClosed: args[0] === "--all",
    })
    .pipe(
      Effect.map((changes) =>
        success({
          changes: changes.map((change) => ({
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
      ),
      inspectionFailure,
    );
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
  return loaded.inspection.inspect(args[0]).pipe(
    Effect.map((detail) =>
      detail === undefined
        ? changeNotFound()
        : success({
            change: changeInspectionView(detail.change),
            ...(detail.change.implementationDecisions === undefined ||
            detail.change.implementationDecisions.length === 0
              ? {}
              : { implementationDecisions: detail.change.implementationDecisions }),
            currentCandidate: detail.currentCandidate,
            currentValidationRun: structuredValue(detail.currentValidationRun),
            findings: detail.findings,
            toolingFailures: detail.toolingFailures,
            pullRequest: detail.change.publication?.pullRequest ?? null,
            cleanup: detail.change.cleanup,
          }),
    ),
    inspectionFailure,
  );
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
  ...(change.implementationDecisions === undefined || change.implementationDecisions.length === 0
    ? {}
    : { implementationDecisions: change.implementationDecisions }),
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
  return loaded.inspection.findings(changeId.changeId).pipe(
    Effect.map((result) =>
      result === undefined
        ? changeNotFound()
        : success({
            change: changeInspectionView(result.change),
            candidate: result.candidate,
            validationRun: structuredValue(result.validationRun),
            findings: result.findings,
            toolingFailures: result.toolingFailures,
            count: result.findings.length,
          }),
    ),
    inspectionFailure,
  );
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
  return loaded.inspection.validationRuns(changeId.changeId).pipe(
    Effect.map((result) =>
      result === undefined
        ? changeNotFound()
        : success({ validationRuns: structuredValue(result.validationRuns) }),
    ),
    inspectionFailure,
  );
};

const inspectionFailure = <A>(
  effect: Effect.Effect<A, RepositoryStorageError>,
): Effect.Effect<A | CliResult> =>
  effect.pipe(
    Effect.catchAll((error) => Effect.succeed(repositoryStorageErrorResult(error))),
    Effect.catchAllCause(() => Effect.succeed(stateStoreUnavailable("repository"))),
  );

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
          {
            flag: "--handoff-file <path>",
            description: "Optional compact UTF-8 handoff file; use - for piped stdin",
          },
        ]),
        examples: [
          "by change implement <change-id>",
          "by change implement <change-id> --handoff-file /tmp/handoff.md --output json",
          'printf "Handoff" | by change implement <change-id> --handoff-file -',
        ],
      }),
    );
  }
  const parsed = parseImplementArgs(args);
  if (!parsed.ok) return Effect.succeed(parsed.result);
  const handoff =
    parsed.handoffFile === undefined
      ? undefined
      : readHandoffFile(environment.cwd, parsed.handoffFile, environment.stdin);
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
    case "stdin_is_terminal":
      return usageError({
        code: error.code,
        message: "Standard input is an interactive terminal.",
        help: ["Pipe UTF-8 text or use a shell heredoc with --handoff-file -."],
      });
  }
};

const runBlocker = (
  args: readonly string[],
  environment: ChangeCommandEnvironment,
): Effect.Effect<CliResult> => {
  const action = args[0];
  if (args.length === 1 && action === "--help")
    return Effect.succeed(
      success({
        usage: "by change blocker <raise|resolve|list> <change-id> [--file <path>]",
        commands: [
          {
            command: "by change blocker raise <change-id> --file <path>",
            description: "Report a blocker.",
          },
          {
            command: "by change blocker resolve <change-id> --file <path>",
            description: "Approve a resolution.",
          },
          { command: "by change blocker list <change-id>", description: "List blocker history." },
        ],
        flags: withGlobalHelpFlags(),
      }),
    );
  const changeId = args[1];
  if (action === "list") {
    if (changeId === undefined || args.length !== 2)
      return Effect.succeed(
        usageError({
          code: "invalid_arguments",
          message: "Blocker List requires one Change ID.",
          help: ["Run `by change blocker list <change-id>`."],
        }),
      );
    const loaded = loadChangeInspection({ cwd: environment.cwd });
    if (!loaded.ok) return Effect.succeed(loadError(loaded.error));
    return loaded.inspection.blockers(changeId).pipe(
      Effect.map((history) =>
        history === undefined ? changeNotFound() : success({ changeId, ...history }),
      ),
      inspectionFailure,
    );
  }
  if (action !== "raise" && action !== "resolve")
    return Effect.succeed(
      usageError({
        code: "unknown_command",
        message: `Unknown blocker command: ${action ?? ""}`,
        help: ["Run `by change blocker --help`."],
      }),
    );
  if (changeId === undefined || args.length !== 4 || args[2] !== "--file" || args[3] === undefined)
    return Effect.succeed(
      usageError({
        code: "invalid_arguments",
        message: "Blocker mutation requires <change-id> --file <path>.",
        help: [`Run by change blocker ${action} <change-id> --file <path>.`],
      }),
    );
  const content = readImplementationDecisionFile(environment.cwd, args[3], environment.stdin);
  if (!content.ok) return Effect.succeed(decisionFileError(content.error));
  const loaded = loadChangeInspection({ cwd: environment.cwd });
  if (!loaded.ok) return Effect.succeed(loadError(loaded.error));
  const operation =
    action === "raise" ? loaded.inspection.raiseBlocker : loaded.inspection.resolveBlocker;
  return operation({
    changeId,
    content: content.content,
    now: environment.now().toISOString(),
  }).pipe(
    Effect.map((result) =>
      result.ok
        ? success({ changeId, blocker: result.blocker, change: result.change })
        : runtimeError({
            code: result.code,
            message: `Cannot ${action} an Implementation Blocker in this Change.`,
            details: { changeId },
            help: ["Inspect the Change and use the applicable blocker lifecycle command."],
          }),
    ),
    inspectionFailure,
  );
};

const runDecision = (
  args: readonly string[],
  environment: ChangeCommandEnvironment,
): Effect.Effect<CliResult> => {
  const action = args[0];
  if (args.length === 1 && action === "--help") {
    return Effect.succeed(
      success({
        usage: "by change decision <add|list> <change-id> [--file <path>]",
        commands: [
          {
            command: "by change decision add <change-id> --file <path>",
            description: "Append one Markdown decision.",
          },
          {
            command: "by change decision list <change-id>",
            description: "List decisions in sequence order.",
          },
        ],
        flags: withGlobalHelpFlags(),
      }),
    );
  }
  if (action === "list") {
    if (args.length === 2 && args[1] === "--help") {
      return Effect.succeed(
        success({
          usage: "by change decision list <change-id>",
          flags: withGlobalHelpFlags(),
          examples: ["by change decision list <change-id>"],
        }),
      );
    }
    if (args.length === 2 && args[1] !== undefined && !args[1].startsWith("-")) {
      const decisionChangeId = args[1];
      const loaded = loadChangeInspection({ cwd: environment.cwd });
      if (!loaded.ok) return Effect.succeed(loadError(loaded.error));
      return loaded.inspection.decisions(decisionChangeId).pipe(
        Effect.map((decisions) =>
          decisions === undefined
            ? changeNotFound()
            : success({ changeId: decisionChangeId, count: decisions.length, decisions }),
        ),
        inspectionFailure,
      );
    }
    return Effect.succeed(
      usageError({
        code: "invalid_arguments",
        message: "Change Decision List requires one Change ID.",
        help: ["Run `by change decision list <change-id>`."],
      }),
    );
  }
  if (action === "add") {
    if (args.length === 2 && args[1] === "--help") {
      return Effect.succeed(
        success({
          usage: "by change decision add <change-id> --file <path>",
          flags: withGlobalHelpFlags([
            { flag: "--file <path>", description: "UTF-8 Markdown file; use - for stdin." },
          ]),
          examples: [
            "by change decision add <change-id> --file decision.md",
            "printf 'Reason' | by change decision add <change-id> --file -",
          ],
        }),
      );
    }
    const changeId = args[1];
    const file = args[2] === "--file" ? args[3] : undefined;
    if (
      changeId === undefined ||
      changeId.startsWith("-") ||
      file === undefined ||
      args.length !== 4
    ) {
      return Effect.succeed(
        usageError({
          code: "invalid_arguments",
          message: "Change Decision Add requires <change-id> --file <path>.",
          help: ["Run `by change decision add <change-id> --file <path>`."],
        }),
      );
    }
    const content = readImplementationDecisionFile(environment.cwd, file, environment.stdin);
    if (!content.ok) return Effect.succeed(decisionFileError(content.error));
    const loaded = loadChangeInspection({ cwd: environment.cwd });
    if (!loaded.ok) return Effect.succeed(loadError(loaded.error));
    return loaded.inspection
      .addDecision({ changeId, content: content.content, now: environment.now().toISOString() })
      .pipe(
        Effect.map((result) =>
          result.ok
            ? success({ changeId, decision: result.decision })
            : decisionMutationError(result.code, changeId),
        ),
        inspectionFailure,
      );
  }
  return Effect.succeed(
    usageError({
      code: "unknown_command",
      message: `Unknown decision command: ${action ?? ""}`,
      help: ["Run `by change decision --help`."],
    }),
  );
};

const decisionMutationError = (code: string, changeId: string): CliResult =>
  runtimeError({
    code,
    message:
      code === "change_not_found"
        ? "Change was not found."
        : code === "change_published"
          ? "The owned pull request is already published."
          : "Change is closed.",
    details: { changeId },
    help: [
      code === "change_published"
        ? "Record decisions before Change Submit publishes the owned pull request."
        : "Use an open unpublished Change ID.",
    ],
  });

const decisionFileError = (error: ImplementationDecisionFileError): CliResult =>
  runtimeError({
    code: error.code,
    message:
      error.code === "stdin_is_terminal"
        ? "Standard input is an interactive terminal."
        : "Implementation Decision content could not be read.",
    details: "path" in error ? { path: error.path } : {},
    help: [
      error.code === "stdin_is_terminal"
        ? "Pipe UTF-8 Markdown or use a regular file."
        : "Provide a bounded UTF-8 Markdown file with `--file <path>`.",
    ],
  });

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
    if (result.status === "no_change")
      return success({
        changeId: result.changeId,
        candidateId: result.candidateId,
        validationRunId: result.validationRunId,
        status: result.status,
        completionKind: result.completionKind,
        ...(result.reviewerEvidence === undefined
          ? {}
          : { reviewerEvidence: result.reviewerEvidence }),
        ...(result.specialistReviewerEvidence === undefined
          ? {}
          : { specialistReviewerEvidence: result.specialistReviewerEvidence }),
      });
    return success({
      changeId: result.changeId,
      candidateId: result.candidateId,
      validationRunId: result.validationRunId,
      status: result.status,
      created: result.created,
      pullRequest: result.pullRequest,
      ...(result.reviewerEvidence === undefined
        ? {}
        : { reviewerEvidence: result.reviewerEvidence }),
      ...(result.specialistReviewerEvidence === undefined
        ? {}
        : { specialistReviewerEvidence: result.specialistReviewerEvidence }),
    });
  }
  if (
    result.code === "change_not_found" ||
    result.code === "change_not_open" ||
    result.code === "change_blocked"
  ) {
    return runtimeError({
      code: result.code,
      message:
        result.code === "change_not_found"
          ? "Change was not found."
          : result.code === "change_blocked"
            ? "Change is blocked by an active Implementation Blocker."
            : "Change is closed.",
      help:
        result.code === "change_blocked"
          ? ["Inspect and resolve the blocker, or cancel the Change."]
          : ["Use a Change ID returned by `by change start --output json`."],
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
        ...(result.reviewerEvidence === undefined
          ? {}
          : { reviewerEvidence: result.reviewerEvidence }),
        ...(result.specialistReviewerEvidence === undefined
          ? {}
          : { specialistReviewerEvidence: result.specialistReviewerEvidence }),
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
        ...(result.reviewerEvidence === undefined
          ? {}
          : { reviewerEvidence: result.reviewerEvidence }),
        ...(result.specialistReviewerEvidence === undefined
          ? {}
          : { specialistReviewerEvidence: result.specialistReviewerEvidence }),
      },
      help: ["Fix the validation tooling failure, then retry Change Submit."],
    });
  }
  if (result.code === "change_base_not_ancestor") {
    return runtimeError({
      code: result.code,
      message: "The Repository Branch does not contain the freshly fetched Change Base.",
      details: {
        branchRef: result.branchRef,
        headSha: result.headSha,
        changeBaseRef: result.changeBaseRef,
        changeBaseSha: result.changeBaseSha,
      },
      help: [
        "Merge or rebase the Change Base into the Repository Branch, then retry Change Submit.",
      ],
    });
  }
  if (result.code === "validation_policy_invalid") {
    return runtimeError({
      code: result.code,
      message: result.message,
      help: ["Fix Repo Config or Global Config, then retry Change Submit."],
    });
  }
  if (
    result.code === "publication_remote_missing" ||
    result.code === "publication_remote_ambiguous" ||
    result.code === "publication_remote_unreachable" ||
    result.code === "remote_default_branch_missing" ||
    result.code === "remote_branch_missing" ||
    result.code === "invalid_remote_change_base" ||
    result.code === "publication_remote_changed"
  ) {
    return remoteChangeBaseError(result, "Submit");
  }
  return runtimeError({
    code: result.code,
    message: "Change Submit could not validate or publish the current Candidate.",
    ...(result.code === "reconciliation_rejected" ? { details: { change: result.change } } : {}),
    help: ["Inspect the Change, validation evidence, and owned pull request, then retry."],
  });
};

const runCancel = (
  args: readonly string[],
  environment: ChangeCommandEnvironment,
): Effect.Effect<CliResult> => {
  if (args.length === 1 && args[0] === "--help") {
    return Effect.succeed(
      success({
        usage: "by change cancel <change-id>",
        arguments: [{ argument: "<change-id>", description: "Open taskless Change ID" }],
        flags: withGlobalHelpFlags(),
        examples: ["by change cancel <change-id>", "by change cancel <change-id> --output json"],
      }),
    );
  }
  if (args.length !== 1 || args[0] === undefined || args[0].startsWith("-")) {
    return Effect.succeed(
      usageError({
        code: "invalid_arguments",
        message: "Change Cancel requires one Change ID.",
        help: ["Run `by change cancel <change-id>`."],
      }),
    );
  }
  return withCancellation(
    {
      cwd: environment.cwd,
      ...(environment.cancellationUseCases === undefined
        ? {}
        : { cancellationUseCases: environment.cancellationUseCases }),
    },
    (cancellation) =>
      Effect.map(
        cancellation.cancelChange({
          changeId: args[0] as string,
          now: environment.now().toISOString(),
        }),
        changeCancelResult,
      ),
  );
};

const changeCancelResult = (result: ChangeCancellationResult): CliResult => {
  if (result.ok) {
    return success({
      status: result.status,
      changed: result.changed,
      change: {
        id: result.change.id,
        state: result.change.state,
        closeReason: result.change.closeReason,
        cleanup: result.change.cleanup,
      },
      ...(result.task === null ? {} : { task: { id: result.task.id, state: result.task.state } }),
    });
  }
  if (result.code === "change_not_found") {
    return runtimeError({
      code: result.code,
      message: "Change was not found.",
      details: { changeId: result.changeId },
      help: ["Use a Change ID returned by `by change start --output json`."],
    });
  }
  if (result.code === "task_backed_change") {
    return runtimeError({
      code: result.code,
      message: "Task-backed Changes must be cancelled through their Task.",
      details: {
        changeId: result.changeId,
        ...(result.taskId === undefined ? {} : { taskId: result.taskId }),
      },
      help: [`Run \`by task cancel ${result.taskId} --reason <reason>\`.`],
    });
  }
  if (result.code === "github_close_failed") {
    return runtimeError({
      code: result.code,
      message: "The owned pull request could not be closed, so the Change remains open.",
      details: { changeId: result.changeId },
      help: ["Resolve the GitHub issue, then retry Change Cancel."],
    });
  }
  if (result.code === "github_pull_request_unavailable") {
    return runtimeError({
      code: result.code,
      message: "The owned pull request could not be read, so the Change remains open.",
      details: { changeId: result.changeId },
      help: ["Restore GitHub access, then retry Change Cancel."],
    });
  }
  if (result.code === "owned_pull_request_mismatch") {
    return runtimeError({
      code: result.code,
      message: "The owned pull request does not match the recorded Change facts.",
      details: { changeId: result.changeId },
      help: ["Inspect the Change and resolve the remote mismatch before retrying."],
    });
  }
  return runtimeError({
    code: result.code,
    message: "The Change was already completed and cannot be cancelled.",
    details: { changeId: result.changeId },
    help: ["Inspect the Change with `by change show <change-id>`."],
  });
};

const runReconcile = (
  args: readonly string[],
  environment: ChangeCommandEnvironment,
): Effect.Effect<CliResult> => {
  if (isReconcileHelp(args)) return Effect.succeed(reconcileHelp());
  if (hasInvalidReconcileArguments(args)) {
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
    Effect.map(changes.reconcile(changeId, environment.now().toISOString()), (result) =>
      reconcileResult(changeId, result),
    ),
  );
};

const isReconcileHelp = (args: readonly string[]): boolean =>
  args.length === 1 && args[0] === "--help";

const hasInvalidReconcileArguments = (args: readonly string[]): boolean =>
  args.length > 1 || args[0]?.startsWith("-") === true;

const reconcileHelp = (): CliResult =>
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
  });

const reconcileResult = (
  changeId: string | undefined,
  result: ChangeReconciliationResult,
): CliResult => {
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
};

const implementResult = (result: ChangeImplementResult): CliResult => {
  if (result.ok) {
    return success({
      changeId: result.change.id,
      worktreePath: result.change.worktreePath,
      host: result.host,
      status: result.status,
      ...(result.agentProfile === undefined
        ? {}
        : { agentProfile: result.agentProfile, profileScope: result.profileScope }),
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
  if (result.code === "agent_environment_invalid") {
    return runtimeError({
      code: result.code,
      message: result.message,
      details: { changeId: result.change.id, worktreePath: result.change.worktreePath },
      help: ["Fix Repo Config in the Managed Worktree, then retry Change Implement."],
    });
  }
  if (result.code === "agent_profile_invalid") {
    return runtimeError({
      code: result.code,
      message: result.message,
      details: { changeId: result.change.id, worktreePath: result.change.worktreePath },
      help: ["Fix the selected Agent Profile, then retry Change Implement."],
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
        ...(result.code === "launch_failed" || result.code === "launch_indeterminate"
          ? result.evidence === undefined
            ? {}
            : { evidence: result.evidence }
          : {}),
      },
      help:
        result.code === "launch_indeterminate"
          ? ["Inspect the existing Herdr session, then retry only after launch state is resolved."]
          : ["Confirm Herdr is installed and running, then retry Change Implement."],
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
  if (result.code === "requested_base_conflict") {
    return runtimeError({
      code: result.code,
      message: "The existing Task-backed Change uses a different Change Base branch.",
      details: {
        ...(result.requestedBaseBranch === undefined
          ? {}
          : { requestedBaseBranch: result.requestedBaseBranch }),
        ...(result.recordedBaseBranch === undefined
          ? {}
          : { recordedBaseBranch: result.recordedBaseBranch }),
      },
      help: ["Retry Change Start without --base and continue the existing Change."],
    });
  }
  if (
    result.code === "publication_remote_missing" ||
    result.code === "publication_remote_ambiguous" ||
    result.code === "publication_remote_unreachable" ||
    result.code === "remote_default_branch_missing" ||
    result.code === "remote_branch_missing" ||
    result.code === "invalid_remote_change_base" ||
    result.code === "publication_remote_changed"
  ) {
    return remoteChangeBaseError(result, "Start");
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

const remoteChangeBaseError = (
  result: Extract<
    ChangeStartResult | ChangeSubmitResult,
    {
      readonly code:
        | "publication_remote_missing"
        | "publication_remote_ambiguous"
        | "publication_remote_unreachable"
        | "remote_default_branch_missing"
        | "remote_branch_missing"
        | "invalid_remote_change_base"
        | "publication_remote_changed";
    }
  >,
  operation: "Start" | "Submit",
): CliResult => {
  const details = {
    ...(result.code === "publication_remote_ambiguous" ? { remoteNames: result.remoteNames } : {}),
    ...(result.code === "publication_remote_unreachable" ||
    result.code === "remote_default_branch_missing" ||
    result.code === "remote_branch_missing"
      ? { remoteName: result.remoteName }
      : {}),
    ...(result.code === "remote_branch_missing" ? { branchName: result.branchName } : {}),
    ...(result.code === "invalid_remote_change_base" ? { baseRef: result.baseRef } : {}),
    ...(result.code === "publication_remote_changed"
      ? {
          remoteName: result.remoteName,
          expectedRemoteUrl: result.expectedRemoteUrl,
          actualRemoteUrl: result.actualRemoteUrl,
        }
      : {}),
  };
  return runtimeError({
    code: result.code,
    message: `Change ${operation} could not fetch the selected remote Change Base.`,
    details,
    help: [
      operation === "Start"
        ? "Fix the publication remote or publish the selected branch, then retry Change Start."
        : "Restore the recorded publication remote and branch, then retry Change Submit.",
    ],
  });
};

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
    help:
      code === "managed_worktree_path_unavailable"
        ? [
            `Make the parent directory writable, then run \`by change prepare ${change?.id ?? "<change-id>"}\`.`,
            `Create the expected directory with suitable ownership, then run \`by change prepare ${change?.id ?? "<change-id>"}\`.`,
            "Move the repository to a writable parent, then start a new Change.",
          ]
        : [
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
      globalConfigPath: environment.globalConfigPath,
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

const loadError = (error: RepoStateLoadError): CliResult => repoStateLoadError(error);
