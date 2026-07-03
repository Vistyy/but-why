# Tighten Biome and TypeScript quality settings

## Status

Not done.

## Parent

`docs/prds/codebase-quality-tooling-prd.md`

## What to build

Make the existing quality gate stricter using the tools already in the project.

Biome should explicitly enforce important lint rules instead of relying only on defaults.

TypeScript should enable compatible strict compiler options that catch unreachable code, unused labels, and unsafe index-signature property access.

The normal quality command should continue to run formatting, linting, typechecking, and tests.

## Acceptance criteria

- [ ] Biome explicitly blocks console usage in production source.
- [ ] Biome explicitly blocks explicit any usage where compatible with the current codebase.
- [ ] Biome explicitly blocks non-null assertions where compatible with the current codebase.
- [ ] Biome explicitly blocks barrel files where compatible with the current codebase.
- [ ] TypeScript rejects unreachable code.
- [ ] TypeScript rejects unused labels.
- [ ] TypeScript rejects unsafe property access from index signatures where compatible with the current codebase.
- [ ] The existing quality command still runs format check, lint, typecheck, and tests.
- [ ] Existing code is updated to satisfy the stricter settings.
- [ ] Quality passes after the stricter settings are enabled.

## Blocked by

None - can start immediately.
