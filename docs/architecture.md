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

No top-level source folder represents a migration stage.
Change and Task composition modules stay inside their owning domain instead of using `local*` folders.

## Ownership

A Task owns requested outcome, approved intent, dependencies, and user-facing lifecycle.
A Change owns one code lineage, Managed Worktree, Candidates, Validation Runs, Findings, and an owned pull request.
A Change may link to one Task.

Task commands manage intent and lifecycle.
Change commands manage implementation, validation, delivery, and reconciliation.
Submission executes the Validation Gate against a Candidate.
The Validation Gate reports its results through Change-owned interfaces.

Task and Change own their persistence interfaces.
Repository storage composition owns database lifecycle and constructs SQLite adapters.
Each workflow receives only the persistence operations it requires.
See [ADR 0014](adr/0014-use-module-owned-storage-and-change-transactions.md).

## Change lifecycle

`by change start [--task <task-id>]` creates a Change from the detected default branch.
It asks Git for the canonical main checkout and creates the Managed Worktree at `<main-checkout-parent>/<main-checkout-name>-worktrees/but-why/<change-slug>`.
Change Start resolves the same Managed Worktree root from the main checkout and every linked worktree.
It then runs Repository Preparation.
A Task-backed Change captures immutable Acceptance Context.
A taskless Change has no Acceptance Context.

`by change submit <change-id>` selects the current Candidate from the Change Managed Worktree.
It runs Repository Preparation, Checks, Acceptance Review for Task-backed Changes, configured Specialists, and publication policy.
Validation Runs belong to Candidates.
Findings and artifacts belong to the Validation Run for that Candidate.

`by change reconcile [<change-id>]` observes owned pull requests.
A merged owned pull request closes the Change and completes its linked Task.

## Storage

But Why stores Shared Repository State under `<git-common-dir>/but-why/`.
SQLite, Artifacts, and other operational state do not move with Managed Worktrees.
Repo Config remains tracked at `.but-why/config.json` in each worktree.
Shared Repository State identifies the Local Repository by its Git common directory.
Existing Changes continue to use their recorded absolute Managed Worktree paths.

State databases initialize from one current schema baseline.

## CLI

The public CLI is `by`.
The Change command surface includes:

```text
by change start [--task <task-id>]
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

Repo Config owns Repository Preparation, Checks, validation workspaces, and review policy.
Global Config owns Agent Profiles, reviewer defaults, and Interactive Session preferences.
See [`docs/config.md`](config.md) for the configuration contract.
