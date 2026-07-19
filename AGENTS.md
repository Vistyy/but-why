## Always-on facts

- But Why? validates completed code changes against approved human intent.
- But Why? is task-based.
- `by` is an agent-first, non-interactive AXI CLI.
- This repository is unreleased, and Task 137 will replace historical schema migrations with one Effect SQL baseline.
  Keep internal code, storage, and documentation names aligned with current domain language by correcting misleading names now.
  Treat historical migrations and planning documents as evidence of earlier decisions rather than naming precedent for current implementation.

## Pointers

- Domain language: `CONTEXT.md`.
- Current v1 architecture: `docs/architecture.md`.
- Current implementation order: `docs/issue-breakdown.md`.
- Approved product specifications: `docs/specs/`.
- Detailed implementation work: `docs/issues/` and `docs/prds/`; PRDs are context, not accepted architecture.
- Development tooling: `docs/tooling.md`.
- Accepted architecture decisions: `docs/adr/`.
- Open design questions: `docs/open-questions.md`.
- Internal configuration reference: `docs/config.md`.
- Internal setup and onboarding: `docs/setup.md`.
- Shipped public docs for installed users: `docs/public/config.md` and `docs/public/setup.md`.

## Issue completion

After completing an issue from `docs/issues/`, update `docs/issue-breakdown.md` in the same commit.
Remove the completed issue from the dependency graph and move each newly unblocked issue into `Can start immediately`.

## Code map

- `src/main.ts`: executable entrypoint.
- `src/cli.ts`: top-level CLI routing.
- `src/cli/`: command modules and output boundary.
- `src/task/`: task use cases.
- `src/validationRun/`: Validation Run domain records and storage ports.
- `src/submit/`: submit flow.
- `src/repoSubmit/`: repo-backed submit flow.
- `src/validation/`: validation gate.
- `src/sqlite/`: SQLite internals.
- `src/output/`: structured output helpers.
- `src/init/`: repo initialization.
- `spikes/`: prototypes and spikes.

## Commands

Run `just` to list available recipes.

Use Just recipes instead of package-manager commands.
