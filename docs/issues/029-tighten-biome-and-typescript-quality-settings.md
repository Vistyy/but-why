# Tighten Biome and TypeScript quality settings

## Status

Not done.

## Parent

`docs/prds/codebase-quality-tooling-prd.md`

## What to build

Make the existing quality gate stricter using the tools already in the project.

Biome should explicitly enforce important lint rules instead of relying only on defaults.

Console usage should be blocked in production source.

Explicit `any`, non-null assertions, and barrel files should be blocked across Biome-checked TypeScript unless a concrete incompatibility requires a documented override.

TypeScript should enable compatible strict compiler options that catch unreachable code, unused labels, and unsafe index-signature property access.

Compatible means fixable in this issue without product behavior changes.

The implementer should report any overrides needed to keep stricter rules passing.

The normal quality command should continue to run formatting, linting, typechecking, and tests.

## Acceptance criteria

- [ ] Biome explicitly blocks console usage in production source.
- [ ] Biome explicitly blocks explicit `any` usage across Biome-checked TypeScript unless a concrete incompatibility requires a documented override.
- [ ] Biome explicitly blocks non-null assertions across Biome-checked TypeScript unless a concrete incompatibility requires a documented override.
- [ ] Biome explicitly blocks barrel files across Biome-checked TypeScript unless a concrete incompatibility requires a documented override.
- [ ] TypeScript rejects unreachable code.
- [ ] TypeScript rejects unused labels.
- [ ] TypeScript rejects unsafe property access from index signatures where compatible with the current codebase.
- [ ] The existing quality command still runs format check, lint, typecheck, and tests.
- [ ] Existing code is updated to satisfy the stricter settings when the fix does not change product behavior.
- [ ] Any overrides needed for compatibility are reported by the implementer.
- [ ] Quality passes after the stricter settings are enabled.

## Blocked by

None - can start immediately.
