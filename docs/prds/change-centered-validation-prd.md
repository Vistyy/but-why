# Change-Centered Validation and Delivery

## Status

This document defines the reduced manual v1 target.
The migration Tasks link this target to the currently implemented Task-owned workflow described in `docs/architecture.md`.

## Product promise

But Why? validates a completed Task against its approved intent and configured repository standards.
But Why? publishes only the exact Candidate that passed validation.
But Why? creates or updates one owned pull request and leaves final review and merge to the human.

V1 does not implement code or fix Findings.
A human or external implementation agent writes the code, reads Findings, fixes the work, and submits again.

## Workflow

The supported workflow is:

```text
Create Task
-> Approve
-> Start
-> Implement and commit in the managed Task worktree
-> by submit <task-id>
-> Validate
-> Publish one owned PR
-> Human merge
-> by submit <task-id> observes merge
-> Done
```

`by submit <task-id>` is the only validation and publication command.
V1 has no standalone `by validate` command, public reconciliation command, or background watcher.

## Task approval and dependencies

A new Task starts in `new`.
The title, description, and comments form Task Context.
Task Context becomes immutable when the Task starts.

`by task approve <task-id>` permanently approves the Task and moves it to `todo`.
Approval does not start implementation.

A Task may have direct prerequisite Tasks.
Dependencies may be declared during creation or replaced atomically before the dependent Task starts.
Unknown Tasks, self-dependencies, and cycles are rejected without changing the graph.
A Task may start only when every prerequisite is `done`.
A cancelled prerequisite does not satisfy the dependency.

`by task show` displays direct prerequisites and dependents.
`by task list` shows whether each Task can start and which prerequisites block it.
V1 has no Task tags, custom queue ordering, expanded dashboard, or dependency-neighborhood traversal.

## Shared repository state

Tracked Repo Config remains at `.but-why/config.json`.
SQLite and other shared local operational state live under Git's common directory.
The main checkout and every linked worktree therefore use one Task, Change, Candidate, Validation Run, Finding, and PR record set.
Operational state is never copied or symlinked between worktrees.

## Task Start and managed worktrees

`by task start <task-id>` requires an approved, dependency-unblocked Task.
Task Start uses the repository's local default branch as its only v1 starting point.

Task Start creates and records:

- The Task's Change.
- An owned Task branch.
- A persistent managed Git worktree.
- The exact starting commit.
- Immutable Acceptance Context from Task Context.

The caller does not create, name, or check out the Task branch.
Repeated Start returns the existing Change and worktree without creating another branch or Acceptance Context.
`by submit` resolves the recorded worktree from the Task ID and does not depend on the caller's current checkout.

## Optional interactive implementation

Implementation remains outside the read-only Validation Gate.
A user may work directly in the managed worktree or enable the temporary Herdr integration in Global Config.

When Herdr is enabled, Task Start:

1. Creates and records the Git branch and worktree through But Why?.
2. Opens that existing worktree as a Herdr child workspace.
3. Starts a fresh Pi session in the child workspace.
4. Gives Pi the Task ID and the installed implementation workflow.

But Why? owns Task, Change, branch, worktree, validation, and PR facts.
Herdr owns only the visible interactive session.
The Herdr integration ships in v1 but remains optional at runtime.
If Herdr is disabled or unavailable, the managed worktree remains usable and Task Start reports the launch result.
The exact Global Config key is owned by the Herdr implementation Task.
V1 does not build a generic session-provider framework.

## Task lifecycle

The v1 states are:

```text
new -> todo -> implementing -> validating -> ready -> done
```

An unfinished Task may also become `cancelled`.
Repeated Submit on a Done Task is a read-only idempotent result rather than another lifecycle transition.

- `new` means intent is not approved.
- `todo` means intent is approved and implementation has not started.
- `implementing` means manual implementation is in progress or validation returned Findings.
- `validating` means Submit is running the Validation Gate.
- `ready` means the exact validated Candidate has an owned open PR.
- `done` means the owned PR merged or no repository change was required and Acceptance passed.
- `cancelled` means the user permanently ended the Task.

V1 has no `needs_input`, `held`, or Resume behavior.
Done and Cancelled Tasks are read-only.

## Candidate and Validation Run

A Candidate identifies one exact committed head and comparison base within a Change.
A changed committed head creates or reuses its Candidate before validation begins.

One Submit invocation runs at most one Validation Run.
A Validation Run has one execution and ends as passed, blocked by Findings, or failed by tooling.
V1 has no Execution Attempts, leases, or automatic validation retries.
Findings and Tooling Failures return the Task to implementing, and a later Submit may create a new Run.

A passing result may be reused only when Candidate identity and resolved validation policy are unchanged.
A new Candidate always requires a new Validation Run.

## Changed and no-change submission

Submit compares the Task worktree's current tracked tree with the tree recorded at Task Start.

When the Task changed the repository, Submit runs the full Validation Gate and may publish a PR.
When the Task did not change the repository, Submit captures or reuses a Candidate at the real starting commit and creates an Acceptance-only Validation Run.
No flag, reason, or Implementer explanation is required for the no-change path.

A passing no-change Acceptance Review marks the Task Done with completion kind `no_change`.
A no-change Acceptance Finding returns the Task to implementing.
No-change submission does not run Prepare, Checks, Specialists, or publication.

## Changed-code Validation Gate

The gate order is:

```text
Prepare -> Checks -> Acceptance Review -> Configured Specialists
```

A phase starts only after every earlier phase passes.
The Validation Gate never modifies the Candidate.

### Prepare

Prepare is an optional repository command that establishes dependencies or tools needed by validation.
Prepare failure or timeout creates a Finding and stops later phases.
Inability to execute or observe Prepare is a Validation Tooling Failure.

### Checks

Every configured Check runs after Prepare passes.
Ordinary Check failure or timeout creates a Finding but does not stop later Checks.
A Check execution or observation failure is a Validation Tooling Failure.
Any Check Finding stops reviewer phases for that Candidate.

### Acceptance Review

Acceptance Review is always enabled for Task-backed validation.
It judges the exact Candidate against immutable Acceptance Context.
Only Acceptance Review receives Acceptance Context.

Acceptance instructions resolve from Repo Config, then Global Config, then the prompt shipped with But Why?.
Acceptance profile selection resolves from Repo Config, then Global Config, then the Global Default Agent Profile.
Acceptance instructions and profile may be overridden, but Acceptance cannot be disabled.

### Specialist Review

Global Config may define reusable Specialists and an active Specialist list.
Repo Config may replace the active list and override Specialist definitions for one repository.
No Specialist is enabled by But Why? by default.

Every configured Specialist reviews the same exact Candidate for one named concern.
Specialists never receive Acceptance Context.
All trustworthy Specialist Findings are returned together in configured order.
Sequential or parallel scheduling is an internal implementation choice.

V1 has no Final Reviewer or automatic Fixer.

## Reviewer revisions

A reviewer with no Findings from an earlier Candidate performs one fresh review.

When that reviewer has Findings from an earlier Candidate, the new Candidate uses two requests:

1. The reviewer examines the whole Candidate without seeing earlier Findings and produces a provisional report.
2. The reviewer receives the provisional report and its earlier Findings, checks whether those problems remain, and returns one final report.

Only the second response is authoritative.
Earlier Findings remain historical records attached to their Candidate.
V1 does not reconcile Finding IDs or create resolution links.

## Copied local validation files

Repo Config may list regular files relative to the Local Repository's main checkout in `validationWorkspace.copyFiles`.
But Why? copies each listed file once from that explicit local environment source into the temporary validation workspace.
Missing paths, paths outside the repository, directories, symbolic links, and non-regular files are rejected.

Copied files are local validation environment inputs rather than Candidate content.
Their contents are not hashed, stored, included in Candidate or Run identity, or exposed in Findings.
The temporary copies are removed with the validation workspace.

## Findings and inspection

Findings are immutable records produced by Prepare, Checks, Acceptance, or Specialists.
Any Finding blocks the current Candidate and returns the Task to implementing.
The external Implementer fixes the code, commits a new Candidate, and runs Submit again.

Task and Validation Run inspection expose the exact Candidate, phase results, Findings, tooling failures, and bounded Artifact references.
Inspection uses durable domain facts rather than agent output or terminal state.

## Publication

A changed Candidate may publish only after every configured validation phase passes.
Immediately before publication, But Why? verifies that the Task branch still points to the exact validated Candidate.

But Why? creates or updates one PR owned by the Change.
The title and body are generated deterministically from Task intent, Candidate identity, and validation results.
V1 has no PR Writer agent.

Publication stores enough PR identity before and after the remote request to recover a lost response without creating a duplicate PR.
But Why? never publishes an unvalidated head, creates a second PR for the Change, approves the PR, or merges it.
The human chooses the supported GitHub merge method, including squash merge.

## Repeated Submit and reconciliation

When a Change already owns a PR, repeated Submit first reads its current authoritative GitHub facts.

- A merged PR marks the Task Done.
- An open PR at the expected head is reported without duplicate publication.
- A new local committed head becomes a new Candidate and must pass validation before the same PR updates.
- A closed unmerged PR remains closed and is not replaced.
- Unexpected repository, branch, base, or head facts produce a typed reconciliation error and are never adopted automatically.

GitHub state remains locally stale until Submit runs again.
V1 has no watcher, webhook, or automatic PR remediation.

## Cancellation

`by task cancel <task-id> --reason <reason>` synchronously cancels an unfinished Task.
Cancellation is terminal, preserves history, and does not satisfy dependent Tasks.

Cancellation stops the optional interactive implementation session when one exists.
Cancellation closes the owned open PR when one exists.
An observed merged PR is authoritative and completes the Task instead of cancelling it.

## Dogfooding transition

V1 is complete only after one real follow-up Task uses the installed workflow end to end.
The dogfood Task must be created, approved, dependency-checked, started, implemented in its managed worktree, submitted, reviewed, published, merged, and observed as Done through SQLite state.

After that succeeds, new active work is created and managed through the But Why? CLI rather than new Markdown issue drafts.
Existing Markdown issues remain planning and migration history.
Reviewer evaluation work becomes the first post-v1 SQLite Tasks.

## Deferred

The following are outside v1:

- Standalone validation.
- Automatic Fixers and AFK workers.
- Needs Input, Hold, and Resume.
- Supervisor services and background PR watching.
- Automatic CI, review-comment, and merge-conflict remediation.
- Final Review and PR Writer agents.
- Token and monetary cost controls.
- Generic interactive-session providers.
- Batch Task creation.
- Tag-based or path-based conditional validation.
- Reviewer evaluation suites, which begin after dogfooding.
