# Taskless Changes and Worktree Handoff

Status: Approved specification

## Problem Statement

But Why currently makes a persistent implementation worktree available only by starting an approved Task.
This forces users to create artificial Tasks when they want to make a small or medium parallel change, validate it, and publish it through the same trusted workflow.
Task Start also owns Git provisioning even though branch and worktree creation are properties of a Change rather than Task intent.
Implementation worktrees are not prepared before manual, Herdr, or future AFK implementers use them.
The current Task-centered CLI obscures the accepted distinction between Task intent and Change-owned implementation, validation, and delivery.

## Solution

But Why will make Change Start the single entry point for prepared implementation worktrees.
A Change may optionally link to one approved Task, but every But Why-managed persistent worktree belongs to exactly one Change.
Task-backed Changes retain Acceptance Context and Acceptance Review.
Taskless Changes run code-based validation and publication without requiring artificial Task intent.

Change Start will create a branch from the default branch, create the persistent Managed Worktree through native Git, run shared Repository Preparation, and return the Change identity and readiness state.
Preparation and agent launch remain separate operations.
Herdr can start a fresh Pi session in a ready Managed Worktree and seed it from a compact handoff file.
A user-owned manually invoked Pi skill can create that handoff and orchestrate the CLI commands without copying the full Pi session or invalidating its prompt cache.

## User Stories

1. As a developer, I want to start a taskless Change, so that I can work in parallel without creating artificial Task intent.
2. As a developer, I want every managed worktree to belong to a Change, so that validation, findings, publication, and cleanup use one lifecycle.
3. As a developer, I want to start a Change from an approved Task, so that planned work retains its Acceptance Context.
4. As a developer, I want Change Start to choose the default branch automatically, so that I do not need to manage base refs for ordinary work.
5. As a developer, I want Change Start to create and name the branch and worktree safely, so that I do not need to understand Git worktree infrastructure.
6. As an implementer, I want the worktree prepared before I enter it, so that its dependencies and tools are ready.
7. As an implementer, I want failed preparation to preserve the Change and worktree, so that I can diagnose and retry the failure.
8. As an implementer, I want agent launch blocked until preparation succeeds, so that no agent starts in an unusable worktree.
9. As a repository owner, I want one preparation definition for implementation and validation workspaces, so that repository setup does not drift between workflows.
10. As a monorepo owner, I want the preparation interface to permit future context-sensitive selection, so that later optimization does not require changing workspace lifecycle contracts.
11. As a developer, I want taskless Changes to run checks and code-based reviewers, so that ad hoc work receives the normal quality gate.
12. As a developer, I want Acceptance Review omitted when no Task exists, so that But Why does not invent acceptance intent.
13. As a developer, I want taskless Changes to publish passing Candidates, so that ad hoc work can still produce an owned PR.
14. As a developer, I want unchanged taskless Changes to remain open with a clear nothing-to-submit result, so that But Why does not guess whether I am finished.
15. As a developer, I want Change inspection commands, so that taskless implementation and delivery state remains discoverable.
16. As a developer, I want open Changes listed oldest first with their age, so that long-lived worktrees are visible without being falsely labelled stale.
17. As a developer, I want Task commands focused on intent and Change commands focused on implementation and delivery, so that command ownership is predictable.
18. As an agent, I want programmatic But Why calls to return JSON, so that orchestration does not parse human-oriented TOON output.
19. As a developer, I want to cancel a taskless Change directly, so that abandoned work has a terminal lifecycle.
20. As a developer, I want Task-backed cancellation to remain a Task operation, so that Task intent and dependency state cannot become inconsistent.
21. As a repository owner, I want one-shot Change reconciliation, so that merged PRs can complete Changes without a daemon or webhook.
22. As a repository owner, I want reconciliation to clean safe terminal worktrees, so that prepared dependencies do not consume disk indefinitely.
23. As a developer, I want unsafe cleanup retained and reported, so that uncommitted or otherwise unreachable work is never silently destroyed.
24. As a developer, I want Herdr to launch a fresh Pi session in a ready worktree, so that Pi loads the correct repository context.
25. As a developer, I want to hand off the current conversation compactly, so that the fresh Pi session can continue without replaying a large cached conversation.
26. As a developer, I want to invoke worktree handoff manually, so that the agent does not need an always-present tool or decide when to move the work.
27. As a developer, I want existing Task-backed workflows to migrate cleanly to Change commands, so that the CLI has one supported implementation path.

## Implementation Decisions

### Domain ownership

A Change is the durable owner of one code lineage, Managed Worktree, Candidates, Validation Runs, Findings, and owned PR.
A Change links to zero or one Task.
A Task-backed Change has immutable Acceptance Context.
A taskless Change has no Acceptance Context but remains eligible for changed-code validation and publication.
Every But Why-managed persistent worktree belongs to exactly one open Change.
A Change has no title or duplicate intent fields.

### Change Start and worktree provisioning

Change Start replaces Task Start as the implementation entry point.
`by change start --task <task-id>` creates a Task-backed Change after enforcing Task approval and dependency rules.
`by change start` creates a taskless Change without requiring metadata.
Both forms create from the configured default branch.
Arbitrary base refs and stacked Change semantics are excluded from v1.

Native `git worktree` is the required persistent-worktree provisioning adapter.
But Why remains authoritative for Change identity, branch ownership, worktree path, starting commit, readiness, recovery, and cleanup eligibility.
Sandcastle remains an execution and disposable Validation Workspace mechanism rather than the persistent worktree registry.
Worktrunk may be reconsidered as an optional adapter after a concrete need exists.
Treehouse's detached reusable-pool model is not compatible with persistent Change-owned branches.

### Repository Preparation

Repo Config exposes one top-level `prepare` definition rather than validation-scoped preparation.
The same configured command and timeout apply to new Managed Worktrees and Validation Workspaces.
A shared repository-preparation runner executes the command, while implementation and validation callers retain separate lifecycle records and error semantics.
Implementation preparation may leave dependency files in the persistent worktree.
Validation preparation remains part of Validation Run evidence and preserves Candidate integrity requirements.
Future monorepo-aware preparation may select work from Task or changed-file context inside the preparation policy without changing the workspace lifecycle interface.

Change Start records the Change and worktree before preparation begins.
Successful preparation marks the Managed Worktree ready.
Failed preparation records a retryable `prepare_failed` state, preserves the branch and worktree, and prevents implementer launch.
`by change prepare <change-id>` explicitly runs or retries preparation.

### Change-centered CLI

The supported Change command surface includes:

- `by change start [--task <task-id>]`
- `by change prepare <change-id>`
- `by change list [--all]`
- `by change show <change-id>`
- `by change findings <change-id>`
- `by change validation-runs <change-id>`
- `by change submit <change-id>`
- `by change implement <change-id> [--handoff-file <path>]`
- `by change cancel <change-id>` for taskless Changes
- `by change reconcile [<change-id>]`

`by change list` shows open Changes by default, sorts the oldest first, and reports how long each Change has been open without assigning a stale label.
Task list and inspection remain focused on intent, dependencies, lifecycle, and a compact projection of linked Change status.
Task-backed Changes reject direct `change cancel` and direct callers to `by task cancel <task-id>`.

The following routes are removed when their replacements land:

- `by task start`
- top-level `by submit`
- `by task findings`
- `by task validation-runs`

No compatibility aliases remain.
Human-facing CLI output remains TOON by default.
Skills, extensions, tests, and other programmatic callers pass `--output json` and parse structured results.

### Validation and publication

Task-backed submission runs Repository Preparation, Checks, Acceptance Review, configured Specialists, and publication policy.
Taskless submission runs Repository Preparation, Checks, configured Specialists, and publication policy without Acceptance Review.
A taskless Change with no changed Candidate returns a structured nothing-to-submit result and remains open.
The response suggests explicit cancellation when the user intends to abandon the unchanged Change.
Task-backed No-Change Submission remains the Acceptance Review path for determining whether approved Task intent already holds.

Publication records exact PR identity on the owning Change.
Task-backed PR metadata may use Task intent.
Until a PR Writer exists, a taskless PR title uses the first non-merge commit subject after the starting commit and falls back to `Change <short-change-id>`.
The taskless PR body is generated from Change, Candidate, and Validation Run facts.

### Reconciliation and cleanup

`by change reconcile` is the explicit v1 mechanism for observing owned PR state.
The repository-wide form checks open Changes with recorded PR identities and closed Changes with pending cleanup.
The targeted form checks one Change.
There is no v1 webhook, daemon, or automatic polling requirement.

Reconciliation marks a Change complete when its recorded owned PR is observed merged.
Cancellation synchronously closes the Change and makes it eligible for the same cleanup policy.
Cleanup removes a worktree only when it has no uncommitted changes.
Cleanup deletes a branch only when its commits remain reachable through another ref.
Unsafe or failed cleanup remains pending and reports the blocking reason without preventing lifecycle closure.
Task linkage does not affect cleanup policy.

### Herdr implementation handoff

Preparation and implementer launch are separate operations.
`by change implement` accepts only a ready Change and launches an Interactive Session in its recorded Managed Worktree.
A narrow Interactive Session Host interface receives that existing worktree as its working directory and receives the optional handoff as the initial prompt.
Task 130 implements only the Herdr adapter and adds no provider selection, registration, or generic provider machinery.
The adapter requires Herdr to be installed and running when Change Implement is invoked.
Global Config does not configure Herdr, and `by init` does not check it.
Herdr does not create, rename, recover, or clean Git state.

The Herdr adapter uses one stable session name for each Managed Worktree.
A launch starts a fresh Pi session when no session with that name is active and otherwise returns `already_active` without creating a duplicate.
A successful Change Implement result reports the Change ID, worktree path, `herdr` host, and `started` or `already_active` status.
But Why? does not persist Herdr workspace or session identifiers.
A missing or stopped Herdr host and a Herdr launch failure preserve the prepared Change and return actionable, retryable errors.

`--handoff-file <path>` supplies an optional compact initial prompt for the fresh Pi session.
The path must identify a non-empty regular file containing valid UTF-8 and at most 256 KiB.
The CLI does not accept the handoff through standard input.
The CLI reads the handoff and passes its content unchanged through the Interactive Session Host interface.
The handoff describes relevant decisions, references existing artifacts instead of copying them, states the next implementation goal, suggests relevant skills, and excludes sensitive information.

The new Herdr session receives the compact handoff rather than a clone of the existing Pi session.
The current Pi session remains open.
This preserves the current session's provider cache and avoids sending its full conversation as fresh input to the new session.

### Task graph

Completed Task Start and Change storage issues remain historical records and are not rewritten.
A new Change Start and Repository Preparation slice follows the completed managed-worktree work.
Change-centered Submit, inspection, route removal, cancellation, reconciliation, and Herdr launch depend on that shared capability where applicable.
Herdr implementation work is blocked by ready Managed Worktrees.
The manual v1 workflow and dogfood documentation migrate to Change commands.
The taskless Change capability is part of the current v1 path rather than post-v1 work.

## Testing Decisions

Tests use layered public seams.
A few high-seam tests prove critical acceptance paths, behavior variations run at the lowest public seam that reliably observes them, and external contracts are verified at adapter seams.
Expensive Git, SQLite, process, or workspace setup appears only when that integration is part of the behavior under test.

The primary acceptance seam is the Change CLI running against a real temporary Git repository and real shared SQLite state.
A small golden set proves taskless and Task-backed Change Start, preparation in the created worktree, preparation failure and retry, taskless validation composition, and reconciliation cleanup.
The existing managed-worktree integration coverage is migrated and reused rather than duplicated for taskless and Task-backed callers.
At least one executable-process test verifies public command parsing, JSON output, and exit behavior.

Pure domain and command tests cover optional Task linkage, lifecycle decisions, validation phase selection, no-change behavior, list ordering, preparation result mapping, and structured output construction.
Module tests with fake public ports cover Change Start orchestration, preparation retry, Interactive Session Host launch, already-active behavior, host unavailability, launch failure, conditional Acceptance Review, and reconciliation eligibility.
SQLite-only tests cover taskless Change persistence, optional Task linkage, branch ownership constraints, readiness state, terminal state, and oldest-first queries without creating Git repositories.
Adapter tests cover native Git command mapping, Herdr invocation, GitHub PR reconciliation, and cleanup safety.

Repository precedent already uses in-process CLI execution, a shared SQLite schema template, real temporary Git repositories for Git-owned behavior, fake GitHub executables, and fake lifecycle adapters.
The current suite broadly follows layered seams.
The clearest existing seam breach is Change and Candidate storage coverage that creates Git repositories for SQLite-only behavior.
A separate low-priority task may replace that incidental Git setup with a SQLite-only fixture while retaining real repository migration tests.
That task is not a blocker for this specification and is expected to improve seam hygiene more than wall-clock runtime.

## Out of Scope

- Creating artificial Tasks for taskless Changes.
- Adding title, description, or acceptance fields to taskless Changes.
- Acceptance Review for taskless Changes.
- Publishing an unchanged taskless Change.
- Arbitrary Change base refs or stacked Change delivery.
- A generic pluggable worktree-manager framework.
- Worktrunk or Treehouse as required dependencies.
- A webhook, background daemon, or automatic reconciliation schedule.
- Automatic stale classification or cancellation based on age.
- A PR Writer in v1.
- Context-sensitive monorepo preparation in v1.
- Copying or switching the current Pi session into another worktree.
- Retargeting Pi's built-in tools while leaving its runtime bound to another directory.
- Automated Pi TUI testing in the default test suite.
- Broad test-suite flattening solely to pursue a one-to-two-second runtime.

## Further Notes

The experimental `worktree-switch` Pi extension proved that Pi can fork a conversation into another worktree, but the new session changes the absolute cwd in the system prompt and receives a new provider cache identity.
That approach was rejected because a long conversation could lose prompt-cache reuse and be processed as fresh input.
The extension was removed after the experiment.

The current test suite has roughly 300 tests and completes in about 18 to 20 seconds under four workers when the environment permits its normal setup.
That runtime is reasonable for its deliberate real-Git coverage.
Future performance work should target measured incidental setup rather than replace justified integration tests with implementation-coupled tests.
