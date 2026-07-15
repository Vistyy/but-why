# Stop active local work after cancellation

## Specification

- `docs/prds/change-centered-validation-prd.md`
- `CONTEXT.md`
- `docs/adr/0008-use-change-as-validation-and-delivery-owner.md`
- `docs/adr/0012-control-task-progress-through-lifecycle-operations.md`

## Behaviors owned

- Durable cancellation stops active validation, reviewer, Fixer, Implementer, and worker processes.
- Late writes remain fenced even when process termination is delayed or uncertain.
- The same stopping seam is reusable by temporary Hold.

## What to build

Propagate a durable stop request to every local execution owner and report whether each process stopped or remains uncertain.
Do not make process exit the source of terminal truth.

## Primary verification seam

Active-process cancellation test.

## Acceptance criteria

- [ ] Durable cancellation becomes visible to every active local execution owner.
- [ ] Cooperative processes receive cancellation and their execution records end consistently.
- [ ] Unresponsive processes cannot write accepted domain results after the fence.
- [ ] The command reports stopped, already stopped, and uncertain process outcomes distinctly.
- [ ] Restart and recovery never relaunch work for the Cancelled Task.
- [ ] The stopping mechanism is callable without terminally closing the Task so Hold can reuse it later.

## Open decisions to grill

- Process termination timeout and escalation policy.
- Exact uncertain-process output and later recovery check.

## Blocked by

- `docs/issues/092-verify-one-specialist-revision.md`
- `docs/issues/108-implement-one-eligible-afk-task.md`
- `docs/issues/111-wake-registered-repository-worker.md`
- `docs/issues/117-cancel-task-and-linked-change-durably.md`
