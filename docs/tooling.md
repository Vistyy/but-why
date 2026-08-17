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
Use this ordered procedure for the one-time live cutover.

1. Immediately before the baseline Change is merged, build a self-contained old executable bundle from canonical `main` and keep it outside the checkout.
   Record the source commit and executable SHA-256 in an integrity-checked bundle manifest.
2. Before the live cutover, verify the exact old executable against its manifest, verify the manifest integrity, and rehearse the exact `change reconcile <merged-change-id>` command on a disposable repository.
3. After the merged baseline Change is available, pause all But Why opens and writes.
4. Verify the merged `idPrefix` Repo Config against the merged commit, and verify that no `taskPrefix` compatibility overlay is installed.
5. Run the old bundle directly from canonical `main`, with canonical `main` assigned as `BUT_WHY_SOURCE_TRUSTED_ROOT`, only for `change reconcile <merged-change-id>` with the exact merged baseline Change ID and unchanged merged `idPrefix`.
   Do not use the merged executable, a Candidate executable, or a source-checkout dispatcher for old-state reconciliation.
   If reconciliation fails, verify the merged `idPrefix` against the merged commit again before any retry or new-runtime open.
   If the reconciliation result is uncertain, determine whether the exact Change and cleanup mutations committed before retrying.
   Do not retry while the old-state result is unknown.
6. After successful reconciliation, archive the complete Git Common Directory But Why state and repository reviewer files under an operator-selected unique path.
   Include the archive timestamp, repository and executable identity, the old bundle manifest, archive integrity metadata, and instructions for inspecting a copy with the old bundle.
   Keep existing loose SQLite backups until the archive checksums and old-state SQLite readability verify.
   Do not overwrite or delete the verified archive.
7. Remove the temporary old bundle and manifest after successful reconciliation unless the archive procedure requires them.
   If the archive requires them, remove only the temporary copies after archive verification.
8. Initialize fresh Shared Repository State with the merged executable and the unchanged merged `idPrefix` Repo Config.
   Verify the baseline ledger, the supported product table inventory, repository identity, and a normal read-only command before resuming operations.
9. After fresh-state verification, remove the loose SQLite backups.
   Retain only the active new `state.sqlite` and the single verified final prerelease archive.

If interruption leaves the old operational state in place, continue with the old bundle or finish the archive move before initialization.
If interruption occurs after the archive move, rerun fresh initialization with the merged executable.
If verification fails before new work is recorded, restore the complete old operational state and use only the old bundle.
If verification fails after new work is recorded, preserve the new state and repair it forward.
Do not merge old and new Shared Repository State.

## Check ownership

Behavior tests own runtime contracts at supported interfaces.
The output codec owns JSON serialization.
Fallow owns dead-code, dependency, and configured architecture boundaries.
ast-grep owns configured structural TypeScript contracts.
Documentation checks own reader-visible links and anchors.
The package contract test owns packed contents, lazy command loading, installed runtime behavior, and portable asset availability.

Tool configuration and repository-authored diagnostics define the exact rules.
Do not duplicate those rule inventories in contributor documentation.
