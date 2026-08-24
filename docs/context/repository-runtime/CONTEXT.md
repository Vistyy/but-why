# Repository Runtime Context

This context owns repository identity, shared operational state, configuration, executable selection, preparation, and agent runtime configuration.

Repository Runtime supplies transaction capability to Task/Change coordination without importing Task or Change domain modules.
The coordination adapter persists the one-to-one correlation link in Shared Repository State.

## Language

**Local Repository**:
One Git repository identity shared by its current worktrees.
_Avoid_: Current working directory, GitHub repository

**Git Common Directory**:
The canonical Git-controlled directory shared by every worktree of one Local Repository.
_Avoid_: Worktree root, Repo Config location, per-worktree Git directory

**Shared Repository State**:
SQLite and other local operational state owned by But Why and resolved through Git's common directory so every linked worktree sees the same facts.
It stores one immutable repository ID Prefix with the canonical Git Common Directory and rejects a conflicting Repo Config prefix.
Task and Change owner tables remain separate, while `task_change_links` stores their optional one-to-one correlation.
Direct modification outside But Why is unsupported.
_Avoid_: Copied state file, tracked Repo Config, per-worktree database

**Installed But Why Executable**:
The globally installed `by` executable authorized to operate a Local Repository's Shared Repository State.
Source and Candidate executables must not open live Shared Repository State.
_Avoid_: Candidate CLI, source checkout command, per-worktree executable

**Release Baseline Migration Artifact**:
The `0001_baseline` source artifact that defines the initial Shared Repository State for the release-ready executable.
The release applies it and every subsequent immutable ordered Migration Artifact shipped with the executable.
The chain excludes unsupported prerelease conversion and compatibility behavior.
_Avoid_: prerelease migration chain, conversion script, compatibility schema

**Agent Environment**:
The optional command wrapper read from Repo Config that starts each headless reviewer with the repository's required development tools.
Interactive Sessions use the Herdr pane shell environment instead of this wrapper.
The Agent Environment applies in a headless Snapshot Workspace.
It does not alter Repository Preparation or Checks.
If the configured wrapper fails, But Why stops the reviewer operation without an unwrapped retry.
_Avoid_: Interactive Session Environment, Reviewer Environment, Caller-checkout config, Global Config preference, Repository Preparation, Herdr configuration

**Repository Preparation**:
The configured setup that establishes dependencies or tools in a new Managed Worktree or Snapshot Workspace.
When Repo Config omits Repository Preparation, But Why runs no Repository Preparation.
_Avoid_: Validation-only setup, package-manager-specific install stage

**Repo Config**:
Tracked repository configuration for Prepare, Checks, reviewer overrides, Specialists, and Repo Agent Profiles.
Task Submit reads it from the exact Review Base.
Change Start reads it from the exact starting Change Base and freezes the complete Change policy.
_Avoid_: Global user preference, detected Git fact, Submit-time policy

**Global Config**:
User-level local configuration for reusable Agent Profiles, reviewer defaults, and Interactive Session preferences.
_Avoid_: Repository policy, detected Git fact

**Agent Profile**:
A named reusable configuration of an agent runtime, including its model, thinking level, and runtime-specific execution resources.
An Agent Profile does not define an agent role's lifecycle or safety invariants.
_Avoid_: Reviewer instructions, agent role, validation phase
