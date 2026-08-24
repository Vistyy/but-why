# Tooling

This document explains how But Why contributors select and interpret repository checks.
Executable recipe descriptions belong to `just --list`.

## Contributor workflow

Use Node.js 24 and the project-declared pnpm 11.21.0.
Run `just init` before repository workflows.
Use Just recipes instead of direct package-manager commands for repository workflows.

Use focused recipes while implementing a change or diagnosing a failure.
Run `just quality` only when a repository-wide blocking result is required.
It is the only repository-wide blocking quality workflow and already includes the blocking static checks, build, and maintained tests.
Do not combine it with narrower recipes as additional repository-wide checks.

Change Submit owns the configured blocking Check and review phases.
During Change implementation, use focused verification and let Change Submit run the configured repository-wide Check.

`just health` is optional advisory code-health analysis.
It reports intrinsic Fallow complexity and Effect warning diagnostics without using coverage artifacts, reporting routine duplication findings, rerunning tests, or generating coverage.
Health findings are advisory and the command succeeds when retained findings exist.
Analyzer failures or invalid analyzer output fail the command.
Health findings become implementation work only when repository evidence establishes a concrete defect or maintenance cost.

Repository-wide quality, unselected test, and unselected coverage workloads share a capacity lock.
Focused test selections do not wait for that lock.

## Installed executable and package tests

The globally installed built package and its `by` executable are the only supported CLI for live Shared Repository State.
The source repository has no `just by` route and does not select an executable or operational Repo Config from another checkout.
The installed CLI resolves the invoking current worktree and its Git Common Directory.
No checkout is privileged.

Candidate source and package artifacts execute only in disposable test repositories with independent Git Common Directories, user configuration, and SQLite state.
Package contract tests own installed runtime behavior, packaged resources, and Repo Config behavior.
Candidate code must not open live Shared Repository State.

Change Start reads Repo Config and referenced repository reviewer instructions directly from the exact starting Change Base and stores the complete immutable Change policy.
Change Submit uses that stored policy and treats Candidate Repo Config as Candidate content rather than judgment authority.

### Prerelease release-baseline cutover

The release-ready runtime applies `0001_baseline` and every immutable ordered migration shipped with it, and does not open unsupported prerelease Shared Repository State.
Use this minimum procedure for the one-time live cutover.

1. Keep the pre-merge source commit and build or retain its old executable before the baseline Change is merged.
2. After the merged baseline Change is available, pause But Why operations that can open or write Shared Repository State.
3. Invoke the old executable directly from the target checkout only for `change reconcile <merged-change-id>` with the exact merged baseline Change ID.
4. Install the exact merged package tarball globally as `by`.
5. Rename the old Git Common Directory But Why state directory as a dated low-value backup.
6. Initialize fresh Shared Repository State from the installed migration chain beginning at `0001_baseline` with installed `by` and the unchanged `idPrefix`.
   Do not import or convert old rows.
7. Run basic `init` and `task list` smoke checks, then resume work.

This procedure requires no checksum, manifest, rehearsal, backup verification, archive reader, rollback command, or migration command.

## Check ownership

Behavior tests own runtime contracts at supported interfaces.
The output codec owns JSON serialization.
Fallow owns complexity health, dead-code, dependency, and configured architecture boundaries.
ast-grep owns configured structural TypeScript contracts.
Documentation checks own reader-visible links and anchors.
The package contract test owns packed contents, lazy command loading, installed runtime behavior, and portable asset availability.

Tool configuration and repository-authored diagnostics define the exact rules.
Do not duplicate those rule inventories in contributor documentation.
