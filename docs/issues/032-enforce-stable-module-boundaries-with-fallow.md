# Enforce stable module boundaries with Fallow

## Status

Not done.

## Parent

`docs/prds/codebase-quality-tooling-prd.md`

## What to build

Use Fallow to enforce the domain-centered modular monolith shape from ADR 0006.

The rules should protect the intended direction without encoding temporary file layout too tightly.

CLI and output code should stay at the edge.

Domain-named modules and use cases should sit at the center.

SQLite, GitHub, Sandcastle, and output formats should be treated as adapters.

Ports should exist only where behavior truly varies.

Domain code should not import CLI serialization boundaries.

Command and validation code should not import SQLite implementation details directly.

Concrete SQLite stores should be wired only through the local repo storage seam, except in tests.

TaskStore, RunStore, and ValidationRuns boundaries should be protected from accidental broad coupling.

## Implementation notes

- Add a local repo storage wiring seam, expected at `src/init/repoLocalStores.ts` unless a better repo-local setup name emerges during implementation.
- Move concrete SQLite task, run, and validation store construction behind that seam.
- Remove direct concrete SQLite imports from `src/task/taskUseCases.ts` and `src/localSubmit/submitPreflight.ts`.
- Refactor Fallow toward broad role zones such as CLI edge, output boundary, use cases, ports, local orchestration, SQLite adapter, and repo-local storage wiring.
- Add hard policy bans for the dangerous leaks: concrete SQLite stores outside production wiring, and output serializers inside command code.
- Keep tests allowed to import concrete SQLite stores directly.

## Acceptance criteria

- [ ] Fallow boundary zones cover the source code that needs protection.
- [ ] Files that match no boundary zone are reviewed and either assigned intentionally or documented as unrestricted.
- [ ] Domain modules are blocked from importing CLI output serialization code.
- [ ] Command modules are blocked from importing SQLite implementation details directly.
- [ ] Concrete SQLite task, run, and validation stores are imported only by the local repo storage wiring seam in production code.
- [ ] Tests may import concrete SQLite stores directly.
- [ ] Submit code depends on TaskAuthority, SubmissionEnvironment, ValidationRuns, or repo-local wiring, not concrete SQLite stores.
- [ ] Submit and validation code are blocked from bypassing ValidationRuns for validation start behavior.
- [ ] Task use cases may compose TaskStore and RunStore roles, but not concrete SQLite stores.
- [ ] CLI command code may import structured output types, but not JSON, TOON, or serializer implementation code.
- [ ] TaskStore and RunStore boundaries are encoded without preventing intended composition or wiring.
- [ ] Boundary violations fail the quality gate as hard errors.
- [ ] Boundary failure output identifies the violating import path.
- [ ] Quality passes with the boundary rules enabled.

## Blocked by

- `docs/issues/025-split-taskstore-from-runstore-with-sqlite.md`
- `docs/issues/026-move-validation-start-behind-validationruns.md`
- `docs/issues/031-add-fallow-codebase-health-reporting.md`
