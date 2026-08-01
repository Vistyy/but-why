// fallow-ignore-file duplicate-export -- dynamically loaded command owner
// @ts-nocheck
// fallow-ignore-file unused-export -- dynamically imported by the CLI

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
import { stderrSubmitProgress } from "../../change/validation/submitProgress.js";
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
import { structuredContractDiagnostics } from "../../output/contractDiagnostics.js";
import { resolveChangeId } from "./changeTarget.js";

export type ChangeCommandEnvironment = {
  readonly cwd: string;
  readonly globalConfigPath: string;
  readonly now: () => Date;
  readonly stdin: TextInputStdin;
  readonly writeStderr?: (message: string) => void;
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

import * as support from "./changeSupport.js";

type ChangeBlockerCommand =
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
    if (!loaded.ok) return Effect.succeed(support.loadError(loaded.error));
    return loaded.inspection.blockers(changeId).pipe(
      Effect.map((history) =>
        history === undefined ? support.changeNotFound() : success({ changeId, ...history }),
      ),
      support.inspectionFailure,
    );
  }
  const content = readImplementationDecisionFile(environment.cwd, command.file, environment.stdin);
  if (!content.ok) return Effect.succeed(support.decisionFileError(content.error));
  const loaded = loadChangeInspection({ cwd: environment.cwd });
  if (!loaded.ok) return Effect.succeed(support.loadError(loaded.error));
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
    support.inspectionFailure,
  );
};
