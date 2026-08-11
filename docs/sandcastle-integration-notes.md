# Sandcastle integration notes

Status: Current internal dependency and removal record.

This document records Sandcastle's remaining role in But Why.
Keep this document while any Sandcastle dependency, path convention, compatibility behavior, or related shim remains.
Remove it only as part of the Change that removes the complete residual integration.
[ADR 0001](adr/0001-use-fixed-validation-gate-with-project-owned-execution.md) is authoritative for the current execution architecture.
[Open Questions](open-questions.md) records deferred product and architecture decisions.

## Current boundary

But Why uses Sandcastle only through `src/disposableWorkspace/workspaceRuntimeAdapter.ts`.
That private Adapter uses Sandcastle `0.12.0` with `noSandbox()` to:

- Create a disposable Git worktree for the exact Validation Workspace ref.
- Copy the configured allowlisted files into the worktree.
- Run workspace commands through `Sandbox.exec()`.
- Close the Sandcastle workspace handle.

But Why owns the surrounding temporary ref lifecycle, exact Candidate verification, setup and cleanup evidence, command failure translation, and fallback Git cleanup.
Sandcastle provides no container isolation in the current configuration.
Preparation and Checks run as ordinary host processes in the disposable worktree.

Reviewer execution no longer uses Sandcastle.
The project-owned Pi Reviewer Adapter builds and launches the Pi CLI through Effect command execution.
It owns Reviewer Session lookup and resume, output parsing and correction, token usage evidence, and interruption of the reviewer process tree.
Sandcastle does not run the Implementer or Herdr.

## Residual integration

The remaining integration includes more than the two package imports in the private Adapter.
It also includes:

- The `@ai-hero/sandcastle` package dependency.
- The `.sandcastle/worktrees/` placement convention used to derive the expected Validation Workspace path.
- Repository ignore paths for Sandcastle worktrees, logs, patches, and environment files.
- Consumer setup guidance that requires recursive tools to exclude `.sandcastle/**`.
- Validation Workspace tests and architecture checks that isolate and exercise the private Adapter.
- Sandcastle names retained in historical migration compatibility tests.

The private Adapter calls `noSandbox()`.
Therefore the current dependency is a worktree and command-execution mechanism, not a security boundary.
Sandcastle controls the worktree placement and can affect host Git configuration as part of its worktree setup.
The project-owned workspace lifecycle verifies cleanup independently because a successful Sandcastle close result alone is not sufficient evidence.

## Current costs and constraints

The remaining dependency has these current costs:

- Validation Workspaces live under the consumer repository at `.sandcastle/worktrees/`.
- Recursive repository tools need explicit `.sandcastle/**` exclusions.
- But Why retains Sandcastle-specific ignore paths and expected-path logic.
- Workspace command execution crosses a Promise-based third-party boundary inside the private Adapter.
- Sandcastle supplies no isolation while `noSandbox()` is selected.
- The package remains installed even though its reviewer Agent Provider and session behavior are no longer used.

These costs do not weaken But Why's Validation Workspace invariants.
The exact Candidate binding, integrity checks, bounded cleanup evidence, and temporary ref cleanup remain project-owned requirements.

## Removal boundary

Sandcastle is fully removed only when one coherent replacement does all of the following:

1. Creates the exact disposable Git worktree on But Why's temporary ref.
2. Copies the configured allowlisted files with the current failure behavior.
3. Supplies Validation Workspace command execution with interruption and diagnostic behavior that satisfies the project-owned contract.
4. Removes the exact worktree and verifies that both its path and Git registration are absent.
5. Preserves setup, cleanup, interruption, and Validation Tooling Failure evidence.
6. Replaces `.sandcastle` workspace placement and removes every current path and ignore assumption that is no longer required.
7. Removes the private Sandcastle Adapter, package dependency, Sandcastle-specific architecture rules, tests, and current documentation together.

Do not remove this document after replacing only reviewer execution.
Do not retain this document after the complete residual integration is removed.
Historical migration values can remain only where immutable stored-state compatibility requires them.

## Deferred choices

Moving Validation Workspaces outside the consumer repository requires a selected location and defined naming, Git registration, cleanup, recovery, and repository-relocation behavior.
That decision remains in [Where should disposable Validation Workspaces live?](open-questions.md#where-should-disposable-validation-workspaces-live).

Adding container isolation is a separate execution-provider decision.
A container implementation must define its image, toolchain, writable mounts, Git and credential access, network access, process ownership, cleanup, and resource limits.
Replacing Sandcastle with project-owned host worktrees does not by itself add security isolation.

A second reviewer harness is also separate from Sandcastle removal.
The Reviewer Process Executor can have another Adapter, but current Agent Profile and Reviewer Session inputs are Pi-shaped.
Supporting another harness requires an accepted profile and session contract rather than only substituting a process executor.
