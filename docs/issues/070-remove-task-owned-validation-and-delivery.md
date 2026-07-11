# Remove the Task-owned validation and delivery path

## Parent

`docs/prds/change-centered-validation-prd.md`

## What to build

Complete the contract step of the ownership migration.
Remove Task-owned Validation Run identity, lifecycle authority, submission preflight, old reviewer phase writes, and compatibility paths so Change-centered behavior is the only supported path.

## Acceptance criteria

- [ ] Validation Runs require Candidate ownership and use optional Task traceability only.
- [ ] Task-derived Validation Run IDs, active-run uniqueness, and artifact identity are replaced by Change-centered forms.
- [ ] Task status is read only through the approved projection.
- [ ] Candidate capture is independent from GitHub publication targeting.
- [ ] Old Quality Reviewer and publication phase write paths are removed after historical records remain readable through supported views.
- [ ] Task Authority no longer coordinates validation or publication.
- [ ] Database migration preserves supported history and leaves no duplicate ownership implementation.
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
