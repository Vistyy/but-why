# Architecture

But Why is a repository-scoped validation workflow for agent-assisted code work.
It is task-based, not pipeline-based.

## Ownership

A Task owns requested intent, dependencies, and user-facing lifecycle.
A Change owns one code lineage, Managed Worktree, Candidates, Validation Runs, Findings, and an owned pull request.
A Change may link to one Task.

Task commands manage intent and lifecycle.
Change commands manage implementation, validation, delivery, and reconciliation.
Submission executes the fixed Validation Gate against a Candidate.

The source hierarchy follows these owners:

- `src/task/` owns Task records, lifecycle rules, identity, persistence interfaces, files, and composition.
- `src/change/` owns Change records, Candidates, Candidate capture, Validation Runs, validation phases, publication, submission, and composition.
- `src/agent/` owns reviewer-agent execution Adapters and Agent Profile resolution.
- `src/cliCommandTree.ts` owns the Effect CLI command tree, routing, syntax, and generated help.
- `src/cli/` owns command Adapters, and `src/cli.ts` owns the executable entry boundary.
- `src/contracts/` owns configuration, output, and shared error contracts.
- `src/init/` owns Local Repository initialization and repository-context Adapters.
- `src/output/` owns structured output codecs and serializers.
- `src/repositoryPreparation/` owns the shared Repository Preparation Adapter.
- `src/sqlite/` owns SQLite persistence Adapters.
- `src/submissionEnvironment/` owns Git and GitHub submission-environment Adapters.

CLI modules select operations and translate results.
They do not construct storage or coordinate persistence.
Task and Change modules own the narrow persistence operations that preserve their invariants.
Repository storage composition owns database lifecycle and constructs SQLite Adapters.

## Change workflow

`by change start [--task <task-id>] [--base <branch>]` fetches a publication-remote branch and creates a Managed Worktree.
Without `--base`, Change Start uses the remote default branch.
With `--base`, Change Start uses the named remote branch.
Local branches cannot supply a Change Base.

New Managed Worktrees use `<main-checkout-parent>/<main-checkout-name>-worktrees/but-why/<change-slug>`.
But Why resolves the root from the canonical main checkout, including when Change Start runs from a linked worktree.
Existing Changes retain their recorded absolute paths.
Change Start runs Repository Preparation before it reports the Change as ready.
A Task-backed Change captures immutable Acceptance Context.
A taskless Change has no Acceptance Context.

`by change submit <change-id>` reconciles an existing owned pull request before starting a new Submission.
A new Submission fetches the recorded Change Base and requires the Repository Branch to contain the fetched commit before Candidate creation.
The fetch updates only the remote-tracking ref.
It does not modify the Managed Worktree or Repository Branch.

A Candidate is identified by its Change, `changeBaseSha`, and `headSha`.
Tracked-tree equality with the fetched Change Base defines No-Change after the ancestry check passes.
A task-backed No-Change Submission runs Acceptance Review and can complete without a pull request.
A changed Candidate passes through Repository Preparation, Checks, Acceptance Review when task-backed, configured Specialists, and publication policy.

`by change reconcile [<change-id>]` observes owned pull requests.
A merged owned pull request closes the Change and completes its linked Task.
Cleanup deletes a Remote Change Branch only when it still identifies the exact published Candidate head.

## Storage

Shared Repository State lives under `<git-common-dir>/but-why/`.
SQLite, Artifacts, and other operational state are shared by linked worktrees.
Repo Config remains tracked at `.but-why/config.json`.

State databases initialize through immutable ordered Effect SQL migrations beginning with `0001_baseline`.
A schema change appends a new Migration Artifact instead of rewriting an applied migration.
The migration chain shipped in the first public release remains frozen after release.

## CLI and configuration

The public CLI is `by`.
It returns structured results on stdout.
TOON is the default format.
Callers that parse output request JSON with `--output json`.
The output ownership and expansion rules are defined in [CLI output](cli-output.md).

Repo Config owns Repository Preparation, Checks, Validation Workspace inputs, review policy, and the Agent Environment.
Global Config owns Agent Profiles, reviewer defaults, and Interactive Session preferences.
The public configuration contract is in [But Why Config](public/config.md).

Accepted decisions that constrain this design are recorded in [ADRs](adr/).
