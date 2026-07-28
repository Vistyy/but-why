import { it } from "@effect/vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Effect } from "effect";
import { describe, expect } from "vitest";

import { repoRoot, runByInProcessEffect } from "../support/by-cli.js";

type HelpView = {
  readonly commands: readonly { readonly command: string }[];
};

const commandsFor = (group: "task" | "change"): readonly string[] =>
  documentedCommands.filter((command) => command.startsWith(`by ${group} `));

const extractDocumentedCommands = (docs: string): readonly string[] =>
  Array.from(
    new Set(
      Array.from(
        docs.matchAll(/The installed command templates? (?:is|are):\n\n```text\n([\s\S]*?)```/gu),
      )
        .flatMap((match) => match[1]?.split("\n") ?? [])
        .filter((command) => command.length > 0),
    ),
  ).sort();

const helpCommands = (stdout: string): readonly string[] => {
  const parsed = JSON.parse(stdout) as HelpView;
  return parsed.commands.map(({ command }) => command);
};

const documentedCommands = [
  "by task create --title <title> --description-file <file> [--depends-on <task-id>]...",
  "by task dependencies set <task-id> [--depends-on <task-id>]...",
  "by task list [--all] [--state <state>]",
  "by task show <task-id>",
  "by task approve <task-id>",
  "by task context <task-id>",
  "by task context draft <task-id>",
  "by task context apply <task-id>",
  "by task comment <task-id> --file <file>",
  "by task cancel <task-id> --reason <reason>",
  "by change start [--task <task-id>] [--base <branch>]",
  "by change prepare <change-id>",
  "by change list [--all]",
  "by change show <change-id>",
  "by change findings <change-id>",
  "by change validation-runs <change-id>",
  "by change submit <change-id>",
  "by change cancel <change-id>",
  "by change reconcile [<change-id>]",
  "by change implement <change-id> [--handoff-file <path>]",
] as const;

describe("public command documentation", () => {
  it.effect("keeps public workflow command templates aligned with CLI help", () =>
    Effect.gen(function* () {
      const setup = readFileSync(join(repoRoot, "docs/public/setup.md"), "utf8");
      const config = readFileSync(join(repoRoot, "docs/public/config.md"), "utf8");
      const documented = extractDocumentedCommands(`${setup}\n${config}`);
      const taskHelp = yield* runByInProcessEffect(repoRoot, [
        "--output",
        "json",
        "task",
        "--help",
      ]);
      const changeHelp = yield* runByInProcessEffect(repoRoot, [
        "--output",
        "json",
        "change",
        "--help",
      ]);

      expect(taskHelp.status).toBe(0);
      expect(changeHelp.status).toBe(0);
      expect(documented).toEqual([...documentedCommands].sort());
      expect(helpCommands(taskHelp.stdout)).toEqual(commandsFor("task"));
      expect(helpCommands(changeHelp.stdout)).toEqual(commandsFor("change"));
    }),
  );
});
