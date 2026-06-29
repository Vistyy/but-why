# Add repo-local PR reconciliation

## Parent

`docs/prd.md`

## What to build

Add one-shot GitHub PR reconciliation for PRs created by But Why in the current repo.

This gives users and agents a way to update Task state after PR state changes outside `by submit`.

## Acceptance criteria

- [ ] `by reconcile` checks PRs created by But Why in the current repo.
- [ ] A ready Task moves to `done` when its PR is merged.
- [ ] A ready Task moves to `needs_input` when its PR becomes unready.
- [ ] Reconciliation is idempotent.
- [ ] Reconciliation does not process new submissions.
- [ ] Reconciliation output reports changed and unchanged Tasks.
- [ ] GitHub tooling errors are structured and actionable.

## Blocked by

- 015-watch-prs-during-submit-until-ready-or-blocked.md
