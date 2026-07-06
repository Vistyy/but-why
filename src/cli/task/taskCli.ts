import type { CliResult } from "../../cliResults.js";
import { success, usageError } from "../../cliResults.js";
import { withGlobalHelpFlags } from "../../cliHelp.js";
import type { StructuredObject } from "../../output/structured.js";
import { runCommentCommand } from "./commands/comment.js";
import { runContextCommand } from "./commands/context.js";
import { runCreateCommand } from "./commands/create.js";
import { runListCommand } from "./commands/list.js";
import { runShowCommand } from "./commands/show.js";
import { runStartCommand } from "./commands/start.js";
import { dashboard } from "./dashboard.js";
import type { TaskCommandEnvironment } from "./taskCliSupport.js";

export type TaskRouteMetadata = {
  readonly bin: string;
  readonly description: string;
};

export const routeTask = (
  args: readonly string[],
  environment: TaskCommandEnvironment,
  metadata: TaskRouteMetadata,
): CliResult => {
  if (args.length === 0) {
    return dashboard(metadata.bin, metadata.description, environment);
  }

  if (args.length === 1 && args[0] === "--help") {
    return success(taskHelpView());
  }

  const subcommand = args[0];

  if (subcommand === "create") {
    return runCreateCommand(args.slice(1), environment);
  }

  if (subcommand === "list") {
    return runListCommand(args.slice(1), environment);
  }

  if (subcommand === "show") {
    return runShowCommand(args.slice(1), environment);
  }

  if (subcommand === "start") {
    return runStartCommand(args.slice(1), environment);
  }

  if (subcommand === "context") {
    return runContextCommand(args.slice(1), environment);
  }

  if (subcommand === "comment") {
    return runCommentCommand(args.slice(1), environment);
  }

  if (subcommand?.startsWith("-")) {
    return usageError({
      code: "unknown_flag",
      message: `Unknown flag: ${subcommand}`,
      help: ["Run `by task --help`."],
    });
  }

  return usageError({
    code: "unknown_command",
    message: `Unknown task command: ${subcommand ?? ""}`,
    help: ["Run `by task --help`."],
  });
};

const taskHelpView = (): StructuredObject => ({
  usage: "by task <command> [--help]",
  commands: [
    {
      command: "by task create --title <title> --description-file <file>",
      description: "Create a repo-local Task",
    },
    {
      command: "by task list [--all] [--state <state>]",
      description: "List repo-local Tasks",
    },
    {
      command: "by task show <task-id>",
      description: "Show compact Task metadata",
    },
    {
      command: "by task start <task-id>",
      description: "Mark implementation work as started",
    },
    {
      command: "by task context <task-id>",
      description: "Show full Task Context",
    },
    {
      command: "by task comment <task-id> --file <file>",
      description: "Append a Markdown Task comment",
    },
  ],
  flags: withGlobalHelpFlags(),
});
