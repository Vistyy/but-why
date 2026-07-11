# Run fresh Task-backed Implementer Executions

## Parent

`docs/prds/change-centered-validation-prd.md`

## What to build

Run fresh Implementer Executions in managed Sandcastle Change Workspaces to produce the initial Candidate for an approved Task-backed Change.
Continuity comes from durable workspace and Change records rather than captured agent sessions.

## Acceptance criteria

- [ ] An Implementer Execution receives Acceptance Context, repository guidance, current workspace facts, prior durable results, and the remaining implementation goal.
- [ ] Every invocation uses the shared Code-Writing Execution record and a fresh agent process.
- [ ] Sandcastle owns the managed writable Change Workspace and attached execution sandbox.
- [ ] Successful implementation commits and uses Issue 051's shared capability to capture or reuse the initial Candidate.
- [ ] Interrupted dirty work is preserved for a later fresh Implementer Execution.
- [ ] Manual Task Start requires every Task Dependency to be `done` and reports blocking prerequisites through structured output.
- [ ] Dependency eligibility and the implementation claim share one durable atomic boundary.
- [ ] Repeated Task Start never launches concurrent implementation.
- [ ] The Implementer never receives or fixes Validation Findings.

## Blocked by

- `docs/issues/054-link-tasks-to-changes-and-project-status.md`
- `docs/issues/057-record-code-writing-executions-and-fix-check-findings.md`
- `docs/issues/068-add-task-dependencies-and-eligibility.md`
