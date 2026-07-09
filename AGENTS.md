## Always-on facts

- But Why? validates completed code changes against approved human intent.
- But Why? is task-based.
- `by` is an agent-first, non-interactive AXI CLI.

## Pointers

- Domain language: `CONTEXT.md`.
- Current v1 architecture: `docs/architecture.md`.
- Current implementation order: `docs/issue-breakdown.md`.
- Detailed implementation work: `docs/issues/` and `docs/prds/`; PRDs are context, not accepted architecture.
- Development tooling: `docs/tooling.md`.
- Accepted architecture decisions: `docs/adr/`.
- Open design questions: `docs/open-questions.md`.
- Internal configuration reference: `docs/config.md`.
- Internal setup and onboarding: `docs/setup.md`.
- Shipped public docs for installed users: `docs/public/config.md` and `docs/public/setup.md`.

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
