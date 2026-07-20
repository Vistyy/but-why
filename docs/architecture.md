# Architecture

But Why? is a repository-scoped validation workflow for agent-assisted code work.
It is task-based, not pipeline-based.

## Ownership

A Task owns requested outcome, approved intent, dependencies, and user-facing lifecycle.
A Change owns one code lineage, Managed Worktree, Candidates, Validation Runs, Findings, and an owned pull request.
A Change may link to one Task.

Task commands manage intent and lifecycle.
Change commands manage implementation, validation, delivery, and reconciliation.

## Change lifecycle

`by change start [--task <task-id>]` creates a Change from the detected default branch.
It creates the Managed Worktree and runs Repository Preparation.
A Task-backed Change captures immutable Acceptance Context.
A taskless Change has no Acceptance Context.

`by change submit <change-id>` selects the current Candidate from the Change Managed Worktree.
It runs Repository Preparation, Checks, Acceptance Review for Task-backed Changes, configured Specialists, and publication policy.
Validation Runs belong to Candidates.
Findings and artifacts belong to Candidate Validation Runs.

`by change reconcile [<change-id>]` observes owned pull requests.
A merged owned pull request closes the Change and completes its linked Task.

## Storage

But Why stores operational state under `<git-common-dir>/but-why/`.
Repo Config remains tracked at `.but-why/config.json` in each worktree.
Shared state identifies the Local Repository by its Git common directory.

The current SQLite migration chain remains supported for existing state.
Task 137 owns replacement of that chain with the Effect SQL baseline.

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
by change implement <change-id> [--handoff-file <path>]
by change reconcile [<change-id>]
```

CLI commands return structured data on stdout.
TOON is the default output format.
Callers that parse output pass `--output json`.

## Configuration

Repo Config owns Repository Preparation, Checks, validation workspaces, and review policy.
Global Config owns reusable Agent Profiles and reviewer defaults.
See [`docs/config.md`](config.md) for the configuration contract.
