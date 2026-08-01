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

- `just test <focused-path-or-selection>` runs focused tests without the complete-workload lock.
- `just typecheck` runs the TypeScript checker.
- `just lint` runs Biome linting.
- `just format-check` checks Just and Biome formatting.
- `just docs-check` validates links and anchors in tracked and non-ignored Markdown files.
- `just ast-grep-check` checks structural TypeScript contracts.
- `just fallow-check` checks dead code and named architecture contracts with coverage.
- `just quality` runs the blocking routine test, static-check, and build workflow.
- `just full-quality` runs the complete selected test suite with the same blocking checks.

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
## CLI loading verification

The production CLI keeps the complete Effect CLI descriptor tree in `src/cliCommandTree.ts` and loads command implementations through literal native dynamic imports after command selection.

The release-package boundary test builds the production output, traverses static imports from `dist/main.js`, checks every emitted dynamic target in the packed tarball, installs that tarball in a clean temporary directory, and runs installed Task, Change, and Validation Run commands.

Comparative cold-start evidence uses randomized order and 15 fresh processes per command.

The current compiled executable and installed Candidate tarball medians were:

- `--help`: 606.438 ms current, 610.236 ms Candidate.
- `--version`: 600.649 ms current, 604.174 ms Candidate.
- `task list`: 660.635 ms current, 664.461 ms Candidate.
- `change list`: 713.764 ms current, 725.289 ms Candidate.
- `validation-run show`: 636.052 ms current, 649.362 ms Candidate.

These measurements are comparative evidence and are not a latency budget.
