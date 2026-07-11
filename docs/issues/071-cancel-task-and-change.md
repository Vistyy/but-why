# Cancel a Task and its Change

## Parent

`docs/prds/change-centered-validation-prd.md`

## What to build

Add explicit terminal Task cancellation.
Cancelling a Task also closes its open Change as `cancelled` without deleting history.

## Acceptance criteria

- [ ] An explicit non-interactive command cancels a Task.
- [ ] A cancelled Task is terminal and cannot start, resume, submit, publish, or be picked up automatically.
- [ ] Cancelling a Task with an open Change atomically closes both records as `cancelled`.
- [ ] A Task without a Change can be cancelled.
- [ ] A completed Task cannot be cancelled.
- [ ] Standalone Change cancellation remains outside this issue.
- [ ] A closed Change cannot reopen or accept new Candidates.
- [ ] Task, Change, Candidate, validation, decision, Artifact, and dirty workspace history remains readable.
- [ ] Repeated cancellation reaches the same terminal state without duplicating effects.
- [ ] The behavior of dependent Tasks and any active execution is explicitly resolved before cancellation ships.

## Blocked by

- `docs/issues/050-expand-storage-with-change-and-candidate.md`
- `docs/issues/054-link-tasks-to-changes-and-project-status.md`
- `docs/issues/068-add-task-dependencies-and-eligibility.md`
