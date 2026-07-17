# Manage direct Task dependencies

## Specification

- `docs/prds/change-centered-validation-prd.md`
- `CONTEXT.md`

## Behaviors owned

- Direct prerequisites explain which manual Tasks may start now and what they unblock.
- Dependencies block only Task Start.

## What to build

Allow Task creation to declare prerequisites and allow the complete prerequisite list to be replaced before Start.
Show direct prerequisites, dependents, and start eligibility through existing Task inspection.

## Primary verification seam

Task dependency CLI graph test.

## Acceptance criteria

- [x] Task creation accepts repeated `--depends-on <task-id>` options atomically.
- [x] `by task dependencies set <task-id> --depends-on <task-id>...` replaces the complete list atomically.
- [x] Unknown Tasks, self-dependencies, duplicate inputs, and cycles are rejected without changing the graph.
- [x] Dependencies lock when the dependent Task starts.
- [x] Start succeeds only when every prerequisite is Done.
- [x] Cancelled prerequisites remain unsatisfied.
- [x] Task show exposes direct prerequisites and dependents.
- [x] Task list exposes `startable` and direct `blockedBy` facts.

## Completion

Implemented in `179bbba`.
Spec review: Approved with required comments; completion-status correction committed in `6acdfff`.
Standards review: Approved.
Quality: Passed - format, lint, architecture checks, typecheck, 280 tests, and Fallow checks.

## Blocked by

- `docs/issues/077-approve-task-intent.md`
