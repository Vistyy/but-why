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

- [ ] `by change list` shows open Changes by default and supports `--all`.
- [ ] Change list sorts oldest first and reports open age without inferring inactivity.
- [ ] `by change show` exposes optional Task linkage, Managed Worktree, starting commit, readiness, current Candidate, Findings, PR, and cleanup state.
- [ ] `by change findings` and `by change validation-runs` resolve detail through Change and Candidate ownership.
- [ ] Taskless Changes remain discoverable without a Task lookup.
- [ ] Task show exposes intent, dependencies, lifecycle, and a compact linked-Change projection.
- [ ] No inspection path reads legacy Task-owned validation or delivery tables.
- [ ] Detailed inspection modules sit under Change ownership; Task retains only its compact linked-Change projection.
- [ ] Empty and unavailable states are explicit in bounded structured output.

## Blocked by

- `docs/issues/087-inspect-candidate-owned-validation-run.md`
- `docs/issues/101-reconcile-owned-pr-during-submit.md`
- `docs/issues/105-migrate-task-submit.md`
- `docs/issues/133-start-prepared-changes.md`
