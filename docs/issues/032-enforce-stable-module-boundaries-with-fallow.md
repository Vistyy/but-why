# Enforce stable module boundaries with Fallow

## Status

Not done.

## Parent

`docs/prds/codebase-quality-tooling-prd.md`

## What to build

Use Fallow to enforce architecture boundaries that are stable after the TaskStore, RunStore, and ValidationRuns seams exist.

The rules should protect the intended direction without encoding temporary file layout too tightly.

Domain code should not import CLI serialization boundaries.

Command and validation code should not import SQLite implementation details directly.

TaskStore, RunStore, and ValidationRuns boundaries should be protected from accidental broad coupling.

## Acceptance criteria

- [ ] Fallow boundary zones cover the source code that needs protection.
- [ ] Files that match no boundary zone are reviewed and either assigned intentionally or documented as unrestricted.
- [ ] Domain modules are blocked from importing CLI output serialization code.
- [ ] Command modules are blocked from importing SQLite implementation details directly.
- [ ] Submit and validation code are blocked from bypassing ValidationRuns for validation start behavior.
- [ ] TaskStore and RunStore boundaries are encoded without preventing intended composition or wiring.
- [ ] Boundary violations fail the quality gate.
- [ ] Boundary failure output identifies the violating import path.
- [ ] Quality passes with the boundary rules enabled.

## Blocked by

- `docs/issues/025-split-taskstore-from-runstore-with-sqlite.md`
- `docs/issues/026-move-validation-start-behind-validationruns.md`
- `docs/issues/031-add-fallow-codebase-health-reporting.md`
