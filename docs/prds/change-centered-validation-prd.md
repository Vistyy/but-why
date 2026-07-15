# Change-Centered Validation and Delivery Design Ledger

## Status

This document is the active design ledger for the post-v1 Change-centered pivot.
It records agreed decisions and open questions, but it is not accepted architecture until an ADR approves the ownership change.
It does not describe current implemented behavior.

The current implementation remains Task-bound.
`docs/architecture.md` remains the current v1 architecture until implementation changes land.

This document replaces the session-created Task-owned implementer-loop draft.
The surviving Supervisor, AFK, workspace, recovery, and observability decisions from that draft are incorporated here.

## Why the design changed

The earlier design made Task state own implementation, validation, fixing, publication, PR reconciliation, and recovery.
That prevented standalone validation and turned Task status into a workflow command bus.

The new center is a Change.
A Task may supply approved intent and trigger automation, but validation does not require a Task.

## Current implementation boundary

The following behavior is planned and is not implemented yet:

- Durable Changes and Candidates.
- Standalone `by validate`.
- Automatic fixing.
- Specialist Reviewers.
- Final Review.
- Acceptance Reviewer execution.
- Background AFK implementation.
- PR publication and reconciliation.
- User-level Supervisor and repository workers.

Current v1 code still requires a Task for submission.
Current implemented Findings come from prepare and configured checks and move the Task to `needs_input`.

## Product promise

But Why? publishes only the current Change head after all configured checks pass on that exact SHA.
Final Review also passes on that SHA.
Acceptance Review passes on that SHA when Acceptance Context exists.
Every required Specialist Reviewer completes during the Change, and no recorded Finding remains unresolved.

But Why? does not claim that every Specialist Reviewer inspected the final SHA.

## Core ownership

### Task

A Task owns requested intent, comments, approval, tags, and its user-facing lifecycle.
A Task may have at most one Change, and a Change may have at most one linked Task.
The optional Task-Change link is permanent.
Unrelated work uses a different Task, branch, worktree, and Change.

A Task does not own validation state.
Its displayed progress reflects facts from its linked Change.

### Change

A Change is the durable lineage root for one evolving code change.
It has a permanent opaque ID.
It may be linked to a Task, but it does not require one.
A Change is `open` or `closed`.
A closed Change permanently records `completed` or `cancelled` and accepts no new Candidates.

A Change groups:

- Its branch or writable workspace relationship.
- Candidates.
- Validation Runs.
- Specialist completion evidence.
- Findings and their resolution.
- Agent decisions.
- Needs Input.
- An optional PR.

Change state stays small and is derived from durable work facts where possible.

### Candidate

A Candidate is one exact committed version of a Change with a permanent opaque record ID.
Its immutable code identity within the Change is its fixed comparison base SHA and exact head SHA.
It retains the selected base reference and resolved target SHA as provenance.
Repeated capture reuses the Candidate when identity and provenance match.
Conflicting provenance is rejected without changing Candidate history.
The range may contain many Git commits.

Dirty working tree content is not a Candidate.
Manual validation refuses dirty work instead of committing it automatically.

A new head creates a new Candidate.
A fix, external commit, rebase, or force-push never mutates an existing Candidate record.

### Change discovery

A repository branch may bind at most one Change.
Repository identity is the canonical Git common-directory path, and branch identity is the full local ref.
Task workspace metadata selects its linked Change first.
Otherwise But Why? reuses the open Change bound to the current repository and branch or creates one when that branch has no Change history.
Closed Changes remain history and are never reopened or reused.
A branch with a closed Change rejects new capture.
Unrelated work uses a new branch instead of reusing an existing branch.
A branch rename preserves its open Change when Git facts prove the rename or the user explicitly confirms the rebind.
Ambiguous or conflicting bindings fail without guessing.

### Validation Run

A Validation Run judges one Candidate under immutable policy and optional Acceptance Context snapshots.
A new Candidate or changed immutable input creates a new Validation Run.
Retry and recovery for the same Candidate and immutable inputs create a new Execution Attempt within that Run.
The first Validation Tooling Failure receives one automatic fresh Attempt and workspace.
After the approved retry is exhausted, But Why? code leaves the Run unfinished and records Needs Input from the second Tooling Failure.
Task Resume or another explicit standalone validation request may then create a fresh Attempt in the same Run.
Hold and cancellation end active work without consuming the automatic tooling retry.

When a Validation Run starts, But Why? resolves the current Repo Config and applicable CLI overrides into an immutable Validation Policy Snapshot with a canonical fingerprint.
The snapshot includes an internal validation contract version plus every resolved validation-affecting check, reviewer, instruction, agent, sandbox, and override field.
Fixer policy and code-writing budgets are durable orchestration inputs outside validation evidence identity.
Changing gate semantics requires a contract-version bump so older evidence cannot satisfy the newer gate accidentally.
That snapshot never changes during the Run.
Before reusing evidence or publishing, But Why? resolves the effective policy again.
A fingerprint change makes the earlier evidence ineligible and starts a new Validation Run under the new policy.
Asynchronous work resolves policy when the Validation Run starts rather than when its Trigger is emitted.

Explicitly copied local inputs must be regular non-symlink files inside the repository that Git does not track, whether ordinarily untracked or ignored.
Missing, invalid, duplicate, or out-of-repository paths are Submit Rejections when no stable identity can be selected before Run creation.
Their immutable identity is normalized repository-relative path, raw-byte SHA-256, and executable bit.
Each Attempt verifies the expected identity while copying the live bytes into its workspace.
One detected read or copy race automatically reselects the complete input set and corresponding Run.
After the approved reselection is exhausted, But Why? code records Needs Input from the second instability observation or inability to select stable inputs.
File contents may exist temporarily while copying but are not stored in SQLite.

Validation Runs do not require a Task ID.
A Task link is optional traceability.
After all preflight inputs are valid, one database transaction creates or reuses the Change, Candidate, Validation Run, and initial active Execution Attempt.
A transaction failure leaves none of those new records, while later workspace or command failure is recorded on the durable Attempt.

## Agent roles

### Implementer

The Implementer produces the initial implementation for a Task-backed Change.
It may continue pre-validation implementation work.
It does not fix Validation Findings.

### Fixer Agent

The Fixer Agent is a coding agent invoked after Validation Findings to fix the Change Workspace, record decisions, and commit a successor Candidate.

It is separate from the Implementer.
It starts as a fresh coding-agent execution.
It lives in the outer validation-revision workflow and remains outside the read-only Validation Gate.
It does not review, validate, publish, or directly mark Findings resolved.

### Specialist Reviewer

A Specialist Reviewer owns one explicitly configured repository concern.
`by init` configures no Specialists by default.
All unfinished Specialist Reviewers run in parallel, while a repository with none proceeds from applicable Acceptance Review directly to Final Review.

A Specialist Reviewer with Findings runs again after those Findings are fixed.
Once it produces a result with no Findings, it is complete for later linear Candidates in the same Change while its configured concern, comparison base, and validation policy remain unchanged.

### Final Reviewer

The Final Reviewer judges the finished code as one whole.
It checks integration, overall correctness, fix interactions, and whether final tests match final behavior.

It does not repeat specialist work.
It does not judge Acceptance Context.
It does not select, reopen, or coordinate Specialist Reviewers.

### Acceptance Reviewer

The Acceptance Reviewer judges the current Candidate against immutable Acceptance Context.
It runs only when Acceptance Context exists.

### PR Writer

The PR Writer creates the PR description from final code, validation evidence, optional Acceptance Context, and recorded decisions.
It does not implement, fix, or validate code.

## Validation and fixing flow

### Prepare, workspace integrity, and initial checks

Each Execution Attempt receives a fresh disposable Validation Workspace at the exact Candidate.
Prepare runs first when configured.
A completed Prepare command with a non-zero exit or timeout creates a Finding and stops later checks, while inability to execute or observe Prepare is a Validation Tooling Failure.

Configured checks then run sequentially against the complete Candidate.
An ordinary check failure or timeout creates a Finding but does not stop later configured checks.
After Prepare and every check, But Why? verifies that Candidate `HEAD`, index, tracked contents, and executable bits remain unchanged.
Temporary untracked files are allowed.
An integrity violation is a Validation Tooling Failure and stops the Attempt because later evidence would not describe the Candidate.

If Prepare or checks produce Findings, reviewer agents do not run on that Candidate.
The Fixer Agent may run any commands it chooses for private feedback while working.
Only the full configured checks count as validation evidence.

### Ordered gate and fixing

Every Candidate enters the gate at Prepare and proceeds through Checks, Acceptance Review when Acceptance Context exists, Specialist Review, then Final Review.
A phase runs only after every earlier applicable phase passes.
A trustworthy phase with Findings completes that Candidate's Run as `blocked`.

When automatic fixing is allowed, one Fixer receives every open Finding from that single blocking phase.
Check, Acceptance, Specialist, and Final Findings never share a Fixer batch across phase boundaries.
The Fixer makes its best available decisions, records consequential Implementation Decisions, attempts the complete batch, and never requests Needs Input or changes lifecycle state.
But Why? independently verifies that the execution produced one clean committed successor Candidate.
When no successor Candidate exists, orchestration preserves the execution evidence and open Findings, exhausts any approved recovery, and records Needs Input through a code-owned reason.
Every successor Candidate starts a new Run from Prepare.

When one phase runs multiple read-only reviewers in parallel, each trustworthy result is durable independently for the exact Candidate, policy, and reviewer identity.
A tooling failure leaves the group incomplete but does not invalidate trustworthy sibling results.
A later Attempt runs only failed or missing reviewers, and fixing waits until every required reviewer has a trustworthy result before batching the phase's Findings.
Changed immutable inputs invalidate incomplete-group reuse.

Any reviewer revisiting its prior Findings uses a fresh two-request session.
The first request performs blind review and produces only a provisional result.
The second request receives that provisional result and the reviewer's prior Finding IDs, then returns the authoritative open-Finding set.
Retained prior IDs stay open, omitted prior IDs receive resolution links, and entries without prior IDs become new Findings.
Unknown or duplicate prior IDs receive one structured-output retry and then become a Reviewer Output Contract Failure.

### Acceptance Review

After checks pass, Acceptance Review judges the exact Candidate against immutable Acceptance Context.
Standalone Changes without Acceptance Context skip the phase.
All Acceptance Findings form one Acceptance Fixer batch.
A successor Candidate restarts from Prepare and must pass Acceptance Review again before later reviewer phases.

### Specialist loop

After applicable Acceptance Review passes, all unfinished Specialist Reviewers run in parallel.
All Specialist Findings from that phase form one Specialist Fixer batch.
A successor Candidate restarts from Prepare and, after earlier phases pass, reruns only Specialists whose previous result contained Findings.
A Specialist becomes complete when it returns no Findings.

A completed Specialist Reviewer may stay complete only across an eligible automatic Fixer successor.
Manual changes, external commits, and other ineligible successors reset completion.
Eligible completion carries from `by validate` into a later `by submit` for the same Change.
An automatic Fixer successor may retain eligible completed Specialist evidence.
A newly adopted Task Comment, new Change, changed Specialist configuration, changed comparison base, changed validation policy, or non-linear history resets every Specialist Reviewer.
The reset does not expose Acceptance Context to Specialists.
This is an explicit cost and confidence trade-off.

### Final Review

Final Review runs only after checks and applicable Acceptance Review pass and every Specialist Reviewer is complete.
All Final Findings form one Final Fixer batch.
A successor Candidate restarts from Prepare while eligible completed Specialist evidence remains reusable.
The exact final Candidate must pass Checks, applicable Acceptance Review, and Final Review before publication.

### Publication

Publication never modifies code.
Immediately before publishing, it atomically verifies that the current Change head still equals the eligible Candidate head.
If the head advanced, publication stops and the newer head becomes the next Candidate for validation.
PR identity persistence and recovery never bypass this comparison.

Only `by submit` publishes through But Why?.
`by validate` always stops before publication.

## Commands

### `by validate`

`by validate` automatically creates or finds the Change for the current work.
It captures the committed head as a Candidate.
It validates and may fix according to the resolved automatic-fix policy.
It stops locally and never publishes.
A successful validation-only Change remains open so a later `by submit` can reuse its evidence.

### `by submit`

`by submit` automatically creates or finds the Change for the current work.
It reuses eligible existing evidence.
It validates and may fix according to policy.
It publishes the final eligible Candidate to a PR.

### Command idempotency

Repeated validation and submission are idempotent for the same Change, Candidate, Validation Policy Snapshot, and Acceptance Context.
An active Validation Run is reused rather than replaced.
An eligible completed Validation Run is reused.
A terminal operational failure ends only its Execution Attempt and may be retried through a new Attempt in the same unfinished Validation Run.
Changed head, policy, context, or allowlisted-file identity creates a new Validation Run under the same Change.
Calling `by validate` never replaces the Change.
An already published Candidate returns the existing PR.

### AFK delivery

An approved Task with the `afk` tag may be picked up automatically according to repository policy.
The worker creates or reuses its Change, runs implementation, and invokes the same submit capability internally.
No public Change creation command is required.

## Fixer Policy

Repo Config defines separate Validation Fixer and PR Fixer settings.
Validation Fixer is enabled by default and may receive a CLI override for one command-started operation.
AFK validation obeys Repo Config because no human command starts it.
When Validation Fixer is disabled, But Why? code records Needs Input from the open Finding because no automatic fixing path is configured.

PR Fixer is disabled by default and requires explicit repository opt-in.
It may address only failed GitHub-required checks or a confirmed merge conflict on an exact owned PR.
But Why? code records Needs Input when an exact owned PR has an active requested-changes review.
All free-form GitHub comments and review text remain nonblocking facts and never become code-writing instructions or agent-controlled lifecycle signals.

## Task Context and Acceptance Context

Task Context is the current Task title, description, and ordered comments.
Title and description may change only before Task Start.
Comments are append-only and, after Task Start, may be added only while the Task is Held or Needs Input.
Hold reasons and external-resolution reasons are operational history rather than Task Context.

Task Start creates the Task's sole Change when absent or reuses it when open, then captures Task Context as immutable Acceptance Context.
Task Start rejects a closed linked Change.
Repeated Task Start returns the existing Change without capturing another snapshot or launching an agent.

Task Resume starts fresh work from the last durable checkpoint rather than resuming a process or agent session.
When Task Context is unchanged, Resume retries the interrupted stage.
When a new comment or unresolved Finding requires code changes, Resume returns through implementation before validation.
Resuming Needs Input requires either a new comment or an external-resolution reason.
Resume adopts changed Task Context as a new Acceptance Context snapshot and emits a Trigger.

Adopting a new Task Comment resets every completed Specialist Reviewer before the new implementation cycle.
A genuinely different request uses a new Task and Change.
Final Review and Acceptance Review judge the resulting final Candidate.
A Change without Acceptance Context skips Acceptance Review.
Intent is never inferred from code and treated as Acceptance Context.

## Needs Input

Needs Input belongs to the Change.
A linked Task projects that condition as the `needs_input` Task status.
A standalone Change reports the same condition without creating a Task.

Rerunning `by validate` or `by submit` explicitly resumes an open standalone Change after Needs Input.
No separate standalone resume command is required.
The new command records the prior Needs Input as addressed and continues from current durable facts.
If the blocker remains, the Change records Needs Input again.

Needs Input is an exceptional orchestration-owned circuit breaker, not an agent outcome or collaboration mode.
Agents never request it, emit it, or change Task or Change lifecycle state.
Reviewers report Findings, while Implementers and Fixers make their best available decisions, record consequential Implementation Decisions, and continue their assigned work.
Agent uncertainty, disagreement, or preference is never itself a blocker.

Every Needs Input transition requires:

- A code-owned reason matched from trusted workflow facts.
- Preserved evidence for the detected blocker.
- Exhaustion of every approved automatic recovery for that reason.
- A resumable durable checkpoint.
- Explicit recovery actions exposed to the caller.

Valid code-owned reasons include disabled automatic fixing with open Findings, a completed code-writing execution without a successor Candidate, an unavailable external permission or service after recovery, an exhausted safety or fixing limit, repeated Tooling Failure, a fixed policy stop such as Sensitive Change, or an authoritative remote ownership mismatch.
The source Finding, execution, failure, policy fact, limit, or remote fact remains the evidence for the reason.
Recurring reasons should gain named automatic recovery paths over time so Needs Input becomes progressively rarer.

## Task lifecycle

Task state changes only through named operations with checked preconditions.
No command assigns an arbitrary state.

The lifecycle is:

- `new` before permanent Task Approval.
- `todo` after Approval and before Task Start.
- `implementing` while the linked Change is producing a Candidate.
- `validating` while the Change is checking, reviewing, fixing, publishing, or waiting for GitHub facts.
- `needs_input` while the Change records a blocker with no approved automatic continuation.
- `ready` when the owned PR satisfies readiness policy.
- `done` when the owned PR merges or verified no-change completion succeeds.
- `cancelled` when the user permanently ends unfinished work.

Task Hold temporarily projects an eligible Todo, implementing, validating, or ready Task as `held` and records the interrupted stage and required reason.
Hold first fences durable writes, then stops active local work with the same cancellation mechanism used by terminal cancellation.
It requests conversion of an owned PR to draft and records whether GitHub confirmed that remote protection.
If confirmation fails, the local Hold remains effective, exposes `remote protection unconfirmed`, and retries best effort.
An externally observed merge remains authoritative and completes the Task even during that uncertainty.
Task Resume restores the interrupted stage and restarts unfinished work from durable facts with fresh processes.
An owned PR remains draft until the current Candidate is validated and once again satisfies readiness policy.
A Held Todo Task may edit its pre-start Task Context, `afk` tag, dependencies, and queue position.
A Held started Task may add Task Comments.
Every Held Task may inspect, Resume, use verified no-change completion when eligible, or Cancel.

Done and Cancelled Tasks are read-only and leave Task Queue Order.
Needs Input is stored once on the Change and read through the Task projection.
Age alone never changes Task state or removes workspace or history.

The default dashboard shows New, eligible Todo, Held, Needs Input, and Ready Tasks in Task Queue Order.
Implementing, validating, and dependency-blocked Tasks appear in aggregate counts and explicit inspection rather than the actionable list.
Task detail includes only currently legal state-changing actions as complete command templates so agents do not guess at transitions.

## Finding resolution

Findings are immutable records on the Validation Run that produced them.
A later fix and clean result records an explicit resolution link instead of changing or deleting the original Finding.
A Finding is open until that durable resolution exists.

## Decisions and future improvement

Implementers and Fixer Agents record choices broadly when approved context and repository guidance do not determine the answer.
The records belong to the Change.
They include what was chosen, why, and relevant Findings or Candidates.

The PR Writer may filter these records for the final PR description.

Improvement Synthesis is a loose future capability that may analyze decisions across Changes to find repeated planning or documentation gaps.
It remains outside implementation and validation.
Its workflow and output are intentionally undefined for now.

## Git and concurrency

A newer linear branch head automatically supersedes an active Candidate.
The older Validation Run remains inspectable but its Candidate is not published.

A stale Fixer Execution must stop before writing if the Change head advanced.
Only one Fixer Execution may write to a Change Workspace at a time.

A non-linear branch update remains in the same Change but creates a replacement Candidate and forces full validation.
Prior Candidates remain history.

Delta-focused review is allowed only when ancestry, comparison base, policy, and applicable context remain eligible.
If any eligibility check fails, the Candidate receives full validation.
Configured checks always run against the complete current Candidate.

## Base selection

Automatic base selection follows this order:

1. Existing active Change base.
2. A base supplied by the caller for a new Change.
3. The unambiguous remote default branch recorded by local Git.

The capture capability does not depend on where a caller-supplied base came from.
For example, later PR reconciliation may supply an existing PR base without adding PR knowledge to capture.
Every selected base resolves to an existing full local `refs/heads/*` ref.
If no base can be selected safely, capture rejects without fetching or guessing.

The Candidate comparison base SHA is the Git merge base of its exact head and the selected base reference's resolved tip when the Candidate is captured.
But Why? records the selected base reference, its resolved tip SHA, the comparison base SHA, and the Candidate head SHA.
The comparison base and head identify the immutable diff that validation reviewed.
Movement of the selected base reference does not change an existing Candidate while its comparison base remains the same.

## Task approval, dependencies, ordering, and AFK pickup

Tasks begin in `new`.
`by task approve <task-id>` permanently and idempotently moves a Task to `todo` without changing its tags.
Approval and Task Context editing do not depend on prerequisites.

V1 supports only the built-in `afk` tag.
Adding an existing tag and removing an absent tag are successful no-ops.
The tag may change only before Task Start and enables automatic pickup without becoming a lifecycle state.

A Todo Task cannot start manually or automatically until every prerequisite Task is `done`.
Dependency edges may change only before the dependent Task starts.
Adding an existing edge and removing an absent edge are successful no-ops.
Self-edges and cycles are rejected atomically, with a cycle error showing the complete cycle.
A Cancelled prerequisite remains unsatisfied.

Every unfinished Task has one explicit Task Queue Order position.
New Tasks append to that order, Held and blocked Tasks retain their position, and Done and Cancelled Tasks leave it.
Reordering to the current position is a successful no-op.

The worker atomically claims the first Task in Task Queue Order that is Todo, tagged `afk`, unheld, unstarted, and unblocked by dependencies.
Approval, tag, dependency, and ordering changes commit before waking the Supervisor.
Manual Task Start and automatic pickup use the same durable claim boundary.
A successful claim atomically changes Todo to implementing.
Manual Task Start launches no agent.
Repeated Task Start returns the existing Change and workspace as a successful no-op.
There is no public `by task implement` command.

## Supervisor and repository workers

A thin user-level Supervisor starts at login and launches isolated repository workers on demand.
Workers may exit after an idle period.

The Supervisor owns explicit repository registration, wake delivery, worker process lifecycle, user-wide capacity, and cross-repository health.
It never opens repository state, interprets Repo Config, changes Git, or executes repository policy.

Repository identity uses the canonical Git common directory.
Repositories are never registered through filesystem scanning.

The first `by init` installs the Supervisor and registers the repository by default.
`by init --no-automation` skips service installation and registration.
Initialization is idempotent, and other commands never install or register the service implicitly.

Workers use the selected repository-local But Why? runtime when present and otherwise use the Supervisor runtime.
Supervisor-worker communication uses a small versioned protocol.
Invalid or incompatible selected runtimes produce typed operational failures rather than silent fallback.

Durable state commits before a Trigger is emitted.
Triggers only reduce latency.
Startup and low-frequency reconciliation recover eligible or interrupted work after lost Triggers, downtime, or crashes.

Repository and user-wide concurrency limits are enforced separately.
Durable atomic claims prevent duplicate ownership, and one repository cannot starve or crash another.

## Change Workspace lifecycle

Sandcastle is the sole owner of managed Change worktrees and attached execution sandboxes.
Manual work may edit a persistent Change Workspace directly.
Automatic agents attach sandboxes to that workspace.
Closing a sandbox does not close the Change Workspace.

Sandbox handles are process-local.
The Change branch and workspace metadata are durable.

A clean workspace may be removed and reconstructed from its branch.
A dirty user-managed workspace is never removed, reset, discarded, or overwritten automatically, and Resume rejects until the user makes it clean.
Interrupted dirty automatic work is copied into an immutable recovery Artifact before its managed workspace is rebuilt from the last durable Candidate.

Completion removes a clean physical workspace while retaining Git history, run history, Artifacts, decisions, and PR identity.

Agent output is not proof of a Candidate.
But Why? independently verifies the expected branch, clean worktree, exact head, and required ancestry before accepting it.

For a standalone Change, the current clean checkout is the writable Change Workspace while the initiating command remains attached.
Before every Fixer Execution, But Why? verifies that the checkout is still clean and at the expected head.
The Fixer Agent commits directly to that branch.
Unexpected edits or head movement stop fixing without resetting or overwriting work.

Task-backed and AFK background work uses a managed Sandcastle Change Workspace.

## Code-writing execution history

Every Implementer or Fixer Agent invocation creates a durable Code-Writing Execution directly under the Change.
The common record captures its role, expected starting head, workspace, status, timestamps, resulting head or Candidate, Artifacts, failures, and Implementation Decisions.
An Implementer Execution adds Acceptance Context and the remaining initial implementation goal.
A Fixer Execution adds its input Candidate, Validation Run, and assigned Findings.

Every execution starts with a fresh agent process.
It receives the current Change Workspace and relevant durable records.
The Change Workspace and durable records provide continuity across executions.

The PR Writer is also a fresh execution, uses only durable approved inputs, and cannot modify or validate the Change.

## Automatic execution safety

The configurable default safety budget is 20 code-writing agent executions per Code-Writing Budget Cycle.
Repo Config may choose another per-cycle limit.
Implementer Executions and Fixer Executions consume the budget.
Checks, reviewer executions, PR Writer execution, operational retries, and time waiting for GitHub do not.

The twentieth execution in one cycle completes and is judged normally.
Needs Input is recorded only when a twenty-first execution in that cycle would be required.

The budget does not reset across internal Runs, publication handoffs, or Hold Resume.
Task Start or automatic pickup begins the first budget cycle, and Resume from Needs Input begins a fresh cycle.
Historical execution and usage totals remain cumulative across cycles.
Limit exhaustion preserves the branch, workspace, Candidates, Findings, decisions, Artifacts, and Run history.

Operational retry limits are separate from the code-writing budget.
Operational failures remain distinct from Findings.

## Publication recovery and PR reconciliation

PR identity is persisted before reconciliation is triggered.
Publication and PR Writer failures use bounded retries.

If remote publication succeeds before local persistence, recovery finds the existing PR from durable repository, branch, and Change facts before attempting creation.
Recovery never creates a duplicate PR.
Exhausted publication failure preserves the validated Candidate, Change Workspace, decisions, and validation evidence.

Successful publication releases active worker capacity.
Waiting for GitHub checks, reviews, mergeability, or merge never occupies a code-writing slot.

The PR Reconciler receives an already-published PR.
It does not create, modify, or merge the PR.
It records durable PR facts or blockers before projecting Task state or emitting a Trigger.

A PR is ready only when it is open, non-draft, targets the expected base, has the expected validated Change head, passes required GitHub checks, is mergeable, and has no blocking review.
Pending facts project `validating`.
Readiness projects `ready`.
Merge projects `done`.

A new locally owned head after publication stays in the same Change and uses the same PR.
It creates a new Candidate and must pass validation before But Why? updates the PR branch to that head.
When reconciliation observes an external PR head push or base-target retargeting, But Why? code records Needs Input instead of adopting it automatically in v1.
Normal movement of the expected base branch may produce a confirmed merge conflict eligible for the opt-in PR Fixer.
Conflict fixing merges the exact latest expected base tip into the owned PR branch and records a merge commit rather than rebasing or force-pushing rewritten history.
The resulting Candidate must pass the complete gate, and GitHub and the human retain authority over the final PR merge method, including squash merge.
Publication recovery and reconciliation never create a second PR for the Change.

## Owned PR readiness fixing

Before every PR Fixer execution and remote write, But Why? re-reads and verifies the durable repository, PR number, head repository, head branch, base repository, base target, and expected remote head SHA.
Any mismatch causes But Why? code to record Needs Input without running Pi or writing remotely.

PR Fixer runs only through a hardened Sandcastle Docker or rootless Podman provider using a fixed image and non-root user.
Its explicit environment allowlist excludes GitHub credentials, SSH agent access, host credentials, and repository secrets.
No extra host mounts, supplementary groups, devices, or Docker socket are available.
CI diagnostics are bounded, treated as untrusted data, and never override Task Context or fixed Fixer instructions.

Pi writes only in the managed Change Workspace and cannot push.
But Why? applies fixed orchestration policy to changed paths and content, and a matching Sensitive Change stops automatic publication and records Needs Input.
Otherwise But Why? captures the clean successor Candidate, runs the complete local Validation Gate, rechecks the expected remote SHA, and updates the owned branch through a parent-controlled compare-and-swap push.
The PR Fixer makes and records its own decisions but never approves, merges, requests Needs Input, or changes lifecycle state.
But Why? code records Needs Input only when trusted workflow facts show no successor Candidate, ambiguous GitHub state, an ownership mismatch, a Sensitive Change, or an exhausted limit after every approved recovery.

## Change and Task completion

A validation-only success does not close the Change.
A later `by submit` may publish the same eligible Candidate without repeating validation.
Every Task that changes the repository completes only when its exact validated Candidate is published through its owned PR and GitHub reports that PR merged.

`by task complete <task-id> --reason <reason>` is the only manual completion path.
It is available only after permanent Task Approval and means that fulfilling the Task required no repository change.
For an approved Task that never started, the absence of a Change and PR is the complete proof because But Why? never owned a workspace or result for it.
For a started Task, the command first fences active work, then proves that the managed Change has no owned PR, its branch has no net tree diff from the recorded base, and its workspace has no staged, unstaged, untracked, or dirty submodule work.
Ignored files do not count as repository changes.
If changed work exists, completion rejects with guidance to submit or cancel it.
Successful no-change completion records the reason, closes any open Change as `completed`, moves the Task to Done, and satisfies dependents.

`by task cancel <task-id> --reason <reason>` permanently moves any unfinished Task to Cancelled.
It fences active work, closes its Change and owned PR as cancelled, preserves history, and never satisfies dependents.
Remote closure failure records durable pending work for retry without reopening local workflow.

Closure is permanent, and a closed Change accepts no new Candidates.
Closing a Change removes a clean managed workspace automatically.
Dirty managed workspaces are preserved for inspection.
Standalone user checkouts are never removed.
Durable Change, Candidate, validation, decision, and PR history remains available.
Artifact retention may be configured separately later.

## Durable observability

Change Activity is an append-only history of meaningful lifecycle milestones.
It is not an event-sourced replacement for current Change, Candidate, Validation Run, Finding, execution, or PR records.

Activity records contain the Change, related run or execution, phase, activity kind, timestamp, concise summary, and relevant domain or Artifact references.
They record actions and outputs, never private model reasoning.

Raw agent and Sandcastle stdout, stderr, transcripts, logs, and structured outputs are stored as referenced Artifacts instead of duplicated into activity records.

Compact Change and linked Task views expose current phase, execution count, worker health, latest activity, latest validation result, head SHA, Needs Input, and PR state.
Detailed activity and logs use separate query surfaces.

TOON and JSON remain structured stdout contracts.
Progress and diagnostics use stderr.
Empty states, unavailable metrics, and failures are typed explicitly.
Usage aggregates sum Producer records without inventing token or dollar values.

## Comparison and trade-offs

A comparison with `no-mistakes` at commit `b87672422163865f0e2dfcc3f1432887ccea2124` showed a useful public boundary: existing committed work can enter one validation, fixing, and publication flow through a single trigger.

But Why? borrows that simple boundary rather than its all-in-one pipeline.
But Why? retains explicit Candidates, durable Change and Validation Run history, a read-only Validation Gate, optional Acceptance Context, and exact-head publication.

But Why? does not silently commit dirty work.
`by validate` and `by submit` require a clean committed Candidate.

## Acceptance Context provenance and review boundaries

Other Acceptance Context sources may be added later, such as a user-supplied immutable requirements snapshot with explicit provenance.
Generated text may summarize supplied requirements, but it never invents intent from code or a diff.

A Validation Run may retain its source Task ID for traceability.
The Validation Gate never reads live Task state or moves the Task.
Task history is an optional linked view of Change and Validation Run history.

Acceptance Findings concern behavior required by Acceptance Context or repository policy.
Concerns not required there belong to an appropriate Specialist Reviewer.
The future planning Intent Reviewer remains a separate pre-implementation capability.

## Preserved validation primitives

The pivot changes ownership rather than replacing the existing validation primitives.
Commit-pinned Validation Workspaces, Phases, Rounds, Findings, Artifacts, Prepare, configured checks, and Sandcastle execution remain valid.

The refactor removes the required Task ID from Validation Runs.
Generic validation storage stops mutating Task state.
Validation preflight separates from publication preflight.
Task history becomes an optional linked view.

## Superseded Task-owned decisions

The following decisions no longer apply:

- Task owns the entire implementation, validation, fixing, and publication journey.
- Validation requires a Task.
- Task state authorizes each validation phase.
- The Implementer fixes Validation Findings.
- AFK origin automatically enables fixing while manual origin disables it.
- Every reviewer reruns after every changed commit.
- Every reviewer must inspect the exact published SHA.
- Needs Input belongs only to a Task.
- Decisions belong to a Task rather than a Change.

## Documentation consequences

ADR 0008 approves Change as the ownership center and supersedes only the Task-required validation and Task-owned delivery parts of current v1 architecture.

The existing Sandcastle, modular-monolith, private SQLite store, and no-generic-Run decisions remain valid.

Unfinished issues for Acceptance Review, Quality Review, publication, PR watching, reconciliation, and the repo-local daemon must be replaced or rewritten after this ledger is approved.
