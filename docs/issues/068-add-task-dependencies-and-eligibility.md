# Add Task dependencies and eligibility

## Parent

`docs/prds/change-centered-validation-prd.md`

## What to build

Add durable directed Task Dependencies so manual starts and automatic pickup wait for prerequisite work.
Keep dependency blocking separate from Task Lifecycle while unresolved propagation and presentation rules remain explicit.

## Acceptance criteria

- [ ] A Task can add, remove, list, and inspect prerequisite Tasks under explicit mutation timing rules.
- [ ] Mutation rules after either Task starts are resolved and documented before dependency writes ship.
- [ ] A Task cannot start manually until every prerequisite Task is `done`.
- [ ] An AFK worker cannot claim a Task until every prerequisite Task is `done`.
- [ ] Dependency eligibility is checked again at the same durable boundary as start or claim.
- [ ] Missing, duplicate, and self-dependencies are rejected with structured errors.
- [ ] Cycle behavior is resolved and documented before dependency writes ship.
- [ ] Structured Task output identifies the prerequisites that currently block a start or claim.
- [ ] Dependencies do not add a separate blocked Task Lifecycle state.
- [ ] Submission behavior for dependencies added after work starts remains deferred.
- [ ] The effect of a cancelled prerequisite remains unresolved and is decided before Task cancellation ships.

## Blocked by

- `docs/issues/054-link-tasks-to-changes-and-project-status.md`
