# Agent instructions for But Why?

Read this file before changing the repo.

## Required reading

Before implementation work, read:

- `CONTEXT.md`
- `docs/architecture.md`
- `docs/prd.md`
- `docs/issue-breakdown.md`
- `docs/open-questions.md`

If the task touches configuration, also read `docs/config.md`.

If the task touches setup or onboarding, also read `docs/setup.md`.

If the task touches an architectural decision, read `docs/adr/` first.

## Current project state

This repo is still in planning and design.

Do not start product implementation before the Sandcastle spike is done or explicitly approved.

The first implementation issue is `docs/issues/001-prove-sandcastle-v1-execution.md`.

## Product rules

But Why? is task-based, not pipeline-based.

Design around `Task`, `Run`, `Finding`, and `PR`.

Do not design around generic CI jobs, pushes, or board statuses.

V1 uses synchronous `by submit <task-id>` validation.

V1 always publishes through GitHub PRs.

V1 has no auto-fix or repair phase.

Any validation finding sends the task to `needs_input`.

## Execution rules

Sandcastle is the intended v1 execution engine, pending spike.

Do not reimplement Sandcastle execution plumbing unless the spike proves it cannot support the required behavior.

Use thin domain seams around Sandcastle.

Good seams speak But Why? language, such as `runCheckRound`, `runReviewerRound`, and `createValidationWorkspace`.

Avoid generic wrappers like `runCommand`, `runAgent`, or `collectArtifacts` unless there is a proven need.

## CLI rules

The CLI is agent-first.

Commands must be non-interactive unless they are explicitly human setup commands such as `by init`.

Structured output goes to stdout.

Progress and diagnostics go to stderr.

Use TOON-style output for CLI responses.

Errors should be structured and actionable.

## Documentation rules

Keep planning docs current as decisions change.

When a domain term is resolved, update `CONTEXT.md` immediately.

When a hard-to-reverse architecture decision is made, add an ADR under `docs/adr/`.

When writing or substantially editing Markdown, put each full sentence on its own line.
