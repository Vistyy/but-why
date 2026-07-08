# Add agent skill for by CLI

## Status

Not done.

## Parent

`docs/prds/v1-validation-prd.md`

## What to build

Create an agent-facing `SKILL.md` that teaches coding agents how to operate the `by` CLI safely and effectively.

The skill should make But Why? usable by agents without requiring them to rediscover command order, output contracts, task lifecycle rules, validation failure handling, or the Installed CLI versus Repo-local CLI split.

The skill is not the bootstrap source for installing But Why? before the skill is available.
It should reference the setup and install guidance produced by issue 044.

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
- [ ] The skill explains that `by init` gives concise setup hints, while the skill carries the detailed agent workflow.
- [ ] The skill includes prepare examples for common ecosystems such as pnpm, uv, Cargo, and .NET.
- [ ] The skill tells agents not to hide dependency setup inside checks when `validation.prepare` is available.
- [ ] The skill distinguishes Repo-local CLI usage from Installed CLI usage: use `just by ...` when developing But Why? itself, and use installed `by ...` when operating in another repository.
- [ ] The skill references the setup and install guidance produced by issue 044 instead of being the only bootstrap source.
- [ ] The skill treats npm registry publishing as future work until issue 046 is complete.
- [ ] The skill uses tarball install guidance only while registry publishing is unavailable.
- [ ] The skill does not require `by --version` until issue 046 adds it.
- [ ] The skill includes guidance for creating a But Why Task from an existing markdown issue with `--description-file` without treating markdown files as the Task authority.
- [ ] The skill warns agents not to edit repo-local SQLite state directly.
- [ ] The skill warns agents not to inspect validation artifacts through workspace paths.
- [ ] The skill points agents at the CLI inspection commands for Findings, rounds, phases, artifacts, and tooling failures.
- [ ] The skill follows AXI guidance for non-interactive agent-facing CLIs.
- [ ] The skill location is documented so agents can install or reference it consistently.

## Blocked by

- 013-inspect-runs-and-latest-task-findings.md
- 043-guide-init-validation-configuration.md
- 044-package-by-as-installable-cli.md
