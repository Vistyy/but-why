## Always-on facts

- But Why validates submitted code against approved human intent.
- But Why is task-based.
- `by` is an agent-first, non-interactive CLI.
- This repository is unreleased.
- Shared Repository State uses immutable ordered Effect SQL migrations beginning with `0001_baseline`.
- SQLite Tasks are the source of truth for active work and accepted implementation intent.
- Use current domain terms in code, storage, and documentation.

## Documentation

- Read `CONTEXT-MAP.md` and the applicable context before naming domain-facing behavior.
- Read `docs/architecture.md` for current ownership and workflow boundaries.
- Read `docs/cli-output.md` for structured CLI output contracts.
- Read `docs/tooling.md` for contributor verification and architecture checks.
- Read accepted decisions in `docs/adr/` when a change affects their constraints.
- Read the shared Documentation policy in `writing-instructions` before changing documentation.
  It governs documentation admission, authoritative media, current-system description, and authority maintenance.

## Portable product boundary

- Treat packaged CLI help, `docs/public/`, packaged `extensions/`, and injected agent prompts as portable product interfaces.
- Portable product interfaces must work in target repositories without this source repository's agent instructions, context files, internal documentation, or local development files.
- This repository's agent instructions, context files, and internal contributor documentation govern development of But Why only.
- Portable guidance may direct an agent to discover and follow target-repository instructions, but it must not assume a specific instruction file, tool, directory, or domain context.
- Package every extension and reference required by a portable workflow, or declare it as an explicit configurable external dependency with actionable failure behavior.

## Code map

- `src/main.ts`: executable entrypoint.
- `src/cli.ts`: top-level CLI routing.
- `src/cli/`: command modules and output boundary.
- `src/cli/change/implementerPromptFile.ts`: Implementer Prompt file input handling.
- `src/task/`: Task intent, lifecycle, persistence interfaces, files, and composition.
- `src/change/`: Change workflows and Change-owned implementation, Candidate, validation, and delivery modules.
- `src/change/interactiveSession/`: Interactive Session launch preparation and host execution (`launchInteractiveImplementer.ts`, `interactiveSessionHost.ts`, `herdrInteractiveSessionHost.ts`, `implementerPrompt.ts`) with `InteractiveSessionHost` as the only injected seam and Herdr as the default host selected by `loadChangeUseCases.ts`; `ChangeUseCases.implement` retains Change lookup and open-state validation.
- `src/change/packageAssetPath.ts`: package-asset resolution.
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
- `src/disposableWorkspace/`: disposable exact-commit workspace Adapter.
- `src/sqlite/`: SQLite persistence Adapters.
- `src/submissionEnvironment/`: Git and GitHub submission-environment Adapters.

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
