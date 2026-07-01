# Add repo-local daemon

## Status

Not done.

## Parent

`docs/prd.md`

## What to build

Add a repo-local polling daemon for PR reconciliation.

The daemon should repeatedly run the same reconciliation behavior as `by reconcile` and should not become a full worker in v1.

## Acceptance criteria

- [ ] `by daemon` starts a repo-local polling loop.
- [ ] The daemon reconciles only the current repo.
- [ ] The daemon uses the same state transition rules as `by reconcile`.
- [ ] The daemon does not process new submissions.
- [ ] The daemon reports progress and diagnostics to stderr.
- [ ] The daemon can shut down cleanly.
- [ ] Poll interval is configurable or has a documented default.

## Blocked by

- 018-add-repo-local-pr-reconciliation.md
