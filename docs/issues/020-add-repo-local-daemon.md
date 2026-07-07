# Add repo-local daemon

## Status

Not done.

## Parent

`docs/prds/v1-validation-prd.md`

## What to build

Add a repo-local polling daemon for PR reconciliation.

The daemon should repeatedly run the same reconciliation behavior as `by reconcile` and should not become a full worker in v1.

## Acceptance criteria

- [ ] `by daemon` starts a repo-local polling loop.
- [ ] The daemon reconciles only the current repo.
- [ ] The daemon uses the same state transition rules as `by reconcile`.
- [ ] The daemon uses the shared Effect-scheduled GitHub polling mechanics.
- [ ] The daemon does not process new submissions.
- [ ] The daemon reports progress and diagnostics to stderr.
- [ ] The daemon can shut down cleanly.
- [ ] Shutdown does not interrupt state writes midway.
- [ ] Poll interval is configurable or has a documented default.
- [ ] Poll interval config validation reports typed config errors.

## Blocked by

- 019-add-repo-local-pr-reconciliation.md
