---
status: tasks-recorded-unapproved
artifact_kind: working-plan
remove_when: all four approved implementation Tasks are complete and accepted behavior is recorded in current authority
---

# Task Review and Task Submission plan

> This file is a non-authoritative working plan.
> It does not describe current product behavior or authorize implementation.
> Recorded Tasks become accepted intent only through Task Approval, and Implementation Authorization remains separate.

## Required outcome

But Why must review a New Task against repository evidence before the Task becomes approved.
The review must determine whether the requested outcome is real, necessary, correctly scoped, and clear enough for implementation and later verification.

Task Submission must replace direct Task approval.
A passing Task Review must move an unlinked New Task to Todo without a second approval step.
A blocking result must preserve actionable Findings without approving the Task.

A later slice must let the Operator revise or explicitly reconsider an approved Task without silently invalidating approval or losing historical review evidence.

## Domain ownership and language

Task Intent owns Task Review and Task Submission.
Task Review consumes repository runtime capabilities but is not part of Change Validation.

The canonical terms are:

- **Task Review**: One durable repository-aware judgment of one Task proposal.
- **Active Task Review**: The one Task Review for a Task that has started but has no final outcome.
- **Task Review Finding**: One material problem that blocks approval of the reviewed proposal.
- **Task Review Base**: The exact Git commit used as repository evidence.
- **Task Review Policy Snapshot**: The resolved immutable reviewer and execution policy for one Task Review.
- **Task Review Workspace**: The disposable exact-commit workspace used by the reviewer.
- **Task Review Tooling Failure**: A failure that prevents a trustworthy reviewer judgment.
- **Task Reviewer Session**: The Task-owned continuation identity for reviewer execution.
- **Task Reviewer Transcript**: The retained complete JSONL transcript for one Task Reviewer Session.
- **Task Submission Authorization**: The Operator's explicit permission to submit one selected recorded Task for Task Review.

The design does not add a generic Review, Run, Finding, or Tooling Failure domain.
Planning Review remains only a possible future term for review above one Task.

## Review scope

One Task Review reviews one complete Task proposal.
The proposal consists of the exact Task Context and exact direct Task Dependency set.

The reviewer must determine whether:

- the claimed problem or required outcome exists at the Task Review Base;
- current repository behavior already satisfies the outcome;
- current behavior can be reused or configured instead of replaced;
- new repository work is necessary;
- the Task has one coherent scope suitable for one Change;
- the direct Task Dependencies express real implementation or verification prerequisites;
- the requested outcome is observable enough for implementation and later review; and
- any prescribed verification constraint is supported, feasible, proportionate, and capable of observing the intended outcome.

The reviewer applies the Task verification philosophy without requiring a verification plan, inventory, standard Task section, preferred mechanism, or durable test.
The absence of a prescribed verification mechanism is not itself a Finding.

If the required outcome already exists, the reviewer must return a Finding rather than approve unnecessary work.
The reviewer may recommend Task revision, another prerequisite Task and Change, bounded external evidence gathering, external setup, or cancellation.
The reviewer must not mutate Task or Change lifecycle state.
The reviewer must not prescribe a detailed implementation plan or review an initiative spanning several Tasks.

Later implementation evidence can still establish that no repository change is required.
The current supported Change and Task cancellation behavior handles that result; Task Review must not reintroduce the retired durable No-Change completion concept.

## Review input and repository evidence

Every new Task Review receives:

- the complete current Task Context;
- the exact current direct Task Dependency IDs;
- point-in-time evidence for each direct dependency;
- the exact Task Review Base commit;
- the resolved Task Review Policy Snapshot;
- the previous applicable Task Review outcome when one exists; and
- a deterministic proposal diff from the previous reviewed proposal when one exists.

Direct dependency evidence contains each dependency's ID, lifecycle state, complete Task Context, and direct dependency IDs.
It is immutable point-in-time evidence for what the reviewer judged, not part of proposal identity after capture.
Ordinary reuse does not reread or reevaluate that evidence; Change Start separately enforces the current Done prerequisite.
It does not automatically contain reverse dependents, similar Tasks, the complete Task inventory, or transitive dependency contexts.
The reviewer may use supported read-only Task commands when material evidence requires further inspection.

An unfinished dependency does not by itself produce a Finding.
A missing, unclear, contradictory, or materially unresolved prerequisite can produce a Finding.
Change Start continues to require every Task Dependency to be Done.

The previous outcome and proposal diff are navigation evidence only.
But Why must not persist a separate review reason or generated diff.

## Task Review Base

Task Submission uses the exact `HEAD` commit currently checked out in the canonical main checkout as the Task Review Base, regardless of the local branch name.
Task Submission fails deterministic preflight when the canonical main checkout or its `HEAD` commit is unavailable.

Task Submission must not:

- fetch or synchronize a remote branch;
- require the commit to be published;
- accept an alternate base;
- include uncommitted files;
- require a clean canonical checkout;
- warn about uncommitted files;
- record a tree SHA; or
- calculate changed paths, commit counts, ancestry, or stale status after review.

The structured result identifies the reviewed commit.
Repository drift after review does not invalidate Task Approval or block Change Start.
An Implementer may inspect Git history when later evidence makes drift relevant.

## Task data and retained evidence

Task Review reads current Task data through Task-owned persistence interfaces.
SQLite remains the current Task backend.
A possible future external Task backend does not change first-version behavior.

Shared Repository State retains Task Review records independently of the current Task backend.
Each Task Review retains:

- identity and order;
- Task identity;
- exact reviewed Task Context;
- exact reviewed direct Task Dependency set;
- exact captured direct dependency evidence;
- Task Review Base commit;
- Task Review Policy Snapshot;
- start and completion times;
- active or completed state;
- passed, findings, or tooling-failed outcome;
- complete Task Review Findings or Task Review Tooling Failure;
- Task Reviewer Session references; and
- Task Reviewer Transcript references.

A Task Review does not retain a separate Task Approval record, current-result pointer, relevant-file list, stale flag, generated proposal diff, review-reason field, tree SHA, or Artifact reference.

Task Review history, Findings, snapshots, session references, and transcript references remain immutable after the Task becomes Done or Cancelled.
The first version retains this evidence permanently.
It does not add pruning, retention settings, archive commands, or mutable Finding resolution.

## Current judgment and reuse

The current Task Review judgment is the newest completed passed or Finding-blocked Task Review that exactly matches the current Task Context and direct Task Dependency set.
An Active Task Review does not replace the current completed judgment.
A tooling-failed Task Review supplies no judgment and does not replace an earlier passed or Finding-blocked judgment.

Ordinary Task Submission reuses a matching completed judgment.
A passed judgment returns approval without another reviewer call.
A Finding-blocked judgment returns the existing Findings without another reviewer call.
A tooling-failed review permits another Task Review.

Changes to repository state, Task Review Base, policy, reviewer configuration, or direct dependency content and lifecycle state do not invalidate a matching judgment.
Only a changed Task Context or changed direct Task Dependency set prevents exact proposal reuse.

`--rerun` bypasses completed-result reuse and requests another judgment of the unchanged proposal.
It does not request a fresh Task Reviewer Session.

## Submission flow

Task Submission and Task Review abandonment hold one per-Task Execution Lock with owner `task_submission` and the Task ID as its key for the complete command operation.
Lock contention reports a Task Review operation in progress, does not claim whether Submission or abandonment owns the lock, and makes no durable change.
This operational contention result is distinct from the durable Active Task Review result returned after the lock is acquired.

Task Submission performs these steps in order:

1. Load the current Task and verify that its lifecycle and Change linkage permit submission.
2. Return the existing Active Task Review when one exists.
3. Unless `--rerun` was requested, return the lifecycle approval of an existing Todo Task that has no matching Task Review without creating Review history.
4. Unless `--rerun` was requested, return a reusable passed or Finding-blocked result before resolving repository execution inputs.
5. Resolve the Task Review Base, Repo Config, Global Config, reviewer policy, and workspace inputs only when a new Review is required.
6. Complete deterministic preflight before creating the durable Active Task Review.
7. In one immediate SQLite admission transaction, reread lifecycle, Change linkage, Task Context, dependencies, and Active Review state; reject a proposal that changed after the command loaded it; and atomically persist the Active Review with the exact proposal, direct dependency evidence, Base, and policy.
8. Run the reviewer, clean up disposable workspace state, and idempotently index every Task Reviewer Session JSONL file observed by the Review into immutable transcript references.
9. Only after cleanup and transcript indexing succeed, use one compare-and-set SQLite completion transaction to require the same Active Review, atomically persist its outcome with the slice-specific Task lifecycle transition, and remove its Active Review marker.

A SQLite uniqueness constraint permits at most one Active Task Review per Task.
Task mutation and cancellation transactions reject when that Task has an Active Task Review.
A preflight failure creates no Task Review history.
A failure after durable Review creation must leave inspectable active or completed evidence suitable for explicit recovery.

## Findings and tooling failures

Every Task Review Finding blocks approval.
A Finding contains:

- title;
- description;
- evidence; and
- relevant repository files when known.

Task Review uses the shared core reviewer Finding fields.
Its Task-owned structured-output contract and decoder exclude Validation-only Artifact references.
This does not weaken or change the existing Change Validation `reviewerOutput` contract.
Task Review does not add severity, category, Artifact references, or a Needs Input outcome.
Nonblocking suggestions remain only in the Task Reviewer Transcript.

A Task or available-evidence problem is a Finding.
A But Why, Repository Preparation, reviewer runtime, configured tool, workspace, or structured-output problem that prevents trustworthy judgment is a Task Review Tooling Failure.
A deterministic preflight failure before Task Review creation returns a command error and creates no Task Review history.

A later Task Review determines whether an earlier Finding remains.
Findings do not have a mutable resolved flag.

## Task Reviewer Sessions and transcripts

Task Reviewer Sessions are Task-owned and do not change the Change-owned Reviewer Session domain.
The first version uses one Task Reviewer and no review phases or Specialist Reviewers.

A later Task Review continues the Task's most recent Task Reviewer Session when that session remains usable and compatible with the selected reviewer configuration, including when the proposal changed.
Every continued review receives the complete current proposal and applicable deterministic diff.

`--rerun` continues the existing compatible and usable session.
The first Task Review starts a fresh session.
A later Review starts a fresh session only when no earlier session exists or the most recent session is proven unusable or incompatible.
The first version does not expose a fresh-session or second-opinion option.

But Why retains the complete JSONL transcript from every Task Reviewer Session, including restarted or superseded sessions.
Before a Task Review completes or is successfully abandoned, it idempotently discovers every Task Reviewer Session JSONL file observed by that Review and records one immutable transcript reference per file.
A transcript-indexing failure leaves the Review active, reports the failed indexing operation, and permits recovery through successful abandonment after the indexing obstacle is resolved.
Completed Reviews therefore already have retained transcript references before the Task can become Done or Cancelled.
Task terminal transitions do not add a Task Terminal Cleanup lifecycle, remove Task Reviewer Session history, or repeat transcript indexing.

Existing Change Validation transcript behavior remains unchanged.
Validation retains the Acceptance Reviewer and every Specialist Reviewer transcript, including restarted or superseded sessions.
Prepare and Check phases retain their existing evidence rather than reviewer transcripts.

## Workspace and shared mechanisms

Every new Task Review creates a disposable Task Review Workspace at the exact Task Review Base.
It runs configured Repository Preparation in that workspace.
It must not modify the canonical checkout.
It attempts to remove the disposable workspace and temporary ref after reviewer execution and before completing the Review.
A setup or execution failure completes the Review as tooling failed only after workspace cleanup and transcript indexing succeed.
A cleanup or transcript-indexing failure stores the latest failed operation and exact diagnostic as mutable Active Task Review recovery state, leaves the Review active, and does not approve or revoke the Task.
Each failed recovery attempt replaces that operational state.
Successful cleanup and transcript indexing clear it in the same completion or abandonment transaction that removes the Active Review marker.
`by task-review show` exposes the recovery state, and the same Review remains the only retry target.
The Operator may resolve the reported obstacle or remove the exact orphaned disposable resources with repository-safe external tooling, then use Task Review abandonment to retry cleanup and indexing.

Task Review does not automatically run configured Validation Checks.
The reviewer may run focused tests, searches, and commands needed to judge the Task.
Task Review does not create, store, inspect, or clean up Artifacts.
A reused result returns before workspace creation or Repository Preparation.

The first implementation slice may extract only the low-level mechanisms required by both Task Review and Change Validation:

- reviewer process execution behind a domain-neutral Adapter that translates failures into Task-owned or Change-owned errors at each wrapper;
- injected reviewer output correction behind a domain-neutral contract boundary supplied by the owning Task or Change wrapper;
- session-file and transcript mechanics; and
- disposable commit-workspace mechanics behind a domain-neutral Adapter, including temporary refs, Sandcastle worktrees, exact-head checks, scoped execution, interruption, and cleanup.

The extraction moves direct Sandcastle factory ownership to the neutral workspace Adapter and updates the structural boundary that enforces that ownership.
Task Review must not import Change Validation errors, Validation-only reviewer output, or Change-owned workspace records.

Task and Change domain wrappers, records, persistence, errors, policies, sessions, and lifecycle cleanup remain separate.
The extraction must not create a generic review framework or become a separate implementation Task.

## Configuration

Task Review reads Repo Config from the exact Task Review Base for Repository Preparation, Agent Environment, Task Reviewer overrides, and Repo Agent Profiles.
It reads current Global Config for the default Task Reviewer and Global Agent Profiles.

Repo Config and Global Config each gain an optional `review.task` object with the same `agentProfile` and optional `instructionsFile` shape used by `review.acceptance`.
Task Review resolves Repo selection before Global selection, then uses `defaultAgentProfile`, following current Acceptance Reviewer precedence.
Task Review resolves Repo instructions before Global instructions, then uses built-in Task Review instructions.
The built-in instructions require the reviewer to apply the strict Task Dependency definition and the Task verification philosophy from the portable But Why guidance.
The implementation must use the same Agent Profile resolution and resource rules that current reviewers use.

Task Submission resolves one immutable Task Review Policy Snapshot before creating a Task Review.
Later configuration changes do not alter historical Reviews or invalidate approval.
Task inspection does not label an approval stale or suggest rerun because configuration changed.

## Authorization and output

Task Submission Authorization is distinct from Task Recording Authorization, Task Approval, and Implementation Authorization.
The planning agent must identify the selected recorded Task and its intended outcome before asking the Operator for Task Submission Authorization.
The Operator does not need to approve the exact Task description wording or dependency encoding.
The CLI does not persist a separate authorization record, digest, or token.
Task Submission still rejects a concurrent proposal change between its initial load and durable Review admission so that the reviewer judges one exact proposal.
A changed intended outcome or explicit `--rerun` requires another authorization.
Clearer wording or corrected dependency encoding within the authorized outcome does not require approval of that representation.

A passing Task Review moves a New Task to Todo without a second human confirmation.

`by task submit` follows the concise result pattern of `by change submit`.
It reports the Task Review result, Findings when needed, reviewed commit, and actionable next command without repeating the complete Task Context or dependency evidence.
The command waits for the final result and returns one structured result.
Human-readable progress may use stderr under the repository's current CLI output contract.

But Why does not add a queue, detached worker, polling command, or notification system.
An external agent host may run the synchronous command in the background.

## Active Review and abandonment

Persistence permits at most one Active Task Review per Task.
Another submission reports the existing Active Task Review instead of creating a second Review.

Task Context mutation, Task Dependency mutation, Task revision, and cancellation reject while a Task has an Active Task Review.
Direct dependency Tasks remain independently mutable.

But Why does not infer that interrupted reviewer processes are dead.
After the Operator stops every process owned by an interrupted Review, `by task-review abandon <review-id>` acquires the same per-Task Execution Lock, attempts to remove the exact Task Review Workspace and temporary ref, idempotently indexes every observed Task Reviewer Session transcript, and uses a compare-and-set transaction to persist Tooling Failure and remove the Active Review marker atomically.
If cleanup or transcript indexing cannot be verified, abandonment reports the exact failure, replaces the Active Task Review recovery state with that failure, and leaves the Review active for another recovery attempt.
The Operator may resolve the reported cleanup obstacle or remove the exact orphaned disposable resources with repository-safe external tooling, then retry abandonment.
Successful abandonment preserves Review and transcript evidence.
Abandonment does not delete history or resolve Findings.

## CLI surface

The complete four-slice interface is:

- `by task submit <task-id> [--rerun]`;
- `by task revise <task-id>`;
- `by task reviews <task-id>`;
- `by task-review show <review-id>`; and
- `by task-review abandon <review-id>`.

`by task show` reports the current Task Review summary and the valid next command.
`by task reviews` reports ordered history.
`by task-review show` reports one complete Review, including Findings or Tooling Failure and transcript navigation.

The design does not add separate approval, retry, resume, findings, Artifact, global Review listing, or stale-status commands.
`by task approve` is removed without a compatibility alias because But Why is unreleased and no supported external caller requires an old and new submission interface to coexist.

Task Submission accepts only unlinked New and Todo Tasks.
It rejects Change-linked, Done, and Cancelled Tasks.
Review history remains inspectable after Change Start and terminal Task lifecycle transitions.

## Delivery slices

The implementation uses four vertical slices.
Slice 1 protects approved Task intent.
Slice 2 adds the complete first Task Review and approval path.
Slices 3 and 4 add independent revision and rerun capabilities after Slice 2.

Cancelled Tasks BY-154 and BY-155 are not prerequisites and do not establish accepted behavior.
Slice 2 uses the existing owner-keyed SQLite Execution Lock, shared core reviewer Finding contract, simplified Task Context, and safely decoded Reviewer Session JSONL mechanics delivered by completed Tasks BY-54, BY-83, BY-157, and BY-160.
Those completed Tasks are existing repository capabilities, not Task Dependencies.
Later slices inherit that prerequisite transitively.
Slice 1 has no Task prerequisite.

### Verification for every slice

Apply the repository verification guidance after the implementation shape is known.
Select proportionate evidence that can establish the accepted behavior and affected invariants at the relevant boundary.
Reuse or update retained evidence when it remains sufficient.
Do not add durable tests by default or create tests whose only purpose is to prove documentation wording or the absence of retired concepts.
Run focused evidence and the applicable mandatory repository gates identified by `docs/tooling.md`.

### Slice 1: Protect approved Task intent

**Outcome**

An approved Todo Task retains the Task Context and direct Task Dependency set recorded when it became approved.
Direct approval remains available until Slice 2 replaces it.

**Required behavior**

Slice 1 must:

- reject Task Context application for every Todo Task, including an identical draft;
- reject dependency add, remove, replace, and clear operations for every Todo Task;
- continue to reject durable intent mutation for Change-linked and terminal Tasks;
- keep New Task Context and dependencies editable;
- keep `by task context draft` available because it creates only a disposable file;
- preserve existing Todo Tasks as startable;
- keep `by task approve` available; and
- report that an approved Task is immutable without suggesting the unavailable `by task revise` command.

Slice 1 does not add Task Review records, commands, lifecycle, or schema.

### Slice 2: Review New Tasks before approval

**Outcome**

An unlinked New Task can become Todo only through a completed passing Task Review of its exact proposal and repository evidence.
Existing Todo Tasks remain approved without fabricated Task Review history.

**Dependency**

Slice 2 depends on Slice 1 because Task Submission cannot approve exact intent while approved Todo intent remains mutable.
Slice 2 also depends on completed Task BY-167 because BY-167 owns migration `0025` and Slice 2 must append migration `0026` after it.
The completed results of BY-54, BY-83, BY-157, and BY-160 are current repository capabilities rather than dependencies.

**Required behavior**

Slice 2 must:

- add Task Review persistence, history, Findings, Tooling Failures, policy snapshots, Task Reviewer Sessions, and transcript references;
- add a Task-owned reviewer structured-output contract and decoder that reuse the shared core Finding fields without Validation-only Artifact references;
- provide built-in Task Review instructions that apply the strict Task Dependency definition and Task verification philosophy without requiring a verification plan or Task Context template;
- append migration `0026` after migration `0025`;
- implement deterministic preflight, exact Task Review Base resolution, workspace preparation, reviewer execution, cleanup, completed-result reuse, interruption recovery, and abandonment;
- add `by task submit <task-id>` for unlinked New Tasks and ordinary inspection of existing Todo approval;
- move New to Todo only after a passing Review;
- leave New unchanged after Findings or Tooling Failure;
- return a matching passed or Finding-blocked result before policy, workspace, preparation, or reviewer execution;
- create a new Review when the Task Context or direct Task Dependency set changed;
- permit another ordinary submission after Tooling Failure;
- remove `by task approve` without a compatibility alias;
- add `by task reviews`, `by task-review show`, and `by task-review abandon`;
- add the Task Review summary to `by task show` without revision or rerun guidance;
- preserve existing Todo Tasks as startable without a legacy marker or fabricated Review;
- keep `--rerun` absent from Task Submit syntax until Slice 4;
- reject durable Task mutation and cancellation while a New Task has an Active Task Review;
- preserve complete Task Review and transcript evidence after Task terminal transitions; and
- perform only the bounded shared-mechanism extraction defined above.

Slice 2 does not add explicit rerun or Task revision.
It does not need a Change Start guard because only New Tasks can have an Active Task Review and New Tasks cannot start a Change.

### Slice 3: Revise approved Task intent

**Outcome**

The Operator can explicitly move an unlinked Todo Task to New before changing its approved intent.

**Dependency**

Slice 3 depends on Slice 2 because revision returns an approved Task to the New lifecycle and relies on Task Submission to approve that proposal again.

**Required behavior**

Slice 3 must:

- add `by task revise <task-id>`;
- move an unlinked Todo Task to New without changing its Task Context or dependencies;
- make revision of a New Task without an Active Task Review a successful idempotent no-op;
- reject revision for Change-linked, Done, Cancelled, or actively reviewed Tasks;
- preserve historical Task Review evidence without a durable Revision record;
- add `by task revise <task-id>` as the Todo mutation result's required next action;
- add revision guidance to `by task show`; and
- let an exactly restored proposal receive the matching passed-Review reuse behavior owned by Slice 2.

### Slice 4: Recheck unchanged Task proposals

**Outcome**

The Operator can request another judgment of an unchanged New or Todo proposal without silently losing an existing approval.

**Dependency**

Slice 4 depends on Slice 2 because rerun extends Task Submission and the Task Review lifecycle that Slice 2 introduces.
Slice 4 does not depend on Slice 3 because reconsidering an unchanged approved proposal does not require intent revision.
Slices 3 and 4 may proceed independently after Slice 2.

**Required behavior**

Slice 4 must:

- add `by task submit <task-id> --rerun` for unlinked New and Todo Tasks;
- bypass completed-result reuse while continuing the most recent usable compatible Task Reviewer Session;
- let New rerun pass move the Task to Todo;
- leave New after rerun Findings, Tooling Failure, or successful abandonment;
- preserve Todo and its prior approval while the rerun is active;
- keep Todo and replace the current judgment after a passing rerun;
- move Todo to New after a Finding-blocked rerun;
- keep Todo and preserve its previous judgment after Tooling Failure or successful abandonment;
- extend Slice 2's Active Review mutation and cancellation guard to Todo Tasks; and
- block Change Start while a Todo Task has an Active Task Review.

## Recorded Task graph

The authorized Tasks were recorded in this order:

1. BY-163, Protect approved Task intent, with no dependencies.
2. BY-164, Review New Tasks before approval, with direct dependencies on BY-163 and BY-167.
3. BY-165, Revise approved Task intent, with a direct dependency on BY-164.
4. BY-166, Recheck unchanged Task proposals, with a direct dependency on BY-164.

BY-163 has no direct dependency because its bounded result uses the current Task lifecycle and persistence behavior.
BY-164 cannot implement or verify exact reviewed approval until BY-163 makes approved intent immutable.
BY-164 also requires completed Task BY-167 because BY-167 owns migration `0025` and BY-164 must append migration `0026` after it.
The owner-keyed SQLite Execution Lock, shared core reviewer Finding contract, simplified complete Task Context, and safely decoded Reviewer Session JSONL mechanics are already supported repository capabilities from BY-54, BY-83, BY-157, and BY-160 and therefore are not dependencies.
BY-165 cannot implement or verify reapproval after revision until BY-164 provides Task Submission and retained Task Review judgments.
BY-166 cannot implement or verify explicit reconsideration until BY-164 provides Task Submission, Active Task Review, and retained judgments.
BY-166 does not depend on BY-165 because unchanged-proposal reconsideration does not use revision.
The recording results established that every Task is New, unapproved, has the exact direct dependencies, and has no Change.

BY-158 and BY-159 own simplification and safe decoding of Change Validation Policy Snapshots.
BY-161 owns safe decoding of Change-owned Implementation Decision Snapshots, and BY-162 owns the production `JSON.parse` structural rule.
The Task Review work must not modify or duplicate those Change-owned Snapshot representations or decoders.
BY-158, BY-159, BY-161, and BY-162 are not prerequisites for the Task-owned policy and persistence behavior in this graph.

### Recorded Task outcomes

- BY-163 protects approved Task intent from later mutation.
- BY-164 introduces Task Review and Task Submission for New Tasks.
- BY-165 lets the Operator return an unlinked approved Task to New before revising its intent.
- BY-166 lets the Operator request another review of an unchanged proposal.

The working plan does not reproduce exact Task descriptions or verification inventories.
The recorded Tasks remain New and unapproved.
Their current descriptions contain superseded authoring structure, so they require authorized revision before approval.

## Deferred and excluded work

This plan does not approve:

- review across a Task set or initiative;
- external Task backends or cross-store coordination;
- automatic related-Task discovery;
- a Task relevant-file field;
- approval staleness or drift guards;
- alternate Task Review Bases;
- fresh-session or second-opinion options;
- Specialist Task Reviewers or review phases;
- Task Review Artifacts;
- nonblocking Finding severity or categories;
- mutable Finding resolution;
- Task Review pruning or retention configuration;
- queues, polling, notifications, or detached workers;
- unattended implementation or automatic fixes;
- reviewer authority isolation; or
- a future Annotation mechanism.

Deferred questions remain in `docs/open-questions.md` only when they represent a credible future design question.

## Authority updates after approval

The Operator authorized recording the four earlier Task proposals and their dependencies.
Later Task-authoring decisions superseded parts of the recorded descriptions, so those descriptions require authorized revision before Task Approval.
The recorded Tasks remain unapproved and do not authorize implementation.
Do not update current-system authority to claim unimplemented behavior.

Each implementation slice must update the applicable current authority when its behavior lands, including:

- `docs/context/task-intent/CONTEXT.md` for Task Review, Task Approval, revision, and lifecycle terms;
- `docs/context/repository-runtime/CONTEXT.md` for retained state and configuration ownership;
- `docs/architecture.md` for Task Review ownership and workflow boundaries;
- `docs/cli-output.md` for Task Submission and Review result contracts;
- `docs/public/` and packaged agent guidance for portable operation; and
- accepted ADRs when the implemented design changes their constraints.

The obsolete detailed Planning Submission design was removed from this working plan rather than retained as current guidance.
Git history remains sufficient historical evidence.
