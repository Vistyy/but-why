# Add agent skill for by CLI

## Status

Not done.

## Parent

`docs/prds/v1-validation-prd.md`

## What to build

Create an agent-facing `SKILL.md` that teaches coding agents how to operate the `by` CLI safely and effectively.

The skill should make But Why? usable by agents without requiring them to rediscover command order, output contracts, task lifecycle rules, or validation failure handling.

## Acceptance criteria

- [ ] The skill documents that But Why? validates completed code changes against approved human intent.
- [ ] The skill describes the Task lifecycle states agents need for normal use.
- [ ] The skill tells agents when to use `by task create`, `by task start`, `by submit`, `by task findings`, and `by validation-run show`.
- [ ] The skill tells agents to prefer structured CLI output and parse stdout as the command contract.
- [ ] The skill explains the difference between Submit Rejection Errors, Validation Tooling Failures, and Findings.
- [ ] The skill tells agents that Findings send Tasks to `needs_input` and require code changes before resubmit.
- [ ] The skill tells agents that Validation Tooling Failures are tooling problems, not submission problems.
- [ ] The skill includes the expected prepare-and-check submit loop.
- [ ] The skill explains that agents should configure explicit `validation.prepare` and `validation.checks` policy instead of relying on hidden dependency setup.
- [ ] The skill includes guidance for creating a But Why Task from an existing markdown issue with `--description-file` without treating markdown files as the Task authority.
- [ ] The skill warns agents not to edit repo-local SQLite state directly.
- [ ] The skill warns agents not to inspect validation artifacts through workspace paths.
- [ ] The skill points agents at the CLI inspection commands for Findings, rounds, phases, artifacts, and tooling failures.
- [ ] The skill follows AXI guidance for non-interactive agent-facing CLIs.
- [ ] The skill location is documented so agents can install or reference it consistently.

## Blocked by

- 013-inspect-runs-and-latest-task-findings.md
- 043-guide-init-validation-configuration.md
