# Architecture

But Why? is a repository-scoped validation workflow for agent-assisted code work.
It is task-based, not pipeline-based.

## Source hierarchy

`src/change/` owns Change workflows.
It contains Change records, Candidates, Candidate capture, Candidate validation, Validation Runs, validation phases, publication, submission, and Change composition.

`src/task/` owns Task intent and Task lifecycle.
It contains Task records, lifecycle rules, Task identity, Task persistence interfaces, Task files, and Task composition.

The following top-level source folders have shared roles:

- `src/agent/` contains reviewer-agent execution adapters and agent-profile resolution.
- `src/cli/` and `src/cli.ts` contain CLI routing and command adapters.
- `src/contracts/` contains configuration, output, and repository-storage error contracts.
- `src/init/` contains Local Repository initialization and repository-context adapters.
- `src/output/` contains structured output codecs and serializers.
- `src/repositoryPreparation/` contains the shared Repository Preparation adapter.
- `src/sqlite/` contains SQLite persistence adapters.
- `src/submissionEnvironment/` contains Git and GitHub submission-environment adapters.

Acceptance Review and Specialist Review use their resolved Pi Agent Profile resources.
Configured extension, skill, and tool arrays are exact allowlists.
Omitted resource fields preserve normal Pi behavior.
Prompt templates and themes remain fixed background-agent hygiene.
Repo Config may additionally define one Agent Environment command list for the Implementer and host-run reviewers.
The Agent Environment does not apply to Repository Preparation or Checks.
Change Implement resolves Repo and Global Agent Profiles from the Managed Worktree and Global Config.
The remaining agent execution identity design is tracked in [Open Questions: How should agent execution identities work?](open-questions.md#how-should-agent-execution-identities-work).

No top-level source folder represents a migration stage.
Change and Task composition modules stay inside their owning domain instead of using `local*` folders.

## Ownership

A Task owns requested outcome, approved intent, dependencies, and user-facing lifecycle.
A Change owns one code lineage, Managed Worktree, Candidates, Validation Runs, Findings, and an owned pull request.
A Change may link to one Task.

Task commands manage intent and lifecycle.
Change commands manage implementation, validation, delivery, and reconciliation.
Submission executes the host-only Validation Gate against a Candidate.
Sandcastle provides the internal disposable Validation Workspace and host process adapter.
Current dependency constraints and workarounds are recorded in [Sandcastle integration notes](sandcastle-integration-notes.md).
The Validation Gate reports its results through Change-owned interfaces.

Task and Change own their persistence interfaces.
Repository storage composition owns database lifecycle and constructs SQLite adapters.
Each workflow receives only the persistence operations it requires.
See [ADR 0006](adr/0006-use-domain-centered-modules-and-module-owned-persistence.md).

## Change lifecycle

`by change start [--task <task-id>] [--base <branch>]` creates a Change from a freshly fetched branch on the detected publication remote.
Without `--base`, Change Start uses the remote default branch.
With `--base`, Change Start uses the named remote branch.
Local branches never supply a v1 Change Base.
It asks Git for the canonical main checkout and creates the Managed Worktree at `<main-checkout-parent>/<main-checkout-name>-worktrees/but-why/<change-slug>`.
Change Start resolves the same Managed Worktree root from the main checkout and every linked worktree.
It then runs Repository Preparation.
A Task-backed Change captures immutable Acceptance Context.
A taskless Change has no Acceptance Context.

`by change submit <change-id>` first returns a stored terminal No-Change completion or reconciles an existing owned pull request.
Merged or closed pull request facts take precedence over current Change Base ancestry.
An unchanged Repository Branch head returns stored publication success only when the owned pull request confirms the exact passing Candidate.
Otherwise Submit fetches the recorded Change Base and requires `changeBaseSha` to be an ancestor of `headSha` before Candidate creation.
The fetch updates only the remote-tracking ref and does not modify the Managed Worktree or Repository Branch.
A Candidate is identified by `changeId`, `changeBaseSha`, and `headSha`.
Validation compares the Candidate head directly with `changeBaseSha`.
After the ancestry gate passes, tracked-tree equality between `headSha` and `changeBaseSha` defines No-Change regardless of later commit topology or the starting commit.
A divergent same-tree Repository Branch still fails the mandatory Change Base ancestry gate.
Submit runs Repository Preparation, Checks, Acceptance Review for Task-backed Changes, configured Specialists, and publication policy.
Validation Runs belong to Candidates.
Findings and artifacts belong to the Validation Run for that Candidate.
Completed Submissions retain their point-in-time Candidate, publication, and Validation Policy Snapshot evidence.
Current configuration applies to future or unfinished Submissions.

`by change reconcile [<change-id>]` observes owned pull requests.
A merged owned pull request closes the Change and completes its linked Task.

## Storage

But Why stores Shared Repository State under `<git-common-dir>/but-why/`.
SQLite, Artifacts, and other operational state do not move with Managed Worktrees.
Repo Config remains tracked at `.but-why/config.json` in each worktree.
Shared Repository State identifies the Local Repository by its Git common directory.
Existing Changes continue to use their recorded absolute Managed Worktree paths.

State databases initialize through immutable ordered Effect SQL migrations beginning with `0001_baseline`.
Schema changes append forward migrations before and after the first public release.
The first public release freezes the complete migration chain shipped in that release.
See [ADR 0009](adr/0009-use-forward-schema-migrations-before-release.md).

## CLI

The public CLI is `by`.
The Change command surface includes:

```text
by change start [--task <task-id>] [--base <branch>]
by change prepare <change-id>
by change list [--all]
by change show <change-id>
by change findings <change-id>
by change validation-runs <change-id>
by change submit <change-id>
by change cancel <change-id>
by change implement <change-id> [--handoff-file <path>]
by change reconcile [<change-id>]
```

`by change cancel` accepts only open taskless Changes.
Task-backed Changes are cancelled through `by task cancel <task-id> --reason <reason>`.
CLI commands return structured data on stdout.
TOON is the default output format.
Callers that parse output pass `--output json`.

## Configuration

Repo Config owns Repository Preparation, Checks, validation workspaces, review policy, and the Agent Environment.
Global Config owns Agent Profiles, reviewer defaults, and Interactive Session preferences.
See [`docs/config.md`](config.md) for the configuration contract.
