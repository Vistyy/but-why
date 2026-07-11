# Add Change-owned Needs Input and resume

## Parent

`docs/prds/change-centered-validation-prd.md`

## What to build

Record exceptional blockers once on the Change and let `by validate`, `by submit`, or Task Resume continue from durable facts after the blocker is addressed.
Linked Tasks project the Change condition without owning it.

## Acceptance criteria

- [ ] Needs Input records its durable source Finding or operational failure on the Change.
- [ ] Valid causes are limited to disabled automatic fixing, impossible requirements, external blockers, and exhausted safety or recovery limits.
- [ ] A linked Task projects `needs_input` from its active Change.
- [ ] A standalone Change reports Needs Input without creating a Task.
- [ ] Repeating `by validate` or `by submit` records prior Needs Input as addressed and continues the open Change.
- [ ] Task Resume adopts current Acceptance Context, records prior Needs Input as addressed, and continues the same Change.
- [ ] An explicit `by validate`, `by submit`, or Task Resume starts a fresh code-writing safety budget.
- [ ] Internal retries and publication handoffs do not reset that budget.
- [ ] An unresolved blocker records Needs Input again without losing history.

## Blocked by

- `docs/issues/054-link-tasks-to-changes-and-project-status.md`
- `docs/issues/057-record-code-writing-executions-and-fix-check-findings.md`
- `docs/issues/059-add-final-gates-and-expose-validate.md`
