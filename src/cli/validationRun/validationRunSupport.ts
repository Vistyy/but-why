import { type CliResult, runtimeError } from "../../cliResults.js";

export type ValidationRunCommandEnvironment = {
  readonly cwd: string;
  readonly now: () => Date;
};

export const notFound = (id: number): CliResult =>
  runtimeError({
    code: "validation_run_not_found",
    message: `Validation Run was not found: ${id}`,
    details: { validationRunId: id },
    help: ["Run `by change show <change-id>` to inspect known Candidates and Validation Runs."],
  });
