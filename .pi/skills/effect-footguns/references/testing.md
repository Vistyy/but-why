# Testing

Use `@effect/vitest` for tests that return or execute an Effect.
Use `it.live` only when live runtime services are part of the behavior under test.

Use `TestClock` for Effect sleeps, schedules, retries, leases, and timeouts.
Fork an effect that sleeps before advancing `TestClock`.
Do not replace OS time in real-process, filesystem-observation, or external-integration tests with `TestClock`.

Do not coordinate concurrent Effect tests with arbitrary sleeps.
Use `Deferred` for one-time readiness or completion, `Queue` for controlled exchange, `Latch` for gates, and `Ref` for shared observations.
Use an explicit test hook only when the production boundary has a truthful deterministic synchronization point.

When relevant to the behavior, verify typed failures, interruption, finalization, rollback, retry bounds, idempotency, and malformed persistence.
A test double does not prove integration, process cancellation, transaction behavior, or protocol behavior.
Use a real local Adapter when those facts matter.

Use a complete static service replacement for fixed behavior.
Use a stateful test service only when reusable control or observation justifies its interface.
Keep one-off partial fakes local and make unexpected calls fail clearly.
