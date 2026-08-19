import type { CliResult } from "../../cliResults.js";
import { usageError } from "../../cliResults.js";

export type DependencyOperation = "add" | "remove" | "replace";

export const dependencyOptionRequiredError = (operation: DependencyOperation): CliResult =>
  usageError({
    code: operation === "replace" ? "replace_requires_dependency" : "depends_on_required",
    message:
      operation === "replace"
        ? "The replace operation requires at least one prerequisite."
        : `The ${operation} operation requires at least one --depends-on value.`,
    help: [
      operation === "replace"
        ? "Use `by task dependencies clear <task-id>` to remove all prerequisites."
        : `Use \`by task dependencies ${operation} <task-id> --depends-on <task-id>\`.`,
    ],
  });

export const missingDependencyOperation = (
  args: readonly string[],
  validationMessage: string,
): DependencyOperation | undefined => {
  if (validationMessage !== "Expected at least 1 value(s) for option: '--depends-on'") {
    return undefined;
  }
  const positional = validGlobalOptionSyntax(args);
  if (positional === undefined || positional.length !== 4) return undefined;
  const [command, group, operation] = positional;
  return command === "task" &&
    group === "dependencies" &&
    (operation === "add" || operation === "remove" || operation === "replace")
    ? operation
    : undefined;
};

const validGlobalOptionSyntax = (args: readonly string[]): readonly string[] | undefined => {
  const seen = new Set<string>();
  const positional: string[] = [];
  const valueOptions = new Map([
    [
      "--log-level",
      new Set(["all", "trace", "debug", "info", "warning", "error", "fatal", "none"]),
    ],
    ["--completions", new Set(["sh", "bash", "fish", "zsh"])],
  ]);
  const aliases = new Map<string, string>();
  const flags = new Set(["--wizard", "--version", "--help", "-h"]);
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === undefined) return undefined;
    if (!argument.startsWith("-")) {
      positional.push(argument);
      continue;
    }
    if (argument.includes("=")) return undefined;
    const option = aliases.get(argument) ?? argument;
    if (flags.has(option)) {
      if (seen.has(option)) return undefined;
      seen.add(option);
      continue;
    }
    const values = valueOptions.get(option);
    if (values === undefined || seen.has(option)) return undefined;
    const value = args[++index];
    if (value === undefined || value.startsWith("-") || !values.has(value)) return undefined;
    seen.add(option);
  }
  return positional;
};
