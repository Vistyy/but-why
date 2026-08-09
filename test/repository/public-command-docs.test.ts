import { readFileSync } from "node:fs";
import { join } from "node:path";
import { it } from "@effect/vitest";
import { Effect } from "effect";
import { describe, expect } from "vitest";

import { repoRoot, runByInProcessEffect } from "../support/by-cli.js";

type HelpView = {
  readonly help: string;
};

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

const helpText = (stdout: string): string => (JSON.parse(stdout) as HelpView).help;

const documentedCommands = [
  "by snapshot",
  "by task create --title <title> --file <path|-> [--depends-on <task-id>]...",
  "by task dependencies add <task-id> --depends-on <task-id> [--depends-on <task-id>]...",
  "by task dependencies remove <task-id> --depends-on <task-id> [--depends-on <task-id>]...",
  "by task dependencies replace <task-id> --depends-on <task-id> [--depends-on <task-id>]...",
  "by task dependencies clear <task-id>",
  "by task list [--all] [--state <state>] [--limit <positive integer | all>]",
  "by task show <task-id>",
  "by task submit <task-id>",
  "by task reviews <task-id>",
  "by task context <task-id>",
  "by task context draft <task-id>",
  "by task context apply <task-id>",
  "by task cancel <task-id> --reason <reason>",
  "by task-review show <review-id>",
  "by task-review abandon <review-id> --reason <reason>",
  "by change start [--task <task-id>] [--base <branch>]",
  "by change prepare [<change-id>]",
  "by change list [--all]",
  "by change show [<change-id>]",
  "by change findings [<change-id>]",
  "by change validation-runs [<change-id>]",
  "by validation-run show <validation-run-id>",
  "by validation-run artifact <validation-run-id> <artifact-ref>",
  "by validation-run abandon <validation-run-id> --reason <reason>",
  "by change submit [<change-id>]",
  "by change cancel [<change-id>] --reason <reason>",
  "by change reconcile [<change-id>] [--discard-work]",
  "by change implement [<change-id>] [--implementer-prompt-file <path>]",
  'by change decision add <change-id> --choice "<selected approach>" --rationale "<reason>"',
  "by change blocker raise <change-id> --file <path|->",
  "by change blocker resolve <change-id> --file <path|->",
  "by change blocker list <change-id>",
  "by change decision list <change-id>",
] as const;

describe("public command documentation", () => {
  it.effect("keeps public workflow command templates aligned with CLI help", () =>
    Effect.gen(function* () {
      const setup = readFileSync(join(repoRoot, "docs/public/setup.md"), "utf8");
      const config = readFileSync(join(repoRoot, "docs/public/config.md"), "utf8");
      const operatorWorkflow = readFileSync(
        join(repoRoot, "docs/public/skills/but-why/references/operator-workflow.md"),
        "utf8",
      );
      const documented = extractDocumentedCommands(`${setup}\n${config}\n${operatorWorkflow}`);
      const rootHelp = yield* runByInProcessEffect(repoRoot, ["--help", "--json"]);
      const taskHelp = yield* runByInProcessEffect(repoRoot, ["task", "--help", "--json"]);
      const changeHelp = yield* runByInProcessEffect(repoRoot, ["change", "--help", "--json"]);

      expect(rootHelp.status).toBe(0);
      expect(taskHelp.status).toBe(0);
      expect(changeHelp.status).toBe(0);
      expect(documented).toEqual([...documentedCommands].sort());

      const rootHelpText = helpText(rootHelp.stdout);
      expect(rootHelpText).toContain("COMMANDS");
      for (const documentedCommand of documentedCommands) {
        const words = documentedCommand.replace(/^by /u, "").split(/\s+/u);
        const syntaxStart = words.findIndex(
          (word) => word.startsWith("--") || word.startsWith("<") || word.startsWith("["),
        );
        const commandPath = words.slice(0, syntaxStart).join(" ");
        const usageLine = rootHelpText
          .split("\n")
          .find((line) => line.trimStart().startsWith(`- ${commandPath}`));

        expect(usageLine, documentedCommand).toBeDefined();
        for (const option of documentedCommand.matchAll(/--[a-z-]+/gu)) {
          expect(usageLine, documentedCommand).toContain(option[0]);
        }
        for (let index = syntaxStart; index < words.length; index += 1) {
          const word = words[index];
          const previousWord = words[index - 1] ?? "";
          if (word?.startsWith("<") && !previousWord.includes("--")) {
            expect(usageLine, documentedCommand).toContain(word.replaceAll(/[[\]]/gu, ""));
          }
        }
        if (documentedCommand.includes("...")) {
          expect(usageLine, documentedCommand).toContain("...");
        }
        if (/task dependencies (add|remove|replace)/u.test(documentedCommand)) {
          expect(usageLine, documentedCommand).not.toContain("[--depends-on");
        }
      }

      expect(helpText(taskHelp.stdout)).toContain("COMMANDS");
      expect(helpText(changeHelp.stdout)).toContain("COMMANDS");
    }),
  );
});
