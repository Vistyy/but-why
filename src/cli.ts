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
  isDashboardInvocation(args)
    ? dashboard(
        collapseHome(environment.executablePath),
        "Validate completed code changes against approved human intent.",
        environment,
      ).pipe(Effect.map((result) => ({ ...result, outputFormat: dashboardOutputFormat(args) })))
    : runCommandTree(args, environment);

const isDashboardInvocation = (args: readonly string[]): boolean => {
  if (args.length === 0) return true;
  if (args.length === 2 && (args[0] === "--output" || args[0] === "-o")) {
    return args[1] === "toon" || args[1] === "json";
  }
  const selector = args[0];
  return (
    args.length === 1 &&
    typeof selector === "string" &&
    (selector.startsWith("--output=") || selector.startsWith("-o=")) &&
    (selector.endsWith("=toon") || selector.endsWith("=json"))
  );
};

const dashboardOutputFormat = (args: readonly string[]): OutputFormat => {
  const selector = args[0] === "--output" || args[0] === "-o" ? args[1] : args[0];
  return selector?.endsWith("=json") || selector === "json" ? "json" : "toon";
};

export const mapRuntimeError = (outputFormat: OutputFormat = "toon"): CliResult => ({
  ...runtimeError({
    code: "internal_error",
    message: "The command failed unexpectedly",
    help: ["Report this failure with the command and workspace path"],
  }),
  outputFormat,
});
