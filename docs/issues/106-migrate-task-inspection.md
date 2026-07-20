# Add Change inspection and migrate Task projections

## Specification

- `docs/prds/change-centered-validation-prd.md`
- `docs/specs/taskless-changes-and-worktree-handoff.md`
- `CONTEXT.md`
- `docs/adr/0008-use-change-as-validation-and-delivery-owner.md`

## Behaviors owned

- Change commands expose implementation, validation, and delivery facts.
- Task list and show remain focused on intent and compact linked-Change progress.

## What to build

Add Change list, show, Findings, and Validation Run inspection while replacing Task-owned validation readers with projections from Change-owned facts.

## Primary verification seam

Change and Task inspection CLI tests across taskless, Task-backed, validating, ready, completed, and cancelled states.

## Acceptance criteria

- [x] `by change list` shows open Changes by default and supports `--all`.
- [x] Change list sorts Changes from oldest to newest.
- [x] Change list reports each open Change's age from `createdAt` to the command time without inferring inactivity.
- [x] `by change show` exposes optional Task linkage, Managed Worktree, starting commit, readiness, current Candidate, Findings, PR, and cleanup state.
- [x] `by change findings` and `by change validation-runs` resolve detail through Change and Candidate ownership.
- [x] Taskless Changes remain discoverable without a Task lookup.
- [x] Task show exposes intent, dependencies, lifecycle, and a compact linked-Change projection.
- [x] No inspection path reads legacy Task-owned validation or delivery tables.
- [x] Detailed inspection modules sit under Change ownership; Task retains only its compact linked-Change projection.
- [x] Structured output distinguishes an empty collection from unavailable detail.

## Blocked by

- `docs/issues/087-inspect-candidate-owned-validation-run.md`
- `docs/issues/101-reconcile-owned-pr-during-submit.md`
- `docs/issues/105-migrate-task-submit.md`
- `docs/issues/133-start-prepared-changes.md`

## Completion

Completed in `46823fa`, `71c2ae3`, and `11b84ac`.

Verification: `just quality` passed with 392 tests passed and 1 skipped.

Review: Spec approved.
Standards approved with required comments, with the issue-breakdown history decision approved by the user.
