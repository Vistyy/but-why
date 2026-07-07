# Add Effect-scheduled GitHub polling

## Status

Not done.

## Parent

`docs/prds/v1-validation-prd.md`

## What to build

Create shared GitHub polling mechanics for PR watch and repo-local daemon flows using Effect scheduling.

This slice should provide polling, retry, timeout, and cancellation behavior in But Why domain language.

It should not decide every PR state transition by itself.

PR state classification should stay reusable by submit watch and reconciliation.

## Acceptance criteria

- [ ] GitHub PR polling uses `Effect.Schedule` or equivalent Effect scheduling.
- [ ] Poll intervals and timeout settings are validated before polling starts.
- [ ] Polling distinguishes terminal PR states from transient pending states.
- [ ] Polling timeout is represented distinctly from GitHub API tooling failure.
- [ ] GitHub API tooling failures use the typed validation error taxonomy.
- [ ] Polling can be cancelled cleanly.
- [ ] Submit watch can use the polling mechanics without duplicating retry or timeout loops.
- [ ] The repo-local daemon can use the polling mechanics without duplicating retry or timeout loops.
- [ ] Tests cover terminal success, terminal blocking state, timeout, tooling failure, and cancellation.

## Blocked by

- `docs/issues/016-publish-clean-runs-to-github-prs.md`
- `docs/issues/037-introduce-validation-effect-error-taxonomy.md`
