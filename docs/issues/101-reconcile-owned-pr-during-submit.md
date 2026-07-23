# Reconcile owned PRs and clean completed Changes

## Specification

- `docs/prds/change-centered-validation-prd.md`
- `docs/specs/taskless-changes-and-worktree-handoff.md`
- `CONTEXT.md`
- `docs/adr/0011-keep-v1-pr-heads-locally-owned.md`

## Behaviors owned

- Submit and `by change reconcile` read authoritative state for Change-owned PRs.
- Merged PRs complete their Changes and trigger safe cleanup.
- Reconciliation remains explicit and one-shot in v1.

## What to build

Provide one owned-PR reconciliation capability used internally by Submit and publicly through `by change reconcile [<change-id>]`, including safe cleanup of eligible terminal Change resources.

## Primary verification seam

Change reconciliation CLI tests with a fake GitHub repository and focused real-Git cleanup cases.

## Acceptance criteria

- [x] Repository-wide reconciliation checks only open Changes with recorded PRs and closed Changes with pending cleanup.
- [x] Targeted reconciliation checks exactly one Change.
- [x] An open PR at the expected validated head is returned without mutation.
- [x] A merged PR atomically completes the Change and its linked Task when present.
- [x] A closed unmerged PR remains closed and no replacement PR is created.
- [x] Unexpected repository, head branch, base target, or head SHA is rejected without adoption.
- [x] Cleanup removes a worktree only when it has no uncommitted changes.
- [x] Cleanup deletes a branch only when its commits remain reachable through another ref.
- [x] Unsafe or failed cleanup remains pending and reports its blocking reason.
- [x] Reconciliation works from any checkout in the Local Repository and is idempotent.
- [x] V1 has no reconciliation daemon, webhook, or automatic polling requirement.

## Blocked by

- `docs/issues/098-publish-one-exact-candidate-with-recovery.md`
- `docs/issues/133-start-prepared-changes.md`

## Completion

Implemented in `7a9c150`.
Verified with focused reconciliation and cleanup tests, `just typecheck`, and `just quality`.
The issue breakdown records Task 101 as complete and no longer blocks Task 117.
