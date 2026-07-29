## Always-on facts

- But Why? validates submitted code against approved human intent.
- But Why? is task-based.
- `by` is an agent-first, non-interactive AXI CLI.
- This repository is unreleased.
- State storage uses immutable ordered Effect SQL migrations beginning with `0001_baseline`.
- SQLite Tasks are the source of truth for new active work.
  Treat `docs/issues/` as historical implementation records.
- Use current domain terms in code, storage, and documentation.
  Correct misleading names now.
- Treat historical migrations and planning documents as historical evidence.
  Do not use them as naming precedent for current implementation.

## Pointers

- Canonical domain language: `CONTEXT.md`.
- Current v1 architecture: `docs/architecture.md`.
- Agent-first CLI output policy: `docs/cli-output.md`.
- Current implementation order: `docs/issue-breakdown.md`.
- Approved product specifications: `docs/specs/`.
- Active implementation work: SQLite Tasks through `by task`.
- Historical implementation evidence: `docs/issues/` and `docs/prds/`; PRDs are context, not accepted architecture.
- Development tooling: `docs/tooling.md`.
- Accepted architecture decisions: `docs/adr/`.
- Open design questions: `docs/open-questions.md`.
- Internal configuration reference: `docs/config.md`.
- Internal setup and onboarding: `docs/setup.md`.
- Shipped public docs for installed users: `docs/public/config.md` and `docs/public/setup.md`.

## Historical issue completion

When completing work still linked to an issue in `docs/issues/`, update `docs/issue-breakdown.md` in the same commit.
Remove the completed historical issue from any remaining Markdown dependency graph.
Record active dependencies through `by task dependencies set`.

## Code map

- `src/main.ts`: executable entrypoint.
- `src/cli.ts`: top-level CLI routing.
- `src/cli/`: command modules and output boundary.
- `src/task/`: Task intent, lifecycle, persistence interfaces, files, and composition.
- `src/change/`: Change workflows and Change-owned implementation, Candidate, validation, and delivery modules.
- `src/change/candidate/`: Candidate domain records.
- `src/change/candidateCapture/`: Candidate capture interfaces and Git adapters.
- `src/change/candidateValidation/`: Candidate validation policy, execution, inspection, and composition.
- `src/change/validation/`: Change validation gate and validation adapters.
- `src/change/validationRun/`: Validation Run domain records and evidence.
- `src/change/publication/`: Candidate publication policy and Git adapter.
- `src/change/submit/`: Change submission configuration and errors.
- `src/agent/`: reviewer-agent execution and profile resolution.
- `src/contracts/`: configuration, output, and shared error contracts.
- `src/init/`: Local Repository initialization and repository context.
- `src/output/`: structured output codecs and serializers.
- `src/repositoryPreparation/`: shared Repository Preparation adapter.
- `src/sqlite/`: SQLite persistence adapters.
- `src/submissionEnvironment/`: Git and GitHub submission-environment adapters.
- `spikes/`: prototypes and spikes.

## Repository synchronization

Before starting a new investigation, Task design, or Change from the main checkout, fetch `origin/main` if it has not been fetched in the current session.
If local `main` is clean and can fast-forward, fast-forward it.
Refresh again after an external merge or before a new work item after a long session.
Otherwise, preserve the checkout and report its state.
Do not merge, rebase, or reset automatically.

## Commands

Run `just` to list available recipes.

Use Just recipes instead of package-manager commands.
