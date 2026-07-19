# Migrate Submit to Change ownership

## Specification

- `docs/prds/change-centered-validation-prd.md`
- `docs/specs/taskless-changes-and-worktree-handoff.md`
- `CONTEXT.md`
- `docs/adr/0008-use-change-as-validation-and-delivery-owner.md`

## Behaviors owned

- Public `by change submit <change-id>` composes Candidate validation, publication, and reconciliation for Task-backed and taskless Changes.
- Acceptance Review runs only when the Change has Acceptance Context.
- Findings and Tooling Failures return linked Tasks to implementing when applicable.

## What to build

Compose the Candidate-owned capabilities behind one Change Submit module and migrate the public command to Change identity without dual writes or a standalone validation command.

## Primary verification seam

Public `by change submit <change-id>` CLI tests covering blocked and passing Task-backed and taskless Candidates.

## Acceptance criteria

- [ ] Submit accepts an open ready Change and resolves its optional linked Task.
- [ ] Dirty Git-visible state is rejected before Candidate or Validation Run creation.
- [ ] Task-backed submission runs Prepare, Checks, Acceptance Review, and configured Specialists in order.
- [ ] Taskless submission runs Prepare, Checks, and configured Specialists without Acceptance Review.
- [ ] Passing changed work publishes only the exact Candidate through deterministic PR recovery.
- [ ] Existing owned PRs reconcile before any new Candidate or remote mutation is selected.
- [ ] Findings and Tooling Failures return structured evidence and update linked Task progress when present.
- [ ] An unchanged taskless Change returns `nothing_to_submit`, remains open, and suggests explicit cancellation.
- [ ] Repeated Submit is idempotent and performs one-shot PR reconciliation.
- [ ] Task-owned validation writers are no longer called.
- [ ] Change owns the new Submit composition; the migration does not add another top-level Submit workflow.
- [ ] Human output remains TOON by default, while programmatic callers can request JSON.

## Blocked by

- `docs/issues/087-inspect-candidate-owned-validation-run.md`
- `docs/issues/089-run-configured-specialists.md`
- `docs/issues/092-recheck-reviewer-findings-without-anchoring.md`
- `docs/issues/096-run-built-in-acceptance-review.md`
- `docs/issues/098-publish-one-exact-candidate-with-recovery.md`
- `docs/issues/101-reconcile-owned-pr-during-submit.md`
- `docs/issues/133-start-prepared-changes.md`
