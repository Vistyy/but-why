# Compose Candidate validation through Effect

## Status

Done.

## Completion

- Implementation: `65606faec507c363b9bc87d96f547ba34c09a259`
- Review corrections: `e139f6e1831e2e5f6ad54fb52703d1da8e616525`, `1c0f89d1e39755c5c6602e8fa5d110c9655d68f2`
- Task boundary clarification: `c4417c9ea47743a7799536414e625d6686be6c91`

## Specification

- `spikes/effect-first-path/README.md`
- `docs/issues/036-establish-effect-adoption-baseline.md`
- `docs/prds/change-centered-validation-prd.md`
- `docs/architecture.md`

## Behaviors owned

- `spikes/effect-first-path/README.md`: Candidate validation uses the proven single Effect dependency path.
- `docs/issues/036-establish-effect-adoption-baseline.md`: Effect owns validation orchestration, typed tooling failures, resource lifecycles, timing, and dependency composition.
- `docs/issues/036-establish-effect-adoption-baseline.md`: Pure domain judgments remain plain TypeScript values.

## What to build

Migrate the complete Candidate validation workflow to focused Effect Services and Layers provided once at the application edge.
Use the proven Effect-first path for reusable operation identity, testing, timing, workspace lifecycle, and reviewer execution.
Remove the replaced explicit dependency-threading path so the workflow has one composition model.

This task owns the definition of the production Candidate validation Layer graph and its service interfaces.
It does not wire that graph into the live Submit workflow.
Task 105 owns live Submit composition and Candidate validation consumption.

## Primary verification seam

Candidate validation integration tests that provide test Layers and exercise Prepare, Checks, Acceptance Review, and configured Specialists through the same workflow interface used by production composition.

## Acceptance criteria

- [ ] Candidate validation declares its external requirements through focused Effect Services.
- [ ] One production Layer graph provides Candidate validation dependencies at the application edge.
- [ ] Integration tests provide test Layers through the same service interfaces.
- [ ] Effect-returning tests use the compatible `@effect/vitest` integration where it owns execution, scope, or virtual time.
- [ ] Reusable workflow operations use `Effect.fn` with stable operation names.
- [ ] Workspace cleanup uses Effect-native timeout handling and preserves cleanup order, interruption, and typed failure evidence.
- [ ] Prepare, Checks, Acceptance Review, Specialist, and reviewer revision behavior remains unchanged from their owning Tasks.
- [ ] Findings remain successful domain judgments and Validation Tooling Failures remain in the Effect error channel.
- [ ] Pure Task, Change, Candidate, Validation Run, Finding, and policy modules do not expose Effect environment types.
- [ ] Dependency construction is not scattered through local `Effect.provide` calls or shallow accessor wrappers.
- [ ] The replaced explicit Candidate validation dependency path is removed.
- [ ] Direct Effect runtime execution remains limited to the executable boundary.

## Blocked by

- `docs/issues/089-run-configured-specialists.md`
- `docs/issues/092-recheck-reviewer-findings-without-anchoring.md`
