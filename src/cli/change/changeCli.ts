import { Effect } from "effect";

import { parseCliTaskIdValue } from "../../cliTaskId.js";
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
import type { ChangeRecord } from "../../change/change.js";
import type { CandidateValidationRunRecord } from "../../change/candidateValidation/candidateValidationRunStore.js";
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
import { resolveChangeId } from "./changeTarget.js";

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

const withResolvedChangeId = <E, R>(
  changeId: string | undefined,
  environment: ChangeCommandEnvironment,
  commandName: string,
  use: (changeId: string) => Effect.Effect<CliResult, E, R>,
): Effect.Effect<CliResult, E, R> =>
  resolveChangeId(changeId, environment.cwd, commandName).pipe(
    Effect.flatMap((resolved) =>
      resolved.ok ? use(resolved.changeId) : Effect.succeed(resolved.result),
    ),
  );

export type ChangeStartCommand = {
  readonly taskId: string | undefined;
  readonly baseBranch: string | undefined;
};

export const runStart = (
  command: ChangeStartCommand,
  environment: ChangeCommandEnvironment,
): Effect.Effect<CliResult> => {
  const parsedTaskId =
    command.taskId === undefined ? undefined : parseCliTaskIdValue(command.taskId);
  if (parsedTaskId !== undefined && !parsedTaskId.ok) return Effect.succeed(parsedTaskId.result);

  return withChanges(environment, (changes) =>
    Effect.map(
      changes.start({
        ...(parsedTaskId === undefined ? {} : { taskId: parsedTaskId.taskId }),
        ...(command.baseBranch === undefined ? {} : { baseBranch: command.baseBranch }),
        now: environment.now().toISOString(),
      }),
      startResult,
    ),
  );
};

export const runList = (
  command: { readonly all: boolean },
  environment: ChangeCommandEnvironment,
): Effect.Effect<CliResult> => {
  const loaded = loadChangeInspection({
    cwd: environment.cwd,
  });
  if (!loaded.ok) return Effect.succeed(loadError(loaded.error));
  const now = environment.now().getTime();
  return loaded.inspection
    .list({
      repositoryCommonDirectory: loaded.commonDirectory,
      includeClosed: command.all,
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

export const runShow = (
  command: { readonly changeId: string | undefined },
  environment: ChangeCommandEnvironment,
): Effect.Effect<CliResult> =>
  withResolvedChangeId(command.changeId, environment, "show", (changeId) => {
    const loaded = loadChangeInspection({
      cwd: environment.cwd,
    });
    if (!loaded.ok) return Effect.succeed(loadError(loaded.error));
    return loaded.inspection.inspect(changeId).pipe(
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
              currentValidationRun: compactValidationRunView(detail.currentValidationRun),
              findingCount: detail.findings.length,
              toolingFailureCount: detail.toolingFailures.length,
              ...(detail.findings.length === 0
                ? {}
                : { findingsCommand: `by change findings ${detail.change.id}` }),
              ...(detail.toolingFailures.length === 0
                ? {}
                : {
                    validationRunCommand: `by validation-run show ${detail.currentValidationRun?.id}`,
                  }),
              ...(detail.change.publication === null
                ? {}
                : {
                    publication: {
                      candidateId: detail.change.publication.candidateId,
                      validationRunId: detail.change.publication.validationRunId,
                      expectedHeadSha: detail.change.publication.expectedHeadSha,
                      pullRequest: detail.change.publication.pullRequest,
                    },
                  }),
              pullRequest: detail.change.publication?.pullRequest ?? null,
              cleanup: detail.change.cleanup,
            }),
      ),
      inspectionFailure,
    );
  });

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

const compactValidationRunView = (run: CandidateValidationRunRecord | null) =>
  run === null
    ? null
    : {
        id: run.id,
        candidateId: run.candidateId,
        state: run.state,
        outcome: run.outcome,
        createdAt: run.createdAt,
        updatedAt: run.updatedAt,
      };

const validationRunHistoryView = (runs: readonly CandidateValidationRunRecord[]) => {
  const outcomeCounts: Record<string, number> = {};
  let runningCount = 0;
  for (const run of runs) {
    if (run.state === "running") runningCount += 1;
    if (run.outcome !== null) outcomeCounts[run.outcome] = (outcomeCounts[run.outcome] ?? 0) + 1;
  }
  return {
    count: runs.length,
    outcomeCounts,
    runningCount,
    validationRuns: runs.map(compactValidationRunView),
    ...(runs.length === 0 ? {} : { detailCommand: "by validation-run show <validation-run-id>" }),
  };
};

const changeNotFound = (): CliResult =>
  runtimeError({
    code: "change_not_found",
    message: "Change was not found.",
    help: ["Use a Change ID returned by `by change list --all --output json`."],
  });

export const runFindings = (
  command: { readonly changeId: string | undefined },
  environment: ChangeCommandEnvironment,
): Effect.Effect<CliResult> =>
  withResolvedChangeId(command.changeId, environment, "findings", (changeId) => {
    const loaded = loadChangeInspection({
      cwd: environment.cwd,
    });
    if (!loaded.ok) return Effect.succeed(loadError(loaded.error));
    return loaded.inspection.findings(changeId).pipe(
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
  });

export const runValidationRuns = (
  command: { readonly changeId: string | undefined },
  environment: ChangeCommandEnvironment,
): Effect.Effect<CliResult> =>
  withResolvedChangeId(command.changeId, environment, "validation-runs", (changeId) => {
    const loaded = loadChangeInspection({
      cwd: environment.cwd,
    });
    if (!loaded.ok) return Effect.succeed(loadError(loaded.error));
    return loaded.inspection.validationRuns(changeId).pipe(
      Effect.map((result) =>
        result === undefined
          ? changeNotFound()
          : success(validationRunHistoryView(result.validationRuns)),
      ),
      inspectionFailure,
    );
  });

const inspectionFailure = <A>(
  effect: Effect.Effect<A, RepositoryStorageError>,
): Effect.Effect<A | CliResult> =>
  effect.pipe(
    Effect.catchAll((error) => Effect.succeed(repositoryStorageErrorResult(error))),
    Effect.catchAllCause(() => Effect.succeed(stateStoreUnavailable("repository"))),
  );

export const runPrepare = (
  command: { readonly changeId: string | undefined },
  environment: ChangeCommandEnvironment,
): Effect.Effect<CliResult> =>
  withResolvedChangeId(command.changeId, environment, "prepare", (changeId) =>
    withChanges(environment, (changes) =>
      Effect.map(changes.prepare(changeId, environment.now().toISOString()), prepareResult),
    ),
  );

export const runImplement = (
  command: { readonly changeId: string | undefined; readonly handoffFile: string | undefined },
  environment: ChangeCommandEnvironment,
): Effect.Effect<CliResult> => {
  const handoff =
    command.handoffFile === undefined
      ? undefined
      : readHandoffFile(environment.cwd, command.handoffFile, environment.stdin);
  if (handoff !== undefined && !handoff.ok) return Effect.succeed(handoffFileError(handoff.error));

  return withResolvedChangeId(command.changeId, environment, "implement", (changeId) =>
    withChanges(
      environment,
      (changes) =>
        Effect.map(
          changes.implement(changeId, handoff === undefined ? undefined : handoff.content),
          implementResult,
        ),
      () =>
        runtimeError({
          code: "launch_failed",
          message: "But Why? could not launch the Interactive Session.",
          help: ["Confirm Herdr is running, then retry Change Implement."],
        }),
    ),
  );
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

export type ChangeBlockerCommand =
  | { readonly action: "list"; readonly changeId: string }
  | { readonly action: "raise" | "resolve"; readonly changeId: string; readonly file: string };

export const runBlocker = (
  command: ChangeBlockerCommand,
  environment: ChangeCommandEnvironment,
): Effect.Effect<CliResult> => {
  const action = command.action;
  const changeId = command.changeId;
  if (action === "list") {
    const loaded = loadChangeInspection({ cwd: environment.cwd });
    if (!loaded.ok) return Effect.succeed(loadError(loaded.error));
    return loaded.inspection.blockers(changeId).pipe(
      Effect.map((history) =>
        history === undefined ? changeNotFound() : success({ changeId, ...history }),
      ),
      inspectionFailure,
    );
  }
  const content = readImplementationDecisionFile(environment.cwd, command.file, environment.stdin);
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

export type ChangeDecisionCommand =
  | { readonly action: "list"; readonly changeId: string }
  | { readonly action: "add"; readonly changeId: string; readonly file: string };

export const runDecision = (
  command: ChangeDecisionCommand,
  environment: ChangeCommandEnvironment,
): Effect.Effect<CliResult> => {
  const action = command.action;
  if (action === "list") {
    const loaded = loadChangeInspection({ cwd: environment.cwd });
    if (!loaded.ok) return Effect.succeed(loadError(loaded.error));
    return loaded.inspection.decisions(command.changeId).pipe(
      Effect.map((decisions) =>
        decisions === undefined
          ? changeNotFound()
          : success({ changeId: command.changeId, count: decisions.length, decisions }),
      ),
      inspectionFailure,
    );
  }
  {
    const content = readImplementationDecisionFile(
      environment.cwd,
      command.file,
      environment.stdin,
    );
    if (!content.ok) return Effect.succeed(decisionFileError(content.error));
    const loaded = loadChangeInspection({ cwd: environment.cwd });
    if (!loaded.ok) return Effect.succeed(loadError(loaded.error));
    return loaded.inspection
      .addDecision({
        changeId: command.changeId,
        content: content.content,
        now: environment.now().toISOString(),
      })
      .pipe(
        Effect.map((result) =>
          result.ok
            ? success({ changeId: command.changeId, decision: result.decision })
            : decisionMutationError(result.code, command.changeId),
        ),
        inspectionFailure,
      );
  }
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

export const runSubmit = (
  command: { readonly changeId: string | undefined },
  environment: ChangeCommandEnvironment,
): Effect.Effect<CliResult> =>
  withResolvedChangeId(command.changeId, environment, "submit", (changeId) => {
    const loaded = loadChangeSubmit({
      cwd: environment.cwd,
      globalConfigPath: environment.globalConfigPath,
      ...(environment.reviewerAgentRuntime === undefined
        ? {}
        : { reviewerAgentRuntime: environment.reviewerAgentRuntime }),
    });
    if (!loaded.ok) return Effect.succeed(loadError(loaded.error));
    return loaded.submit.submit({ changeId, now: environment.now().toISOString() }).pipe(
      Effect.map((result) => submitResult(result, changeId)),
      Effect.catchAll((error) => Effect.succeed(repositoryStorageErrorResult(error))),
    );
  });

type SubmitRecoveryAction =
  | "prepare_change"
  | "resolve_dirty_work"
  | "fix_validation_findings"
  | "integrate_change_base";

const submitRecovery = (
  changeId: string,
  action: SubmitRecoveryAction,
  instruction: string,
): {
  readonly authority: "change_submit";
  readonly changeId: string;
  readonly action: SubmitRecoveryAction;
  readonly instruction: string;
  readonly retryCommand: string;
} => ({
  authority: "change_submit",
  changeId,
  action,
  instruction,
  retryCommand: `by change submit ${changeId}`,
});

const submitResult = (result: ChangeSubmitResult, changeId: string): CliResult => {
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
      ...(result.code === "change_blocked"
        ? {
            details: {
              changeId,
              blockerCommand: `by change blocker list ${changeId}`,
            },
          }
        : {}),
      help:
        result.code === "change_blocked"
          ? [
              `Inspect the existing Implementation Blocker with \`by change blocker list ${changeId}\`, then report it and wait.`,
            ]
          : ["Use a Change ID returned by `by change start --output json`."],
    });
  }
  if (result.code === "change_not_ready") {
    return runtimeError({
      code: result.code,
      message: "Change is not ready for Submission.",
      details: {
        changeId: result.change.id,
        readiness: result.change.readiness,
        recovery: submitRecovery(
          result.change.id,
          "prepare_change",
          `Run \`by change prepare ${result.change.id}\`, then retry Change Submit.`,
        ),
      },
      help: [`Run \`by change prepare ${result.change.id}\`, then retry Change Submit.`],
    });
  }
  if (result.code === "dirty_work") {
    return runtimeError({
      code: result.code,
      message: "The Change Managed Worktree has uncommitted Git-visible state.",
      details: {
        changeId,
        recovery: submitRecovery(
          changeId,
          "resolve_dirty_work",
          "Commit or remove the Git-visible changes, then retry Change Submit.",
        ),
      },
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
        recovery: submitRecovery(
          result.changeId,
          "fix_validation_findings",
          "Fix every applicable Finding in the Managed Worktree, commit the fixes, then retry Change Submit.",
        ),
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
        changeId,
        branchRef: result.branchRef,
        headSha: result.headSha,
        changeBaseRef: result.changeBaseRef,
        changeBaseSha: result.changeBaseSha,
        recovery: submitRecovery(
          changeId,
          "integrate_change_base",
          "Merge or rebase the Change Base into the Repository Branch, then retry Change Submit.",
        ),
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

export const runCancel = (
  command: { readonly changeId: string | undefined },
  environment: ChangeCommandEnvironment,
): Effect.Effect<CliResult> =>
  withResolvedChangeId(command.changeId, environment, "cancel", (changeId) =>
    withCancellation(
      {
        cwd: environment.cwd,
        ...(environment.cancellationUseCases === undefined
          ? {}
          : { cancellationUseCases: environment.cancellationUseCases }),
      },
      (cancellation) =>
        Effect.map(
          cancellation.cancelChange({
            changeId,
            now: environment.now().toISOString(),
          }),
          changeCancelResult,
        ),
    ),
  );

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

export const runReconcile = (
  command: { readonly changeId: string | undefined },
  environment: ChangeCommandEnvironment,
): Effect.Effect<CliResult> => {
  const changeId = command.changeId;
  return withChanges(environment, (changes) =>
    Effect.map(changes.reconcile(changeId, environment.now().toISOString()), (result) =>
      reconcileResult(changeId, result),
    ),
  );
};

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
