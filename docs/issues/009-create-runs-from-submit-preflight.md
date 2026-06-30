# Create Runs from submit preflight

## Parent

`docs/prd.md`

## What to build

Implement the preflight part of `by submit <task-id>` without running validation yet.

This should prove Task state rules, branch safety, GitHub target detection, branch binding, and commit-bound Run creation.

## Acceptance criteria

- [ ] `by submit <task-id>` is allowed from `implementing` and `needs_input`.
- [ ] Submitting from `todo`, `validating`, `ready`, or `done` fails with a structured error.
- [ ] Submit requires a clean working tree.
- [ ] Submit requires a non-protected current branch.
- [ ] Submit detects a GitHub PR target and fails if it cannot.
- [ ] First submit binds the Task to the current branch.
- [ ] Later submits require the same branch.
- [ ] Submit captures the current commit SHA.
- [ ] Submit creates a task-scoped Run ID such as `BY-1.1`.
- [ ] A tooling error leaves the Task in its previous state and marks the Run as error if a Run was created.

## Blocked by

- 003-implement-repo-initialization.md
- 008-start-tasks.md
