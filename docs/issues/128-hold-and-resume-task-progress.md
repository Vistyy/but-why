# Hold and resume Task progress

## Specification

- `docs/prds/change-centered-validation-prd.md`
- `CONTEXT.md`
- `docs/adr/0012-control-task-progress-through-lifecycle-operations.md`

## Behaviors owned

- Hold temporarily stops Todo, implementing, validating, or ready work for a required reason.
- Held is a visible Task state that preserves its interrupted stage and durable history.
- Resume restarts from the last durable checkpoint with fresh processes.
- An owned PR becomes draft while held and remains draft until the resumed Candidate again satisfies readiness policy.

## What to build

Implement `by task hold` and extend `by task resume` through the Task, Change, execution, worker, dashboard, inspection, and GitHub boundaries.
Reuse the local stopping and write-fencing seam instead of adding process suspension.

## Primary verification seam

End-to-end Task Hold and Resume test with fake Pi and GitHub.

## Acceptance criteria

- [ ] Hold requires a non-empty operational reason and is legal only from Todo, implementing, validating, or ready.
- [ ] Hold commits the write fence before signalling active processes and projects the Task as Held.
- [ ] Hold records the interrupted stage without treating its reason as Task Context.
- [ ] Hold requests conversion of an owned PR to draft and records whether GitHub confirmed remote protection.
- [ ] Failed confirmation leaves the local Hold active, exposes `remote protection unconfirmed`, and retries best effort.
- [ ] An externally observed merge remains authoritative and completes the Task during remote uncertainty.
- [ ] New, Needs Input, Done, and Cancelled Tasks reject Hold with their legal actions.
- [ ] A Held Todo Task may edit pre-start Task Context, `afk`, dependencies, and queue position.
- [ ] A Held started Task may add Task Comments, and every Held Task may inspect, Resume, Complete when eligible, or Cancel.
- [ ] Resume with unchanged Task Context retries the interrupted stage from its last durable checkpoint.
- [ ] Resume with new Task Comments adopts a new Acceptance Context and returns through implementation.
- [ ] Resume preserves dirty manual work and rejects until the user makes that workspace clean.
- [ ] Resume archives dirty automatic work as an immutable recovery Artifact before rebuilding from the last durable Candidate.
- [ ] Resume never resumes agent sessions or processes.
- [ ] An owned PR stays draft until the current Candidate is validated and again satisfies readiness policy.
- [ ] The dashboard shows Held Tasks in Task Queue Order, and detail includes reason, interrupted stage, and complete legal command templates.
- [ ] A user-requested Hold does not consume an automatic retry or reset the current Code-Writing Budget Cycle.

## Open decisions to grill

- Process-stop timeout and remote draft-conversion retry schedule.
- Exact Hold, Resume, dashboard, and inspection AXI schemas.

## Blocked by

- `docs/issues/081-show-actionable-task-dashboard.md`
- `docs/issues/097-resume-task-backed-change.md`
- `docs/issues/101-reconcile-one-owned-pr-once.md`
- `docs/issues/118-stop-active-local-work-after-cancellation.md`
