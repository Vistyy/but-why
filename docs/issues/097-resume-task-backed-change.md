# Resume a Task-backed Change from Needs Input

## Specification

- `docs/prds/change-centered-validation-prd.md`
- `CONTEXT.md`
- `docs/adr/0009-keep-needs-input-an-orchestration-owned-circuit-breaker.md`
- `docs/adr/0008-use-change-as-validation-and-delivery-owner.md`
- `docs/adr/0012-control-task-progress-through-lifecycle-operations.md`

## Behaviors owned

- Resume continues one linked Change after its Needs Input blocker is addressed.
- A new Task Comment is implementation guidance, while an external-resolution reason is operational evidence.
- Resume starts fresh work from the last durable checkpoint and never resumes a process or agent session.
- Later Hold support reuses and expands this Resume boundary.

## What to build

Implement Task Resume for Needs Input with exactly one accepted form of new evidence: a Task Comment added while blocked or an external-resolution reason supplied by the command.

## Primary verification seam

Task Resume CLI test.

## Acceptance criteria

- [ ] Resume is accepted only for a Task whose open Change records Needs Input.
- [ ] Resume requires either a new Task Comment or an external-resolution reason.
- [ ] A new comment creates a new Acceptance Context snapshot and returns through implementation.
- [ ] An external-resolution reason leaves Task Context unchanged and retries the blocked stage.
- [ ] Existing unresolved Findings count as implementation guidance when the blocker allows fixing.
- [ ] Resume starts fresh processes from the last durable Candidate and discards no history.
- [ ] A fresh code-writing budget applies to the resumed implementation cycle.
- [ ] A rejected or concurrent Resume leaves the blocker and evidence unchanged.

## Open decisions to grill

- Exact `--reason` and comment-reference syntax.
- Multiple-comment detection and concurrent Resume output.

## Blocked by

- `docs/issues/083-start-eligible-task-backed-change-manually.md`
- `docs/issues/084-validate-standalone-candidate-through-checks.md`
- `docs/issues/091-fix-check-findings-with-pi.md`
