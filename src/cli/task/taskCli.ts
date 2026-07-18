import type { CliResult } from "../../cliResults.js";
import { success, usageError } from "../../cliResults.js";
import { withGlobalHelpFlags } from "../../cliHelp.js";
import type { StructuredObject } from "../../output/structured.js";
import { runApproveCommand } from "./commands/approve.js";
import { runCommentCommand } from "./commands/comment.js";
import { runContextCommand } from "./commands/context.js";
import { runCreateCommand } from "./commands/create.js";
import { runDependenciesCommand } from "./commands/dependencies.js";
import { runFindingsCommand } from "./commands/findings.js";
import { runListCommand } from "./commands/list.js";
import { runShowCommand } from "./commands/show.js";
import { runValidationRunsCommand } from "./commands/validationRuns.js";
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

  if (subcommand === "dependencies") {
    return runDependenciesCommand(args.slice(1), environment);
  }

  if (subcommand === "list") {
    return runListCommand(args.slice(1), environment);
  }

  if (subcommand === "show") {
    return runShowCommand(args.slice(1), environment);
  }

  if (subcommand === "findings") {
    return runFindingsCommand(args.slice(1), environment);
  }

  if (subcommand === "validation-runs") {
    return runValidationRunsCommand(args.slice(1), environment);
  }

  if (subcommand === "approve") {
    return runApproveCommand(args.slice(1), environment);
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
      command:
        "by task create --title <title> --description-file <file> [--depends-on <task-id>]...",
      description: "Create a repo-local Task",
    },
    {
      command: "by task dependencies set <task-id> [--depends-on <task-id>]...",
      description: "Replace direct Task prerequisites before Start",
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
      command: "by task approve <task-id>",
      description: "Permanently approve Task intent",
    },
    {
      command: "by task findings <task-id>",
      description: "Show Findings from the latest Task Validation Run",
    },
    {
      command: "by task validation-runs <task-id>",
      description: "List Task Validation Run History",
    },
    {
      command: "by task context <task-id>",
      description: "Show full Task Context",
    },
    {
      command: "by task context draft <task-id>",
      description: "Create an editable Task Context draft",
    },
    {
      command: "by task context apply <task-id>",
      description: "Apply an editable Task Context draft",
    },
    {
      command: "by task comment <task-id> --file <file>",
      description: "Append a Markdown Task comment",
    },
  ],
  flags: withGlobalHelpFlags(),
});
