## Always-on facts

- But Why validates submitted code against approved human intent.
- But Why is task-based.
- `by` is an agent-first, non-interactive CLI.
- This repository is unreleased.
- Shared Repository State uses immutable ordered Effect SQL migrations beginning with `0001_baseline`.
- SQLite Tasks are the source of truth for active work and accepted implementation intent.
- Use current domain terms in code, storage, and documentation.

## Documentation

- Read `CONTEXT.md` before naming domain-facing behavior.
- Read `docs/architecture.md` for current ownership and workflow boundaries.
- Read `docs/cli-output.md` for structured CLI output contracts.
- Read `docs/tooling.md` for contributor verification and architecture checks.
- Read accepted decisions in `docs/adr/` when a change affects their constraints.
- Read the `writing-instructions` and `technical-prose` skills before changing documentation.
- Treat SQLite Tasks as the authority for proposed work, progress, dependencies, and acceptance evidence.
- Treat version control as the authority for implementation chronology.
- Do not add task summaries, completion notes, implementation chronology, or history archives to repository documentation.

## Code map

- `src/main.ts`: executable entrypoint.
- `src/cli.ts`: top-level CLI routing.
- `src/cli/`: command modules and output boundary.
- `src/task/`: Task intent, lifecycle, persistence interfaces, files, and composition.
- `src/change/`: Change workflows and Change-owned implementation, Candidate, validation, and delivery modules.
- `src/change/candidate/`: Candidate domain records.
- `src/change/candidateCapture/`: Candidate capture interfaces and Git Adapters.
- `src/change/candidateValidation/`: Candidate validation policy, execution, inspection, and composition.
- `src/change/validation/`: Change Validation Gate and validation Adapters.
- `src/change/validationRun/`: Validation Run domain records and evidence.
- `src/change/publication/`: Candidate publication policy and Git Adapter.
- `src/change/submit/`: Change submission configuration and errors.
- `src/agent/`: reviewer-agent execution and Agent Profile resolution.
- `src/contracts/`: configuration, output, and shared error contracts.
- `src/init/`: Local Repository initialization and repository-context Adapters.
- `src/output/`: structured output codecs and serializers.
- `src/repositoryPreparation/`: shared Repository Preparation Adapter.
- `src/sqlite/`: SQLite persistence Adapters.
- `src/submissionEnvironment/`: Git and GitHub submission-environment Adapters.
- `spikes/`: prototypes that are not part of the product package.

## Repository synchronization

Before starting a new investigation, Task design, or Change from the main checkout, fetch `origin/main` if it has not been fetched in the current session.
If local `main` is clean and can fast-forward, fast-forward it.
Refresh again after an external merge or before a new work item after a long session.
Otherwise, preserve the checkout and report its state.
Do not merge, rebase, or reset automatically.

## Commands

Run `just` to list available recipes.
Use Just recipes for repository workflows.
Use `just by ...` only when developing But Why from this source checkout.
