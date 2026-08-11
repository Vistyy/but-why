import type { Effect } from "effect";
import type { ReviewerAgentRuntime } from "./agent/reviewerAgentRuntime.js";
import type { ReviewerOutput } from "./agent/reviewerOutput.js";
import type { CancellationUseCases } from "./change/cancelChange.js";
import type { InteractiveSessionHost } from "./change/interactiveSession/interactiveSessionHost.js";
import type { TextInputStdin } from "./cli/input/textInput.js";
import { runCommandTree } from "./cliCommandTree.js";
import { type CliResult, runtimeError } from "./cliResults.js";
import type {
  TaskReviewInspectionUseCases,
  TaskReviewRecoveryUseCases,
  TaskReviewSubmissionUseCases,
} from "./task/review/taskReviewUseCases.js";
import type { TaskUseCases } from "./task/taskUseCases.js";

export type { CliResult } from "./cliResults.js";
export type CliEnvironment = {
  readonly executablePath: string;
  readonly cwd: string;
  readonly globalConfigPath: string;
  readonly now: () => Date;
  readonly stdin: TextInputStdin;
  readonly taskUseCases?: TaskUseCases;
  readonly taskReviewInspectionUseCases?: TaskReviewInspectionUseCases;
  readonly taskReviewRecoveryUseCases?: TaskReviewRecoveryUseCases;
  readonly taskReviewSubmissionUseCases?: TaskReviewSubmissionUseCases;
  readonly cancellationUseCases?: CancellationUseCases;
  readonly reviewerAgentRuntime?: ReviewerAgentRuntime<ReviewerOutput>;
  readonly interactiveSessionHost?: InteractiveSessionHost;
  readonly writeStderr?: (message: string) => void;
};

export const runCli = (
  args: readonly string[],
  environment: CliEnvironment,
): Effect.Effect<CliResult> => runCommandTree(args, environment);

export const mapRuntimeError = (): CliResult =>
  runtimeError({
    code: "internal_error",
    message: "The command failed unexpectedly",
    help: ["Report this failure with the command and workspace path"],
  });
