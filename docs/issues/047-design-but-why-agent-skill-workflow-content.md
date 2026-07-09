# Design But Why agent skill workflow content

## Status

Not done.

## Parent

`docs/issues/041-add-agent-skill-for-by-cli.md`

## What to build

Design and implement the detailed workflow content for the public But Why agent skill.

This issue starts after `docs/public/skills/but-why/SKILL.md` exists as a packaged public artifact and after `docs/public/setup.md` explains how users and agents place the skill.

The skill should make agents predictable when operating the `by` CLI.
It should stay command-operational and include only the domain terms needed for correct CLI behavior.

## Acceptance criteria

- [ ] The skill teaches the normal `by` command workflow for creating, starting, submitting, and inspecting Tasks.
- [ ] The skill explains the Task lifecycle states agents need for normal use.
- [ ] The skill tells agents to prefer structured CLI output and parse stdout as the command contract.
- [ ] The skill explains Submit Rejection Errors, Validation Tooling Failures, and Findings in terms of the agent action each requires.
- [ ] The skill explains the prepare-and-check submit loop.
- [ ] The skill explains explicit `validation.prepare` and `validation.checks` policy.
- [ ] The skill includes prepare examples for common ecosystems such as pnpm, uv, Cargo, and .NET if those examples remain useful at implementation time.
- [ ] The skill distinguishes Repo-local CLI usage from Installed CLI usage.
- [ ] The skill presents CLI inspection commands as the source of truth for task state, Findings, Validation Runs, phases, rounds, artifacts, and tooling failures.
- [ ] The skill follows AXI guidance for non-interactive agent-facing CLIs.
- [ ] The skill uses positive contract wording for supported workflows and names retired, internal, or forbidden paths only as likely hazards.
- [ ] Markdown issue import with `--description-file` is considered only if it earns a conditional reference section.

## Blocked by

- 041-add-agent-skill-for-by-cli.md
