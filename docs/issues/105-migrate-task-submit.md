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

This task owns providing the Candidate validation Layer graph to live Change Submit and consuming it for Task-backed and taskless submissions.
Task 136 provides the graph definition and service composition contract.

## Primary verification seam

Public `by change submit <change-id>` CLI tests covering blocked and passing Task-backed and taskless Candidates.

## Acceptance criteria

- [x] Submit accepts only an open Change in the `ready` state and resolves its optional linked Task.
- [x] Dirty Git-visible state is rejected before Candidate or Validation Run creation.
- [x] Task-backed submission runs Prepare, Checks, Acceptance Review, and configured Specialists in order.
- [x] Taskless submission runs Prepare, Checks, and configured Specialists without Acceptance Review.
- [x] Passing changed work publishes only the exact Candidate through deterministic PR recovery.
- [x] Submit reconciles an existing owned PR before it selects a new Candidate or mutates the remote.
- [x] Findings and Tooling Failures return structured evidence.
- [x] A Finding or Tooling Failure moves a linked Task to `implementing`.
- [x] An unchanged taskless Change returns `nothing_to_submit`, remains open, and suggests explicit cancellation.
- [x] Repeated Submit is idempotent and reconciles the owned PR once per invocation.
- [x] Task-owned validation writers are no longer called.
- [x] Change owns the new Submit composition; the migration does not add another top-level Submit workflow.
- [x] Human output remains TOON by default, while programmatic callers can request JSON.

## Blocked by

- `docs/issues/087-inspect-candidate-owned-validation-run.md`
- `docs/issues/089-run-configured-specialists.md`
- `docs/issues/092-recheck-reviewer-findings-without-anchoring.md`
- `docs/issues/096-run-built-in-acceptance-review.md`
- `docs/issues/098-publish-one-exact-candidate-with-recovery.md`
- `docs/issues/101-reconcile-owned-pr-during-submit.md`
- `docs/issues/133-start-prepared-changes.md`
- `docs/issues/136-compose-candidate-validation-through-effect.md`

## Completion

Implemented in `42b8f1d`.
Review corrections: `241c969`, `30c965a`.
Verified with `just quality`: 389 tests passed, with one smoke test skipped.
Spec review: approved.
Standards review: approved.
