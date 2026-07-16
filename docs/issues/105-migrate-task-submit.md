# Migrate Task Submit to Candidate ownership

## Specification

- `docs/prds/change-centered-validation-prd.md`
- `CONTEXT.md`
- `docs/adr/0008-use-change-as-validation-and-delivery-owner.md`

## Behaviors owned

- Public `by submit <task-id>` composes the new Change, Candidate, validation, publication, and reconciliation capabilities behind one command.
- Findings and Tooling Failures return the Task to implementing.

## What to build

Compose the new Candidate-owned capabilities behind one small Submit module and switch the public Task-backed command to it without dual writes or a standalone validation command.

## Primary verification seam

Public `by submit <task-id>` CLI test covering blocked and passing changed Candidates.

## Acceptance criteria

- [ ] Submit accepts an approved started Task and returns an existing Done result idempotently, while New, Todo, and Cancelled Tasks are rejected with legal actions.
- [ ] Dirty Git-visible state is rejected before Candidate or Run creation.
- [ ] The command captures the Candidate and runs Prepare, Checks, Acceptance, and configured Specialists in order.
- [ ] Passing changed work publishes only the exact Candidate through deterministic PR recovery.
- [ ] Existing owned PRs reconcile before any new Candidate or remote mutation is selected.
- [ ] Findings and Tooling Failures return structured evidence and move validating back to implementing.
- [ ] Passing publication moves the Task to ready.
- [ ] Repeated Submit is idempotent and performs one-shot PR reconciliation.
- [ ] Task-owned validation writers are no longer called.
- [ ] Existing inspection remains green until its migration Task lands.

## Blocked by

- `docs/issues/083-start-task-in-managed-worktree.md`
- `docs/issues/087-inspect-candidate-owned-validation-run.md`
- `docs/issues/089-run-configured-specialists.md`
- `docs/issues/092-recheck-reviewer-findings-without-anchoring.md`
- `docs/issues/096-run-built-in-acceptance-review.md`
- `docs/issues/098-publish-one-exact-candidate-with-recovery.md`
- `docs/issues/101-reconcile-owned-pr-during-submit.md`
