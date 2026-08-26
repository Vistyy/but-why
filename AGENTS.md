# Contributor agent instructions

These instructions govern agents changing the But Why source repository.
They do not describe how agents use But Why in a target repository.

## Development authorities

- Read `CONTEXT-MAP.md` and the applicable context before naming or changing domain behavior.
- Read `docs/architecture.md` before changing ownership, dependencies, workflow boundaries, application operations, persisted-state transitions, persistence abstractions, or transaction boundaries.
- Read `VISION.md` before proposing or implementing a change to product direction, scope, or a lasting acceptance boundary.
- Read the applicable accepted decisions in `docs/adr/` before changing their constraints.
- Read `docs/cli-output.md` when changing structured CLI output.
- Follow the shared Documentation policy in the `writing-instructions` skill when changing documentation.

## Runtime safety

- The globally installed built `by` executable is the only CLI permitted to open or mutate live Shared Repository State.
- Run source and Candidate executables only in disposable test repositories with independent Git Common Directories and state.
- A migration introduced by an unmerged Change may be revised or removed, including after Candidate tests applied it to disposable state.
- Once a migration is present on `main`, treat it as potentially applied: preserve it and express later schema changes through a new ordered migration.

## Product interface boundary

- Treat packaged CLI help, `docs/public/`, packaged `extensions/`, and injected agent prompts as product interfaces produced by this repository.
- These interfaces must work in target repositories without access to this repository's contributor instructions, context files, internal documentation, or development files.
- Portable guidance may direct agents to discover target-repository instructions, but it must not assume a particular instruction file, tool, directory, or domain context.
- Package every required extension and reference, or declare an explicit configurable external dependency with actionable failure behavior.

## Repository workflow

- Before starting new work from the main checkout, fetch `origin/main` if it has not been fetched in the current session.
- Fast-forward a clean local `main` when possible; otherwise preserve its state and report why it was not updated.
- Refresh after an external merge or before new work after a long session.
- Do not merge, rebase, or reset automatically.
- Read `docs/tooling.md` before selecting contributor checks or changing architecture enforcement.
- Use Just recipes for repository workflows, and run `just` to discover the current recipes.
- Use focused checks during implementation and `just quality` only when repository-wide blocking verification is required.
