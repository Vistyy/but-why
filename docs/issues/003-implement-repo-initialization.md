# Implement repo initialization

## Parent

`docs/prd.md`

## What to build

Implement repo-local initialization for But Why?.

Initialization should create the local state and config structure needed by later task and validation commands.

## Acceptance criteria

- [ ] `by init --task-prefix <prefix>` initializes the current repo non-interactively.
- [ ] Interactive `by init` is allowed for humans.
- [ ] A task prefix is required.
- [ ] Repo-local config is created.
- [ ] Repo-local SQLite state is created.
- [ ] A reviewer-instruction location is created.
- [ ] Local state paths are added to `.gitignore`.
- [ ] Re-running init is idempotent when configuration already matches.
- [ ] Init does not require global agent profiles.

## Blocked by

- 002-create-typescript-cli-foundation.md
