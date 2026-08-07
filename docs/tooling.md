# Tooling

The audience is a But Why contributor.
This document answers which supported commands verify a repository change and which checks own each concern.

## Runtime

The authoritative development environment uses Node.js 24.x, pnpm 10.28.0, Just, and the locked Nix environment.
Enter the repository through direnv or use `nix develop -c just <recipe>`.
Run `just init` after entering the environment.

The repository uses ESM TypeScript, Effect, Effect SQL SQLite, Vitest, Biome, TypeScript, Fallow, ast-grep, and Remark.

## Source-repository workflow executable

Before npm publication, `just by ...` runs through the canonical main checkout's Trusted But Why Executable.
The launcher resolves the canonical main checkout from Git worktree metadata.
It does not load CLI or migration code from the Candidate worktree.
If the canonical main checkout is unavailable, the command fails with `main_checkout_unavailable`.
If the canonical main-checkout Trusted But Why Executable is unavailable, the command fails with `trusted_executable_unavailable`.
Run Candidate CLI and migration tests through the supported test seams with an independent temporary Git repository and disposable Shared Repository State.

## Supported commands

Run `just` to list recipes.
Use Just recipes instead of direct package-manager commands for repository workflows.

- `just check` checks Just formatting and the configured Biome formatter, lint rules, and `organizeImports` assist in one source scan without modifying files.
- `just fix` applies Just formatting, Biome formatting, safe lint fixes, and the `organizeImports` assist without user interaction.
- `just test <focused-path-or-selection>` runs focused tests without the complete-workload lock.
- `just typecheck` runs the TypeScript checker.
- `just lint` runs Biome linting only.
- `just format` applies Biome formatting only.
- `just format-check` checks Just and Biome formatting only.
- `just docs-check` validates links and anchors in tracked and non-ignored Markdown files.
- `just ast-grep-check` checks structural TypeScript contracts.
- `just fallow-check` checks dead code and named architecture contracts with coverage.
- `just quality` runs the blocking routine test, static-check, and build workflow, including the `just check` source-style policy.
- `just full-quality` runs the complete selected test suite with the same blocking checks.

### Source-style policy

`just check` is the single source-style gate.
It covers Just formatting and the configured Biome formatter, lint rules, and `organizeImports` assist.
`just fix` applies the same policy without user interaction.
`just quality` runs the same `just check` policy as part of its static checks.
The narrower recipes remain available for focused diagnostics:
`just format` applies Biome formatting only, `just format-check` checks Just and Biome formatting only, and `just lint` runs Biome linting only.

Change Submit owns the configured blocking Check and review phases.
Do not duplicate those broad checks manually during Change implementation.
Use focused tests and focused static checks while implementing.

Complete quality, test, and coverage workloads wait for the repository capacity lock.
The runners supervise their process trees and preserve interruption exit codes after bounded cleanup.
Targeted test selections remain unlocked.

## Structural contracts

Fallow enforces these architecture contracts:

- Change workflows use ports instead of concrete Adapters or composition.
- CLI modules do not import storage.
- Domain modules do not import Node infrastructure.

ast-grep enforces syntax contracts for process ownership, Effect tests, TOON output, workspace creation, Task identity, wall-clock reads, test subprocess isolation, package inspection, live-agent tests, and Validation Workspace tests.
Repository-authored diagnostics state the prohibited approach, the invariant reason, and the supported replacement.

## Quality ownership

Behavior tests own runtime contracts at the supported interface.
The CLI output codec owns TOON and JSON serialization.
The package contract test owns package inspection.
Documentation tests own current reader-visible command and setup contracts.
Fallow and ast-grep own their named structural contracts.

`just health` produces advisory coverage, complexity, duplication, and code-health reports.
Advisory findings become implementation work only when repository evidence shows a concrete defect or maintenance cost.

## Manual diagnostics

The following operations are manual and non-blocking.
They do not block the routine or complete quality suites and remain available as targeted commands.

- A real Herdr smoke check verifies that `by change implement` can open an existing ready Managed Worktree under its stable session name.
  The check is excluded from the routine and complete quality suites and never blocks them.
  Start Herdr, point `HERDR_SMOKE_WORKTREE` at an existing ready Managed Worktree, point `HERDR_SMOKE_REPOSITORY` at that Worktree's repository, optionally point `HERDR_SMOKE_PATH` at the Herdr executable path, then run `BY_MANUAL_DIAGNOSTICS=1 just test test/agent/herdr-smoke.test.ts`.
  The captured Herdr host tests own launch classification and recovery; this check is an optional live-environment confirmation.

## CLI loading verification

The production CLI keeps the complete Effect CLI descriptor tree in `src/cliCommandTree.ts` and loads command implementations through literal native dynamic imports after command selection.

The release-package boundary test verifies the bundled entry graph and generated dynamic targets.
See [`test/repository/cli-loading.test.ts`](../test/repository/cli-loading.test.ts).
Run it with `just test test/repository/cli-loading.test.ts`.

The package contract test owns the one real-process sentinel for the packaged CLI and extensions from an installed layout: it builds and installs the packed package, then proves the CLI loads and reports trusted continuation extension preflight and missing-extension failures through `by change implement`.
See [`test/repository/package-contents.test.ts`](../test/repository/package-contents.test.ts).
The portable But Why skill test owns the model-visible skill's Pi discovery and authoritative operator workflow.
See [`test/repository/portable-but-why-skill.test.ts`](../test/repository/portable-but-why-skill.test.ts).
