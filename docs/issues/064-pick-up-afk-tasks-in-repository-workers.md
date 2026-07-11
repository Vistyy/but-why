# Pick up approved AFK Tasks in repository workers

## Parent

`docs/prds/change-centered-validation-prd.md`

## What to build

Add the repository worker entry point and let a directly invoked worker atomically claim approved `todo` Tasks carrying the validated `afk` tag, produce their initial Candidate, and invoke the same submit capability used by manual work.
Supervisor-managed registration and launch follow in a later slice.

## Acceptance criteria

- [ ] `by task approve` records approved intent and projects the Task as `todo`.
- [ ] Task tag writes reject unknown tags and persist the built-in `afk` tag until explicitly removed.
- [ ] Only approved `todo` Tasks with the validated `afk` tag and every Task Dependency `done` are eligible.
- [ ] A worker can be invoked directly for one repository without a Supervisor.
- [ ] A durable atomic claim checks dependency eligibility and prevents duplicate worker ownership.
- [ ] Removing `afk` before claim prevents pickup without cancelling active claimed work.
- [ ] The worker creates or reuses the Task's Change and managed Change Workspace.
- [ ] Implementation and delivery use the same Implementer, validation, fixing, and submit paths as manual commands.
- [ ] Repository policy controls automatic fixing and execution limits.
- [ ] Durable state commits before any wake signal is emitted.

## Blocked by

- `docs/issues/061-publish-exact-validated-head-with-submit.md`
- `docs/issues/063-run-task-backed-implementer-executions.md`
- `docs/issues/068-add-task-dependencies-and-eligibility.md`
