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

Before npm publication, `just by ...` uses the Trusted But Why Executable from the canonical main checkout.
It does not load CLI or migration code from a Candidate worktree.
Candidate CLI and migration behavior must be tested through supported test seams with independent temporary state.

Change Submit treats the Candidate Repo Config as opaque to the Trusted But Why Executable.
It resolves Repository Preparation, Checks, copied local files, and current reviewer policy from the exact fetched Change Base, while Change Start facts retain reviewer authority for the Change.
The source repository's Change Base config includes the `candidate-repo-config` Check.
After trusted Repository Preparation, that Check runs `just validate-candidate-repo-config` in the Snapshot Workspace so the Candidate source decoder validates the actual Candidate Repo Config.
A nonzero result creates normal Check evidence and prevents reviewer execution and publication.
The validator reads only `.but-why/config.json` and does not open Shared Repository State.
Do not invoke the Candidate CLI for this validation.

While the source repository is unreleased, the Pinned Predecessor Executable rule applies to every source-repository But Why command.
The command must resolve the executable from the canonical main checkout before it reads or mutates Shared Repository State.
A Candidate worktree must not invoke its own CLI for repository state operations.
After publication, packaged commands use the published But Why Executable instead.

### Pinned Predecessor Executable for migration reconciliation

For a prerelease migration Change, build the Pinned Predecessor Executable from canonical `main` immediately before merge.
Preserve the self-contained executable bundle outside the checkout.
The manifest's executable must contain the complete predecessor runtime that will execute reconciliation.
Record the predecessor Git commit and the SHA-256 of that executable in an external manifest.
The manifest path is supplied through `BUT_WHY_PINNED_PREDECESSOR_MANIFEST`.
Its JSON shape is:

```json
{
  "version": 1,
  "changeId": "<exact-merged-change-id>",
  "commit": "<pre-merge-git-commit>",
  "sha256": "<sha-256-of-executable>",
  "executable": "<bundle-executable-path-relative-to-this-manifest>"
}
```

The source launcher verifies the manifest, the executable permission, and the recorded SHA-256 before it starts the executable.
The manifest is accepted only for `change reconcile <exact-merged-change-id>` and its `--discard-work` form.
The launcher rejects every other command while this manifest is selected.
The bundle receives the target Local Repository as its current working directory and runs only the exact reconciliation command.
After reconciliation succeeds, remove the temporary bundle and manifest unless the release archive requires the Task 7 predecessor.

## Check ownership

Behavior tests own runtime contracts at supported interfaces.
The output codec owns JSON serialization.
Fallow owns dead-code, dependency, and configured architecture boundaries.
ast-grep owns configured structural TypeScript contracts.
Documentation checks own reader-visible links and anchors.
The package contract test owns packed contents, lazy command loading, installed runtime behavior, and portable asset availability.

Tool configuration and repository-authored diagnostics define the exact rules.
Do not duplicate those rule inventories in contributor documentation.
