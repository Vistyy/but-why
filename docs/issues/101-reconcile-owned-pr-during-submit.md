# Reconcile an owned PR during Submit

## Specification

- `docs/prds/change-centered-validation-prd.md`
- `CONTEXT.md`
- `docs/adr/0011-keep-v1-pr-heads-locally-owned.md`

## Behaviors owned

- Repeated Submit reads authoritative facts for the Change's existing owned PR.
- GitHub state changes Task progress only when exact ownership still matches.

## What to build

Add one-shot PR reconciliation as an internal Submit capability without a public reconcile command or watcher.

## Primary verification seam

Repeated Submit test with a fake GitHub repository.

## Acceptance criteria

- [ ] Submit finds the durable owned PR before considering new publication.
- [ ] An open PR at the expected validated head is returned without mutation.
- [ ] A merged PR atomically marks the Task and Change completed.
- [ ] A closed unmerged PR remains closed and no replacement PR is created.
- [ ] Unexpected repository, head branch, base target, or head SHA is rejected without adoption.
- [ ] A new local committed head proceeds through Candidate validation before the same PR updates.
- [ ] Reconciliation works from any checkout in the local repository.
- [ ] The CLI states that local PR facts remain stale until Submit runs again.

## Blocked by

- `docs/issues/098-publish-one-exact-candidate-with-recovery.md`
