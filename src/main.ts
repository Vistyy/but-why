#!/usr/bin/env node
import { runCli, usage } from "./cli.js";
import { ruleAuthoringInstructions } from "./ruleAuthoring.js";

const args = process.argv.slice(2);

if (args.length === 1 && args[0] === "--rule-guide") {
  process.stdout.write(ruleAuthoringInstructions);
} else if (args.length === 1 && args[0] === "--help") {
  process.stdout.write(
    `${usage}\n\nUse by --rule-guide when deciding, writing, or testing a But Why rule.\n`,
  );
} else {
  process.exitCode = await runCli(args);
}
