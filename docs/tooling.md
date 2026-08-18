# Tooling

This document explains how But Why contributors select and interpret repository checks.
Executable recipe descriptions belong to `just --list`.

## Contributor workflow

Enter the repository through direnv or run `nix develop -c just <recipe>`.
Run `just init` after entering the locked development environment.
Use Just recipes instead of direct package-manager commands for repository workflows.

Use focused recipes while implementing a change or diagnosing a failure.
Run `just quality` only when a repository-wide blocking result is required.
It is the only repository-wide blocking quality workflow and already includes the blocking static checks, build, and maintained tests.
Do not combine it with narrower recipes as additional repository-wide checks.

Change Submit owns the configured blocking Check and review phases.
During Change implementation, use focused verification and let Change Submit run the configured repository-wide Check.

`just health` is optional advisory analysis.
It reruns the maintained tests with coverage before reporting complexity, duplication, and non-error Effect diagnostics.
Health findings become implementation work only when repository evidence establishes a concrete defect or maintenance cost.

Repository-wide quality, unselected test, and unselected coverage workloads share a capacity lock.
Focused test selections do not wait for that lock.

## Source-repository executable

Before npm publication, `just by ...` uses the Trusted But Why Executable and operational Repo Config from the canonical main checkout.
The Source Checkout Guard preserves the caller checkout for command inputs and Git inspection while it binds operational policy to canonical main.
It does not load CLI, migration code, or operational Repo Config from a Candidate worktree.
Candidate CLI and migration behavior must be tested through supported test seams with independent temporary state.

Change Submit treats the Candidate Repo Config as opaque to the Trusted But Why Executable.
It resolves Repository Preparation, Checks, copied local files, and current reviewer policy from the exact fetched Change Base, while Change Start facts retain reviewer authority for the Change.
The source repository's Change Base config includes the `candidate-repo-config` Check.
After trusted Repository Preparation, that Check runs `just validate-candidate-repo-config` in the Snapshot Workspace so the Candidate source decoder validates the actual Candidate Repo Config.
A nonzero result creates normal Check evidence and prevents reviewer execution and publication.
The validator reads only `.but-why/config.json` and does not open Shared Repository State.
Do not invoke the Candidate CLI for this validation.

While the source repository is unreleased, every source-repository But Why command resolves the executable and operational Repo Config from the canonical main checkout before it reads or mutates Shared Repository State.
A Candidate worktree must not supply its own CLI or Repo Config as trusted repository policy for those operations.
Change Base-controlled validation remains the only path that decodes Candidate Repo Config.
After publication, packaged commands use the published But Why Executable and the target repository's normal Repo Config resolution instead.

### Prerelease release-baseline cutover

The release-ready runtime supports only `0001_baseline` and does not open prerelease Shared Repository State.
Use this minimum procedure for the one-time live cutover.

1. Keep the pre-merge source commit and build or retain its old executable before the baseline Change is merged.
2. After the merged baseline Change is available, pause But Why operations that can open or write Shared Repository State.
3. Invoke the old executable directly with canonical `main` as `BUT_WHY_SOURCE_TRUSTED_ROOT`, only for `change reconcile <merged-change-id>` with the exact merged baseline Change ID.
   Leave the merged `idPrefix` unchanged.
4. Rename the old Git Common Directory But Why state directory as a dated low-value backup.
5. Initialize fresh Shared Repository State from `0001_baseline` with the merged executable and unchanged `idPrefix`.
   Do not import or convert old rows.
6. Run one basic supported CLI smoke check, such as `task list`, and then resume work.

This procedure requires no checksum, manifest, rehearsal, backup verification, archive reader, rollback command, or migration command.

## Check ownership

Behavior tests own runtime contracts at supported interfaces.
The output codec owns JSON serialization.
Fallow owns dead-code, dependency, and configured architecture boundaries.
ast-grep owns configured structural TypeScript contracts.
Documentation checks own reader-visible links and anchors.
The package contract test owns packed contents, lazy command loading, installed runtime behavior, and portable asset availability.

Tool configuration and repository-authored diagnostics define the exact rules.
Do not duplicate those rule inventories in contributor documentation.
