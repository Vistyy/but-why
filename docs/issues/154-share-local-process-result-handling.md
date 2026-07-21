# Share local process result handling

## Specification

- [Target quality policy](../tooling.md#quality-policy)
- [Launch the Task implementer in Herdr](130-launch-task-implementer-in-herdr.md)
- [Start prepared Changes](133-start-prepared-changes.md)

## Behaviors owned

- Herdr and Repository Preparation capture stdout, stderr, exit, and process errors consistently.
- Each adapter retains its own command, timeout, lifecycle, and domain result behavior.
- Both adapters expose the same observable process-result contract for output, exit, and launch failure.
- Baseline finding D2 belongs to this task.

## What to build

Make Herdr and Repository Preparation return complete and consistent process results.

Preserve each adapter's command, timeout, lifecycle, and domain-specific result behavior.

## Primary verification seam

`by change start` and `by change implement` preserve complete command output and stable failures through Repository Preparation and Herdr.
Focused adapter tests additionally verify the shared process-result cases.

## Acceptance criteria

- [ ] Both adapters capture complete stdout and stderr.
- [ ] Spawn errors, process exit, and incomplete process states preserve their current public results.
- [ ] Adapter-specific timeout and lifecycle behavior remains separate.
- [ ] Baseline finding D2 is resolved.
- [ ] Change implementation and Repository Preparation behavior tests pass.

## Blocked by

- [Task 148](148-establish-audited-quality-baseline.md)
