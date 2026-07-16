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

- [ ] Task creation accepts repeated `--depends-on <task-id>` options atomically.
- [ ] `by task dependencies set <task-id> --depends-on <task-id>...` replaces the complete list atomically.
- [ ] Unknown Tasks, self-dependencies, duplicate inputs, and cycles are rejected without changing the graph.
- [ ] Dependencies lock when the dependent Task starts.
- [ ] Start succeeds only when every prerequisite is Done.
- [ ] Cancelled prerequisites remain unsatisfied.
- [ ] Task show exposes direct prerequisites and dependents.
- [ ] Task list exposes `startable` and direct `blockedBy` facts.

## Blocked by

- `docs/issues/077-approve-task-intent.md`
