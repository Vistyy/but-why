# Services and Layers

Use an Effect service for a cohesive capability that owns authority, runtime resources, or reusable effect sequencing.
Keep request data, domain values, deterministic calculations, parsers, constructors, and call-specific policy explicit.
Do not create a service only because a test wants to replace a value.
Prefer an installed Effect service when it preserves the required boundary.

Apply the deletion test before adding a service.
Keep the service only when removing it would distribute meaningful behavior or ownership among callers.
Do not combine unrelated dependencies into one service or dependency bag.

Follow the repository's `Context.Tag` conventions unless the installed source and a current need justify another supported form.
Yield stable dependencies during Layer construction and close over them in service methods.
Read operation-scoped context inside the operation that uses it.
Let requirements propagate to the composition root that truthfully selects the implementation.
Do not hide application authority with local `Effect.provide` calls.

Choose Layer operations by their contract:

- Use `Layer.succeed` for an existing value.
- Use `Layer.sync` for lazy synchronous construction.
- Use `Layer.effect` for effectful construction without owned cleanup.
- Use `Layer.scoped` when acquisition owns resources that require cleanup.
- Use `Layer.provide` when supplied dependencies become internal.
- Use `Layer.provideMerge` only when downstream consumers also require the supplied services.
- Use `Layer.mergeAll` only for independent services that must remain exposed.

Do not use Layer composition only to make the types compile.
Keep Layer topology explicit enough to show ownership and lifecycle.

Use a complete static implementation for fixed test behavior.
Call an implementation in-memory only when it preserves the observable contract.
Use a real local Adapter when transactions, serialization, process, or protocol behavior matters.
Keep a narrow partial fake local to the test instead of publishing it as a reusable test Layer.
