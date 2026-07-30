import { Effect } from "effect";

import { runCommandTree } from "./cliCommandTree.js";
import { runtimeError, type CliResult } from "./cliResults.js";
import { collapseHome } from "./cli/cliPath.js";
import { dashboard } from "./cli/task/dashboard.js";
import type { OutputFormat } from "./output/structured.js";
import type { InteractiveSessionHost } from "./change/interactiveSessionHost.js";
import type { ReviewerAgentRuntime } from "./agent/reviewerAgentRuntime.js";
import type { TaskUseCases } from "./task/taskUseCases.js";
import type { CancellationUseCases } from "./change/cancelChange.js";
import type { TextInputStdin } from "./cli/input/textInput.js";

export type { CliResult } from "./cliResults.js";
export { collapseHome } from "./cli/cliPath.js";

export type CliEnvironment = {
  readonly executablePath: string;
  readonly cwd: string;
  readonly globalConfigPath: string;
  readonly now: () => Date;
  readonly stdin: TextInputStdin;
  readonly taskUseCases?: TaskUseCases;
  readonly cancellationUseCases?: CancellationUseCases;
  readonly reviewerAgentRuntime?: ReviewerAgentRuntime;
  readonly interactiveSessionHost?: InteractiveSessionHost;
  readonly interactiveSessionPath?: string;
};

export const runCli = (
  args: readonly string[],
  environment: CliEnvironment,
): Effect.Effect<CliResult> =>
  args.length === 0
    ? dashboard(
        collapseHome(environment.executablePath),
        "Validate completed code changes against approved human intent.",
        environment,
      )
    : runCommandTree(args, environment);

export const mapRuntimeError = (outputFormat: OutputFormat = "toon"): CliResult => ({
  ...runtimeError({
    code: "internal_error",
    message: "The command failed unexpectedly",
    help: ["Report this failure with the command and workspace path"],
  }),
  outputFormat,
});
