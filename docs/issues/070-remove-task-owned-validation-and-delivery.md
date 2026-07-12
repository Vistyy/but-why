# Remove the Task-owned validation and delivery path

## Parent

`docs/prds/change-centered-validation-prd.md`

## What to build

Complete the cleanup step of the ownership migration.
Remove remaining Task-owned lifecycle authority, submission preflight, old reviewer phase writes, and compatibility paths so Change-centered behavior is the only supported path.

## Acceptance criteria

- [ ] Task status is read only through the approved projection.
- [ ] Storage enforces at most one Change per Task and at most one Task per Change.
- [ ] Change lifecycle uses permanent `open` or `closed` state without replacement or supersession storage.
- [ ] Candidate capture is independent from GitHub publication targeting.
- [ ] Old Quality Reviewer and publication phase write paths are removed while Candidate-owned history remains readable through supported views.
- [ ] Task Authority no longer coordinates validation or publication.
- [ ] Storage leaves no duplicate ownership implementation.
- [ ] All quality, migration, and end-to-end command checks pass through the Change-centered path.

## Blocked by

- `docs/issues/052-validate-candidate-checks-without-task.md`
- `docs/issues/054-link-tasks-to-changes-and-project-status.md`
- `docs/issues/059-add-final-gates-and-expose-validate.md`
- `docs/issues/060-add-change-owned-needs-input-and-resume.md`
- `docs/issues/061-publish-exact-validated-head-with-submit.md`
- `docs/issues/062-reconcile-pr-facts-and-later-heads.md`
- `docs/issues/063-run-task-backed-implementer-executions.md`
- `docs/issues/064-pick-up-afk-tasks-in-repository-workers.md`
- `docs/issues/066-expose-change-activity-and-usage.md`
- `docs/issues/068-add-task-dependencies-and-eligibility.md`
