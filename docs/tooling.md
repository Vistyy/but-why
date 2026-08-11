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
- `just test <focused-path-or-selection>` runs focused tests without the shared capacity lock.
- `just typecheck` runs the TypeScript checker.
- `just lint` runs Biome linting only.
- `just format` applies Biome formatting only.
- `just format-check` checks Just and Biome formatting only.
- `just docs-check` validates links and anchors in tracked and non-ignored Markdown files.
- `just ast-grep-check` checks structural TypeScript contracts.
- `just fallow-check` checks dead code and named architecture contracts with coverage.
- `just quality` runs each blocking static check, the build, and one ordinary unfiltered Vitest invocation that discovers every maintained test.

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

`just quality` and unselected test and coverage workloads wait for the repository capacity lock.
The supervising runner alone owns the capacity-lock descriptor, so workload descendants cannot retain capacity after the supervisor exits.
On interruption, the runner preserves the conventional exit status, makes a bounded best-effort cleanup attempt within its controlled process boundary, and waits for its direct supervised child.
Descendants that daemonize, reparent, create a new session or process group, or create replacements during cleanup are outside this Bash supervision boundary.
Targeted test selections remain unlocked.

## Structural contracts

Fallow enforces these architecture contracts:

- Behavior modules use ports instead of concrete storage or Repository Runtime Adapters, and concrete Adapter selection stays in composition directories.
- CLI modules do not import storage.
- Domain modules do not import Node infrastructure.

ast-grep enforces syntax contracts for process ownership, Effect tests, the private Sandcastle Validation Workspace Adapter, Task identity, wall-clock reads, test subprocess isolation, package inspection, live-agent tests, Validation Workspace tests, and JSON.parse trusted assertions.
The custom Biome rule rejects TypeScript import type expressions because top-level type imports keep dependencies visible without prohibiting required runtime dynamic imports.
The JSON.parse contract rejects direct trusted assertions of parsed JSON; parse into `unknown` and use the owning boundary's focused decoder or schema instead.
Repository-authored diagnostics state the prohibited approach, the invariant reason, and the supported replacement.

## Quality ownership

Behavior tests own runtime contracts at the supported interface.
The CLI output codec owns JSON serialization.
The package contract test owns package inspection.
Documentation tests own current reader-visible command and setup contracts.
Fallow and ast-grep own their named structural contracts.

`just health` produces advisory coverage, complexity, duplication, and code-health reports.
Advisory findings become implementation work only when repository evidence shows a concrete defect or maintenance cost.

## Release package verification

The production CLI keeps the complete Effect CLI descriptor tree in `src/cliCommandTree.ts` and loads command implementations through literal native dynamic imports after command selection.

The release package boundary test builds, packs, and installs one package fixture per invocation.
Its packed-content owner verifies package metadata and the package allowlist.
Its bundled-graph owner verifies lazy command loading and generated dynamic targets against the prepared built artifact.
Its installed-runtime owner seeds only the required Change state through the in-process fixture, then runs the packaged CLI from the installed layout to verify trusted continuation asset loading and truthful missing or invalid extension failures.
Broad Init and Change Implement semantics remain owned by [`test/repository/init-edge-cases.test.ts`](../test/repository/init-edge-cases.test.ts) and [`test/change/change-implement.test.ts`](../test/change/change-implement.test.ts).
Change Start real-Git identity, recovery, and preservation evidence is owned by [`test/change/change-start-managed-worktree.test.ts`](../test/change/change-start-managed-worktree.test.ts).
Captured Change Start orchestration and Repository Preparation evidence is owned by [`test/change/change-start.test.ts`](../test/change/change-start.test.ts).
Durable Change Start state is owned by [`test/repository/repository-storage.test.ts`](../test/repository/repository-storage.test.ts), and Change Start and Change Prepare result translation is owned by [`test/cli/change-lifecycle-results.test.ts`](../test/cli/change-lifecycle-results.test.ts).
See [`test/repository/package-contents.test.ts`](../test/repository/package-contents.test.ts).
Run it with `just test test/repository/package-contents.test.ts`.

The portable But Why skill test remains the lead owner for the model-visible skill's Pi discovery, shipped references, and authoritative operator workflow without preparing another package.
See [`test/repository/portable-but-why-skill.test.ts`](../test/repository/portable-but-why-skill.test.ts).
