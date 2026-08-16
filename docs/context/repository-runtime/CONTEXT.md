# Repository Runtime Context

This context owns repository identity, shared operational state, configuration, executable selection, preparation, and agent runtime configuration.

Repository Runtime supplies transaction capability to Task/Change coordination without importing Task or Change domain modules.
The coordination adapter persists the one-to-one correlation link in Shared Repository State.

## Language

**Local Repository**:
One Git repository identity shared by its main checkout and linked worktrees.
_Avoid_: Current working directory, GitHub repository

**Git Common Directory**:
The canonical Git-controlled directory shared by every worktree of one Local Repository.
_Avoid_: Worktree root, Repo Config location, per-worktree Git directory

**Shared Repository State**:
SQLite and other local operational state owned by But Why and resolved through Git's common directory so every linked worktree sees the same facts.
Task and Change owner tables remain separate, while `task_change_links` stores their optional one-to-one correlation.
Direct modification outside But Why is unsupported.
_Avoid_: Copied state file, tracked Repo Config, per-worktree database

**Shared Repository State Snapshot**:
One operator-created, independently readable full SQLite copy of Shared Repository State at a coherent point.
But Why assigns each Snapshot a unique path under the Git Common Directory and never overwrites or changes it after successful creation.
It does not promise filesystem tamper prevention.
_Avoid_: Task Archive, restore point, retention policy

**Trusted But Why Executable**:
The command executable authorized to operate a Local Repository's Shared Repository State.
Before publication, it is the executable in the canonical main checkout and resolves operational Repo Config from that checkout.
Published executable selection and target-repository Repo Config resolution are governed by the post-publication compatibility policy.
_Avoid_: Candidate CLI, current-worktree executable

**Source Checkout Guard**:
A temporary pre-publication command path used only because the published But Why package is unavailable.
It does not define normal installation behavior.
_Avoid_: source mode, development installation

**Candidate Repo Config Validator**:
The prerelease read-only source entrypoint that uses Candidate code to validate the actual Candidate Repo Config in a Snapshot Workspace.
It does not open Shared Repository State or provide Candidate access to live repository-state operations.
The Trusted But Why Executable invokes it only through a Check selected from the exact Change Base Repo Config.
_Avoid_: Candidate CLI, submission policy resolver, compatibility parser

**Migration Artifact**:
One numbered source artifact that defines an ordered Shared Repository State migration.
Existing Migration Artifacts are immutable, and a schema change adds the next Migration Artifact.
_Avoid_: Migration file, migration script, editable migration

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
Tracked repository configuration for Prepare, Checks, local validation files, reviewer overrides, Specialists, and Repo Agent Profiles.
_Avoid_: Global user preference, detected Git fact

**Global Config**:
User-level local configuration for reusable Agent Profiles, reviewer defaults, and Interactive Session preferences.
_Avoid_: Repository policy, detected Git fact

**Agent Profile**:
A named reusable configuration of an agent runtime, including its model, thinking level, and runtime-specific execution resources.
An Agent Profile does not define an agent role's lifecycle or safety invariants.
_Avoid_: Reviewer instructions, agent role, validation phase

**Pinned Predecessor Executable**:
The Trusted But Why Executable selected from the canonical main checkout while the source repository is unreleased.
The Source Checkout Guard binds every source-repository But Why command to this executable and its canonical operational Repo Config rather than the Candidate worktree's code or Repo Config.
After publication, the published But Why Executable replaces this temporary rule.
_Avoid_: Candidate executable, current-worktree executable, published package before publication
