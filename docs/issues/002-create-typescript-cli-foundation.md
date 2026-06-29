# Create the TypeScript CLI foundation

## Parent

`docs/prd.md`

## What to build

Create the project foundation for the `by` CLI.

The CLI should be runnable, use the chosen TypeScript quality stack, and establish agent-first output conventions before product behavior is added.

## Acceptance criteria

- [ ] The `by` executable can run from the repo.
- [ ] Running `by` prints a structured empty dashboard instead of generic help.
- [ ] Structured output goes to stdout.
- [ ] Progress and diagnostics go to stderr.
- [ ] The project uses strict TypeScript, Effect, Effect Schema, SQLite access, linting, typechecking, and tests.
- [ ] A single quality command verifies linting, typechecking, and tests.
- [ ] CLI errors are structured and actionable.

## Blocked by

- 001-prove-sandcastle-v1-execution.md
