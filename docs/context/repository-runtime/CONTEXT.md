# Repository Runtime Context

This context owns repository identity, shared operational state, configuration, executable selection, preparation, and agent runtime configuration.

## Language

**Local Repository**:
One Git repository identity shared by its main checkout and linked worktrees.
_Avoid_: Current working directory, GitHub repository

**Git Common Directory**:
The canonical Git-controlled directory shared by every worktree of one Local Repository.
_Avoid_: Worktree root, Repo Config location, per-worktree Git directory

**Shared Repository State**:
SQLite and other local operational state resolved through Git's common directory so every linked worktree sees the same facts.
_Avoid_: Copied state file, tracked Repo Config, per-worktree database

**Shared Repository State Snapshot**:
One operator-created, independently readable full SQLite copy of Shared Repository State at a coherent point.
But Why assigns each Snapshot a unique path under the Git Common Directory and never overwrites or changes it after successful creation.
It does not promise filesystem tamper prevention.
_Avoid_: Task Archive, restore point, retention policy

**Trusted But Why Executable**:
The command executable authorized to operate a Local Repository's Shared Repository State.
Before publication, it is the executable in the canonical main checkout.
Published executable selection is governed by the post-publication compatibility policy.
_Avoid_: Candidate CLI, current-worktree executable

**Source Checkout Guard**:
A temporary pre-publication command path used only because the published But Why package is unavailable.
It does not define normal installation behavior.
_Avoid_: source mode, development installation

**Migration Artifact**:
One numbered source artifact that defines an ordered Shared Repository State migration.
Existing Migration Artifacts are immutable, and a schema change adds the next Migration Artifact.
_Avoid_: Migration file, migration script, editable migration

**Agent Environment**:
The optional command wrapper read from Repo Config that starts each host-run Implementer and reviewer with the repository's required development tools.
The same Agent Environment applies in the Managed Worktree and in a host-run Validation Workspace.
It does not alter Repository Preparation or Checks.
If the configured wrapper fails, But Why stops the agent operation without an unwrapped retry.
_Avoid_: Interactive Session Environment, Reviewer Environment, Caller-checkout config, Global Config preference, Repository Preparation, Herdr configuration

**Repository Preparation**:
The configured setup that establishes dependencies or tools in a new Managed Worktree or Validation Workspace.
_Avoid_: Validation-only setup, package-manager-specific install stage

**Repo Config**:
Tracked repository configuration for Prepare, Checks, local validation files, reviewer overrides, Specialists, and Repo Agent Profiles.
_Avoid_: Global user preference, detected Git fact

**Global Config**:
User-level local configuration for reusable Agent Profiles, reviewer defaults, and Interactive Session preferences.
_Avoid_: Repository policy, detected Git fact

**Agent Profile**:
A named reusable configuration of an agent runtime, including its model, thinking level, and runtime-specific execution resources.
An Agent Profile does not define an agent role's lifecycle or safety invariants.
_Avoid_: Reviewer instructions, agent role, validation phase
