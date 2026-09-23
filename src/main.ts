#!/usr/bin/env node
import { runCli, usage } from "./cli.js";
import { ruleAuthoringInstructions } from "./ruleAuthoring.js";

const args = process.argv.slice(2);

if (args.length === 1 && args[0] === "--rule-guide") {
  process.stdout.write(ruleAuthoringInstructions);
} else if (args.length === 1 && args[0] === "--help") {
  process.stdout.write(
    `${usage}

Review a final committed change with 'review change'; use 'files' or 'repository' for a requested audit of committed content.
But Why checks project rules at the base commit (or audited commit) and agent-wide rules.
If none exist, it exits nonzero without starting a reviewer; no review ran.

Independent reviewers report prose about risks ordinary checks may miss, not a pass/fail judgment.
Decide what to do with findings against the source; a completed review is not approval.
A failed or incomplete review is not clean evidence. Review a changed head again.

Use by --rule-guide when deciding, writing, or testing a But Why rule.
`,
  );
} else {
  process.exitCode = await runCli(args);
}
