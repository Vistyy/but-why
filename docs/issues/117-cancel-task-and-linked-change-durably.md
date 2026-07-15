# Cancel a Task and linked Change durably

## Specification

- `docs/prds/change-centered-validation-prd.md`
- `CONTEXT.md`
- `docs/adr/0008-use-change-as-validation-and-delivery-owner.md`
- `docs/adr/0012-control-task-progress-through-lifecycle-operations.md`

## Behaviors owned

- Cancellation permanently ends any unfinished Task for a required reason.
- It closes the linked Change, fences future writes, preserves history, and leaves dependencies unsatisfied.
- Repeated cancellation is idempotent.

## What to build

Implement durable Task and Change cancellation before process and GitHub cleanup are expanded by dependent tasks.
All later workflow operations must reject the terminal facts.

## Primary verification seam

Task cancellation state test.

## Acceptance criteria

- [ ] `by task cancel <id> --reason <reason>` accepts New and every other nonterminal Task state.
- [ ] Missing or empty reason is a usage error before mutation.
- [ ] Cancellation atomically records the reason, moves the Task to Cancelled, and closes its open Change as cancelled.
- [ ] Active Validation Attempts and future writers are fenced by the durable terminal facts.
- [ ] Repeated cancellation returns the original result as a successful no-op.
- [ ] Done cannot be cancelled.
- [ ] Cancelled Tasks are read-only, leave Task Queue Order, and never satisfy dependencies.

## Open decisions to grill

- Reason size and input-file support.
- Cleanup-pending fields exposed before dependent cleanup tasks complete.

## Blocked by

- `docs/issues/079-manage-task-dependency-graph.md`
- `docs/issues/085-recover-interrupted-standalone-validation.md`
