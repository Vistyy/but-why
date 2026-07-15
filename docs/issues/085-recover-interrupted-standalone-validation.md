# Recover interrupted standalone validation

## Specification

- `docs/prds/change-centered-validation-prd.md`
- `CONTEXT.md`
- `docs/adr/0009-keep-needs-input-an-orchestration-owned-circuit-breaker.md`
- `docs/adr/0008-use-change-as-validation-and-delivery-owner.md`

## Behaviors owned

- One lease holder may advance an active Execution Attempt.
- Tooling failure ends only that Attempt and receives one automatic fresh Attempt in the same Run.
- After the approved retry is exhausted, But Why? code leaves the Run unfinished and records Needs Input from the second Tooling Failure.
- Attempt identity and state fence late writes and prevent duplicate execution.

## What to build

Add Execution Attempt leases, controlled-clock expiry, one automatic tooling retry, and explicit continuation after recovery exhaustion.
Every retry uses the Run's exact immutable inputs in a fresh workspace.

## Primary verification seam

Controlled-clock concurrent CLI test.

## Acceptance criteria

- [ ] One unexpired lease holder may write to an active Attempt.
- [ ] Lease expiry atomically ends that Attempt as `tooling_failed` before another Attempt starts.
- [ ] The first Tooling Failure creates one automatic fresh Attempt in the same Run.
- [ ] The automatic retry uses a fresh workspace and the original immutable inputs.
- [ ] A second Tooling Failure leaves the Run active without an outcome and records Change-level Needs Input.
- [ ] A later explicit validation request may address Needs Input and create another fresh Attempt in that Run.
- [ ] Hold and cancellation stop an Attempt without consuming the automatic tooling retry.
- [ ] Attempt UUID and active-state checks reject every late or duplicate write.
- [ ] Concurrent requests reuse the same active Attempt rather than starting duplicate execution.

## Open decisions to grill

- Lease duration, heartbeat cadence, and clock-skew tolerance.
- Which low-level failures are Submit Rejections before an Attempt rather than Tooling Failures inside one.
- Exact recovery, late-write, and concurrent-request AXI schemas.

## Blocked by

- `docs/issues/084-validate-standalone-candidate-through-checks.md`
