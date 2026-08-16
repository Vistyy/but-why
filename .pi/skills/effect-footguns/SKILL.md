---
name: effect-footguns
description: Use when adding, upgrading, designing, writing, modifying, or reviewing Effect or an @effect package, or TypeScript code that uses Effect services, Layers, Schema, schedules, streams, caches, or @effect/vitest in this repository.
compatibility: But Why repository. The Effect and @effect versions pinned in package.json are authoritative.
---

# Effect Foot-guns

Follow repository architecture when introducing an Effect abstraction or moving behavior into Effect.
Before using an unfamiliar API or external example, check `package.json` and the installed package source.
Do not copy APIs from another Effect version.

Before building custom effectful infrastructure, check whether the installed Effect packages already provide the required capability.
Keep custom work when the library capability does not preserve the required ownership, durability, recovery, or boundary behavior.

Read only the references that match the work:

- Read [Services and Layers](references/services-and-layers.md) when adding or changing a service, port, Layer, dependency, resource acquisition, or test implementation.
- Read [Boundaries](references/boundaries.md) when decoding data, modeling errors, reading configuration, or implementing an external Adapter.
- Read [Scheduling and concurrency](references/scheduling-and-concurrency.md) when adding retries, polling, timeouts, caches, queues, streams, background work, or Promise cancellation.
- Read [Testing](references/testing.md) when changing an Effect workflow test or testing time, concurrency, interruption, cleanup, or a service replacement.

In domain workflows and Adapters, keep expected failures typed and preserve defects and interruption unless the current boundary has a truthful recovery.
The CLI output boundary may convert a cause into its documented safe structured failure, but it must not report success.
Do not report a timeout or interruption as complete while an underlying operation can continue mutating state.
Before retrying an uncertain mutation, reconcile its result through authoritative observation.
Retry only operations with established idempotency.

After changing Effect code, run `just typecheck` and proportionate focused verification.
Treat non-error Effect diagnostics as review candidates, not requirements.
