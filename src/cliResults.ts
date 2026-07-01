import type { LoadRepoLocalContextError } from "./init/repoContext.js";
import type { OutputFormat, StructuredObject } from "./output/structured.js";
import { structuredError, type StructuredErrorInput } from "./cliError.js";

export type CliResult = CliSuccessResult | CliRuntimeErrorResult | CliUsageErrorResult;

export type CliSuccessResult = {
  readonly exitCode: 0;
  readonly stdout: StructuredObject;
  readonly outputFormat?: OutputFormat;
};

export type CliRuntimeErrorResult = {
  readonly exitCode: 1;
  readonly stdout: StructuredObject;
  readonly outputFormat?: OutputFormat;
};

export type CliUsageErrorResult = {
  readonly exitCode: 2;
  readonly stdout: StructuredObject;
  readonly outputFormat?: OutputFormat;
};

export type RepoStateLoadError =
  | LoadRepoLocalContextError
  | {
      readonly code: "state_store_unavailable";
      readonly taskPrefix?: string;
    };

/**
 * CLI routes should construct serializer-facing results here.
 * Keep TOON and JSON serialization outside domain modules and future validation workspace code.
 */
export const success = (stdout: StructuredObject): CliSuccessResult => ({
  exitCode: 0,
  stdout,
});

export const usageError = (input: StructuredErrorInput): CliUsageErrorResult => ({
  exitCode: 2,
  stdout: structuredError(input),
});

export const runtimeError = (input: StructuredErrorInput): CliRuntimeErrorResult => ({
  exitCode: 1,
  stdout: structuredError(input),
});

export const repoStateLoadError = (error: RepoStateLoadError): CliResult => {
  switch (error.code) {
    case "not_initialized":
      return notInitialized();
    case "invalid_repo_config":
      return invalidRepoConfig();
    case "state_store_unavailable":
      return stateStoreUnavailable(error.taskPrefix);
  }
};

export const notInitialized = (): CliResult =>
  runtimeError({
    code: "not_initialized",
    message: "This workspace is not initialized for But Why?.",
    help: ["Run `by init --task-prefix BY` in the repository root."],
  });

export const invalidRepoConfig = (): CliResult =>
  runtimeError({
    code: "invalid_repo_config",
    message: ".but-why/config.json is not valid But Why? repo config.",
    details: { path: ".but-why/config.json" },
    help: ["Fix the JSON or run `by init --task-prefix <prefix>` after moving it aside."],
  });

export const stateStoreUnavailable = (taskPrefix: string | undefined): CliResult =>
  runtimeError({
    code: "state_store_unavailable",
    message: "Repo-local But Why? state is unavailable.",
    help: [
      taskPrefix === undefined
        ? "Move or restore .but-why/state.sqlite, then run `by init --task-prefix <prefix>`."
        : `Move or restore .but-why/state.sqlite, then run \`by init --task-prefix ${taskPrefix}\`.`,
    ],
  });
