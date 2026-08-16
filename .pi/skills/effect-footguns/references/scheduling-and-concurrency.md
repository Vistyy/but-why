# Scheduling and concurrency

Before writing custom retry, polling, timeout, cache, queue, stream, or worker mechanics, inspect the matching installed Effect capability.
Adopt it only when it preserves the operation's required policy and recovery behavior.

Retry only expected typed failures at the narrowest established-idempotent boundary.
Bound retries.
Use jitter when concurrent clients could synchronize against a shared provider.
Remember that the initial effect runs before a schedule, so `Schedule.recurs(3)` permits three additional executions.
Keep explicit workflow loops when each attempt changes persisted state, prompts, identity, or policy.

Create a cache once in the scope that owns its lifetime.
Set a capacity and decide deliberately whether failures are cached.
Do not cache transient failures or degraded fallbacks by default.
Do not replace durable SQLite identity, reuse, coordination, or locking with an in-memory Effect cache.

Do not introduce a Stream only to repeat an effect that emits no values.
Bound buffers and choose suspension, dropping, or sliding deliberately.
Do not collect an unbounded production stream.

Start long-lived consumers with scoped fibers so Layer acquisition completes and scope closure interrupts them.
A timeout around a Promise does not prove that the underlying operation stopped.
Require and verify cancellation at the Adapter contract before relying on timeout or interruption for mutation safety.
