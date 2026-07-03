# Add ast-grep structural bans

## Status

Not done.

## Parent

`docs/prds/codebase-quality-tooling-prd.md`

## What to build

Add ast-grep for exact forbidden code patterns that are easier to express structurally than through TypeScript, Biome, or Fallow.

The first rules should protect stable architecture constraints.

Rules that depend on new seams should be added only after those seams exist.

The scan should be part of the quality gate and should produce clear diagnostics for agents.

## Acceptance criteria

- [ ] ast-grep is installed as a development tool.
- [ ] ast-grep project configuration exists.
- [ ] ast-grep scans the TypeScript source used by the project.
- [ ] A rule blocks direct SQLite construction outside allowed storage or init implementation code.
- [ ] A rule blocks direct stdout writes outside the CLI edge.
- [ ] A rule blocks inline Task state unions outside lifecycle and policy seams after issue 023.
- [ ] A rule blocks raw Task ID parsing outside the Task ID seam after issue 024.
- [ ] A rule blocks direct branch, ref, or worktree path construction from raw Task IDs after slug helpers exist.
- [ ] Each rule has a clear message that tells the contributor which seam to use instead.
- [ ] The ast-grep scan is wired into the quality gate.
- [ ] Quality passes with the ast-grep rules enabled.

## Blocked by

- `docs/issues/024-make-task-identity-opaque-and-slug-safe.md`
- `docs/issues/029-tighten-biome-and-typescript-quality-settings.md`
