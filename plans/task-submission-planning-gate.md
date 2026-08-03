---
status: requires-refresh-before-task-creation
artifact_kind: working-plan
remove_when: the refreshed implementation slices are complete, accepted behavior is recorded in current architecture and SQLite Tasks, and every deferred question is transferred to an authoritative open question or explicitly rejected
---

# Task Submission planning gate

> Non-authoritative working plan.
> The previously approved detailed design requires refresh after the lifecycle and evidence simplification review.
> The detailed sections below preserve prior planning context but must not create implementation Tasks until the operator approves a refreshed complete design.
> Agents must use this file only when the operator or an active Task explicitly identifies it as planning context.

## Refresh notice

The planning capability remains a future accepted direction, but its current detailed lifecycle is not the approved implementation target.
The refresh must use [Lifecycle and evidence simplification review](lifecycle-evidence-simplification-review.md), the refreshed [Verification portfolio redesign](verification-portfolio-redesign.md), and implemented simplification outcomes.

The refresh must preserve Task-based planning, separate Planning Run and Validation Run ownership, mandatory Reviewer Session continuity, one material reviewer Finding contract, proportionate evidence, and explicit operator approval.
It must reconsider exact immutable snapshot duplication, permanent Planning history, active-run and abandonment machinery, approval invalidation, drift rules, inspection breadth, and every constraint inherited from current Validation behavior.
It must not reintroduce removed transient Task states, generic Run records, Finding severity, Validation phase status, Candidate Publication history, Acceptance Context version history, or a durable Follow-up lifecycle.

Planning Submission remains after lifecycle simplification, broader codebase simplification, and broad verification portfolio closure.
No Slice 3 or Slice 4 Task may be created from the preserved detail below until the refreshed design is approved.

This plan is not current product behavior or implementation authority.
`CONTEXT-MAP.md` identifies the contexts that own resolved domain language.
`docs/architecture.md`, accepted ADRs, executable sources, and SQLite Tasks remain authoritative for implemented behavior.

## Outcome

But Why must validate a Task proposal against repository evidence and approved planning policy before implementation starts.
`by task submit <task-id>` must be the only operation that moves a New Task to Todo.
The operation must give an agent a trustworthy result without requiring a separate human-only approval command.

Task Submission must remain Task-based.
The first version must not add Plan, Epic, Initiative, or generic Run concepts.

## Design principles

- Planning and Validation must share infrastructure when they have the same mechanism.
- Planning and Validation must retain separate domain ownership when their lifecycle meaning differs.
- A Planning Run belongs to a Task.
- A Validation Run belongs to a Change.
- A Planning Finding belongs to a Planning Run.
- A Finding belongs to a Validation Run.
- A material planning problem is a Planning Finding.
- A material validation problem is a Finding.
- A non-blocking suggestion is neither a Planning Finding nor a Finding.
- The design must compare each Planning behavior with the corresponding Validation behavior before it introduces a difference.
- Planning Review must treat deletion or no code change as a valid complete result when that is the smallest result that satisfies current intent.
- The first implementation must prefer a small complete path over speculative flexibility.

## Task Submission and approval

`by task submit <task-id>` is the public Task Submission command.
The command invocation supplies the operator authority to approve the submitted Task proposal if Planning Review passes.
A separate `by task approve` command must not remain.

Task Submission must accept a New Task.
Task Submission may accept a Todo Task when its prior Task Approval needs revalidation.
A configuration change alone must not invalidate Task Approval.
Explicit Todo resubmission under a different policy must replace the old approval only after preflight succeeds.
A matching passed Planning Run must keep or return the Task to Todo.
A matching Finding-blocked Planning Run must return its Findings and move the Task to New.
Otherwise, Task Submission must move the Task to New atomically with new Planning Run creation.
A clean Planning Review must create Task Approval and move the Task to Todo.
Planning Findings or Planning Tooling Failure must leave the Task New.

An unfinished prerequisite must not reject Task Submission by itself.
Planning Review may report a Planning Finding when an unfinished or underspecified prerequisite prevents trustworthy planning.
Change Start must continue to require every prerequisite to be Done.

## Planning result

The Planning Reviewer must return one Findings array.
An empty Findings array means that the reviewed Task proposal is ready for implementation.
A non-empty Findings array means that the reviewed Task proposal is not ready for implementation.
But Why must not require a mutually exclusive top-level result such as `needs_revision`, `needs_spike`, or `cancel`.

One review may report multiple independent Planning Findings.
A Planning Finding may require Task revision, decomposition, a Spike, or cancellation.
But Why must not assign a required `kind` to a Planning Finding in the first version.
The Finding description must explain the required resolution.

A Planning Reviewer may conclude that the Task should not be done.
The reviewer must not cancel the Task.
The planning agent must present the Finding, and the operator must explicitly run `by task cancel`.
A cancellation reason should reference the applicable Planning Run or Planning Finding.

## Planning Finding materiality

A Planning Finding must identify a material problem that can do at least one of the following:

- Change the observable outcome or acceptance boundary.
- Make the Task infeasible or unsafe.
- Place behavior in the wrong owner or Task.
- Hide a required Task Dependency.
- Prevent the verification seam from proving the requested outcome.
- Conflict with repository evidence or authoritative external evidence.
- Duplicate or contradict existing work.
- Leave a consequential assumption unsupported.
- Preserve or create a durable representation of a retired concept without an accepted current boundary.
- Require durable evidence whose only purpose is to prove that a retired concept is absent.

When a Task proposal retires a concept, the Planning Reviewer must apply the repository current-system invariant.
The proposal and its Task Verification Contract must identify the retired concept, its replacement, affected repository surfaces, targeted search scope, and each accepted exception.
The contract must classify evidence as durable current-behavior evidence or one-time removal evidence.

A Planning Reviewer must not report a Finding only because the Task lacks file-by-file implementation steps.
A Planning Reviewer must not report a Finding for a local reversible choice.
A Planning Reviewer must not report a Finding for an optional refinement, style preference, or speculative future requirement.
A Planning Reviewer must not report a Finding for information that implementation can safely discover without changing an agreed boundary.

## Reviewer Finding contract

Every reviewer Finding is blocking.
Reviewer Findings must not have a severity classification.
This rule applies to Planning Review, Acceptance Review, and Specialist Review.

Planning and Validation must share one core reviewer Finding codec.
The core codec fields are:

- `title`: a short problem name.
- `description`: the material problem and required correction.
- `evidence`: the concrete facts that support the Finding.
- `files`: repository-relative paths that support or locate the Finding.

`files` must be present and may be empty.
`evidence` may cite repository files, stored Artifacts, or authoritative external sources.
When evidence uses an external source, the evidence must state the relevant fact and its URL.

The Validation reviewer Finding codec must extend the core codec with required `artifactRefs` because reviewers use Check and Prepare Artifacts as durable evidence.
The Planning reviewer Finding codec must use the core codec without `artifactRefs` in the first version because Planning Review has no equivalent Check evidence.
Planning Run inspection may still expose operational Artifacts.

## Planning evidence and Spikes

The Planning Reviewer may inspect:

- The Planning Proposal Snapshot.
- The exact Planning Base.
- Repository code, tests, and current executable behavior.
- Installed dependency versions and source.
- Authoritative external documentation.
- Bounded online research.
- Existing experiments and Spikes.

Planning Review must not disable online access by policy.

If repository and external evidence establish a material conflict or correction with high confidence, the Planning Reviewer must report it as a Planning Finding.
If available evidence cannot resolve a consequential uncertainty or conflict, the Planning Reviewer must report a Planning Finding that requires a Spike.

A Spike request must state a falsifiable hypothesis.
A Spike request must identify the real system seam to test.
A Spike request must state the evidence that would support or refute the hypothesis.
A Spike request must propose the smallest experiment that can resolve the uncertainty.
One Planning Run may request multiple independent Spikes.

A Spike is a bounded experiment performed outside Task Submission.
The first version must not add a Spike CLI, Task type, or persisted Spike record.
The planning agent may delegate or perform the experiment.
The operator must revise the Task through the supported Task Context workflow with the accepted result.

## Planning Proposal Snapshot

Task Submission must create one immutable Planning Proposal Snapshot.
The snapshot must contain:

- The submitted Task Context.
- The direct Task Dependency edges.
- The exact IDs, states, and Task Context supplied for direct prerequisites.
- The exact IDs, states, and Task Context supplied for direct dependents.

The first version must not inject every repository Task into the reviewer prompt.
The reviewer may inspect another Task when specific evidence makes that Task relevant.

The Task must remain New while its first Planning Run executes.
Before Task Approval, But Why must atomically verify every stored Planning Proposal Snapshot field.
The comparison must include Task Context, dependency edges, and each supplied related Task ID, state, and Task Context.
If any field changed, But Why must preserve the historical Planning Run, return a stale-submission result, and leave the Task New.

A later change to related Task evidence must not automatically invalidate an existing Task Approval in the first version.
Post-approval Task and repository drift remains a deferred design question except for the explicit Planning Base ancestry rule.

## Planning Base

Planning Review must use the local default-branch HEAD from the canonical main checkout as its Planning Base.
Task Submission must not use a remote-only branch or the caller's arbitrary HEAD.
Task Context remains SQLite state and must be supplied separately from the Planning Base.

Task Submission must reject a dirty default-branch checkout.
Task Submission must not commit, discard, stash, reset, or otherwise repair dirty state.
Unpushed commits on the local default branch may form the Planning Base.

A Planning Run must record the exact Planning Base commit and tree SHA.
A Planning Workspace must reproduce that exact commit.

Change Start must verify that the reviewed Planning Base is an ancestor of the fetched Change Base.
If the ancestry check fails, Change Start must reject only that start operation.
The Task must remain Todo until the operator explicitly runs Task Submission again.

Explicit resubmission of a Todo Task with an invalid Planning Base must return the Task to New while the new Planning Run executes.
A passing Planning Run must return the Task to Todo.
Planning Findings or Planning Tooling Failure must leave the Task New.

If the reviewed Planning Base remains an ancestor of the fetched Change Base, Change Start must accept the stored Task Approval.
Ordinary default-branch advancement must not automatically invalidate every approved Task.
Tree-equivalent recovery after rewritten history is deferred.

## Planning policy and configuration

Every Task Approval must come from a completed Planning Review.
Task Submission may reuse an eligible completed Planning Run instead of executing another reviewer turn.
Configuration must not provide a bypass that directly approves a Task.

Planning Review may select a dedicated Agent Profile.
The Planning Reviewer Agent Profile must resolve from Repo Config, then Global Config, then the Global default Agent Profile.
Missing or unusable reviewer configuration must reject Task Submission before a Planning Run starts.

Planning Reviewer instructions must resolve from Repo Config, then Global Config, then the built-in planning instructions.
A configured `instructionsFile` must replace the built-in planning judgment policy.
But Why must continue to own the protocol envelope:

- The exact Planning Proposal Snapshot.
- The Findings output contract.
- Planning Workspace integrity and cleanup.
- The prohibition on direct Task mutation.
- Planning Tooling Failure handling.
- The atomic Task state transition.

The user may intentionally configure a judgment policy that always returns no Findings.
But Why must not treat that configured policy as a protocol failure.

The proposed configuration keys are:

```json
{
  "review": {
    "planning": {
      "agentProfile": { "scope": "global", "name": "reviewer" },
      "instructionsFile": "review/planning.md"
    }
  }
}
```

Repo Config paths must resolve from the repository root.
Global Config paths must resolve from the Global Config directory.
A missing or unreadable instructions file must reject Task Submission before reviewer execution.

A Planning Policy Snapshot must contain the resolved Repository Preparation policy, reviewer instructions, Agent Profile, Agent Environment, and output contract.
Later configuration changes must not mutate historical Planning Runs.
Planning Run reuse must require an exact Planning Policy Snapshot match.

## Preflight and Planning Run creation

Task Submission must finish deterministic preflight before it creates a Planning Run.
Preflight must:

1. Validate the command input and Task lifecycle state.
2. Acquire the per-Task execution lock.
3. Reject dirty default-branch state.
4. Resolve the Planning Base.
5. Resolve the Planning Proposal Snapshot.
6. Resolve and validate the Planning Policy Snapshot.
7. Check for an Active Planning Run.
8. Check for a reusable completed Planning Run.

A preflight rejection must not create a Planning Run or Planning Tooling Failure.
A preflight rejection during Todo resubmission must preserve the existing Task Approval and Todo state.
A failure after Planning Run creation that prevents trustworthy judgment must become a Planning Tooling Failure.

## Planning Workspace and Repository Preparation

Each new Planning Run must create one disposable Planning Workspace just in time.
Planning must not create a persistent Task Worktree.

The implementation should extract generic disposable repository workspace mechanics from Validation Workspace creation.
The shared mechanics include temporary refs, Sandcastle worktrees, exact-HEAD verification, scoped execution, interruption, and cleanup.
Planning Workspace and Validation Workspace must remain separate domain concepts.

Each new Planning Run must execute configured Repository Preparation through the shared Repository Preparation runner.
A reused Planning Run must return before Planning Workspace creation and Repository Preparation.

Planning Review must not execute configured repository Checks as a fixed gate.
The reviewer may run focused existing tests or commands when they resolve a specific planning question.
A larger prototype or experiment must become a Spike request.

## Planning Run reuse

Task Submission must reuse a completed Planning Run only when:

- The Planning Proposal Snapshot matches exactly.
- The Planning Policy Snapshot matches exactly.
- The recorded Planning Base is an ancestor of the current local default-branch HEAD.
- The outcome is passed or blocked by Planning Findings.

A reused result must return before workspace creation, Repository Preparation, or reviewer execution.
An unchanged Finding-blocked Planning Run must return the stored Planning Findings.
The operator must change the Task proposal to obtain a new review under the same policy and Planning Base.

A Planning Tooling Failure must permit a new Planning Run.
A changed policy must create a new Planning Run.
A recorded Planning Base that is not an ancestor of the current local default-branch HEAD must require a new Planning Run.
Change Start must separately compare the reviewed Planning Base with the exact fetched Change Base.

Validation Run reuse intentionally differs.
Validation must reuse only a passed Validation Run.
An unchanged Candidate with Findings must receive a new Validation Run because Checks, dependencies, services, and reviewer evidence can change between executions.

## Reviewer Session

One Planning Reviewer Session must belong to one Task and Planning Reviewer Session Identity.
The session must continue across Task Submission attempts and disposable Planning Workspaces when its identity remains valid.
Planning Reviewer Session Identity must contain the Task ID, fixed Planning Reviewer producer, resolved Agent Profile, reviewer instructions, Agent Environment, and configured extensions, skills, and tools.
Planning Base, Planning Proposal Snapshot, and Planning Run identity must not affect session continuity.

Each new Planning Run must review the complete current Planning Proposal Snapshot.
A continued reviewer must re-anchor to the exact current proposal and Planning Base.
A continued reviewer must recheck previous Planning Findings but must not limit review to those Findings.
A continued reviewer may reuse prior repository orientation unless current evidence requires more exploration.

Previous Planning Findings are historical evidence.
Planning Findings must not have a mutable resolved flag.
The latest valid Planning Run supplies the current Findings.
A clean report creates Task Approval.

If a Reviewer Session cannot continue safely, But Why may restart it.
The Planning Run must record the restart reason.
Planning Tooling Failure must not erase Reviewer Session history.
Task cancellation must preserve Planning Run and Reviewer Session history.

## Active Run ownership, concurrency, and abandonment

Task Submission must use the execution-ownership primitive established for Validation after BY-54 lands.
The implementation must share lock and lifecycle infrastructure without introducing a generic Run domain concept.

A dedicated per-Task SQLite execution lock must cover the complete Task Submission operation.
Starting a Planning Run must atomically record the sole Active Planning Run relation for its Task.
Persistence must reject a second Active Planning Run even outside ordinary orchestration.
A concurrent Task Submission must fail promptly and must not create Planning Run evidence.

Normal completion must remove the Active Planning Run relation atomically with the Planning Run outcome.
Process termination must release the execution lock but must leave the Active Planning Run relation durable.
A later Task Submission must report the exact Active Planning Run and must not infer that recovery is safe.

`by planning-run abandon <planning-run-id> --reason <reason>` must mirror Validation Run Abandonment.
The operation must:

- Acquire the same per-Task execution lock.
- Require the operator to have stopped every process from the Planning Run.
- Record a Planning Tooling Failure with the operator reason.
- Handle the exact Planning Workspace and temporary ref.
- Complete the Planning Run as tooling-failed.
- Remove the Active Planning Run relation.
- Leave the Task New.

Planning Run Abandonment must not inspect PIDs, infer liveness, deliver signals, or terminate processes.
A cleanup failure must remain visible and must prevent the operation from claiming complete recovery.
Repeated or concurrent abandonment must return the existing terminal fact without corrupting state.

Validation and Planning cancellation must follow the same rule.
Cancellation must acquire the applicable owner execution lock.
If Submission still owns the lock, cancellation must return an in-progress result.
If an interrupted Active Planning Run remains, Task cancellation must require Planning Run Abandonment first.
If an interrupted Active Validation Run remains, Change or linked-Task cancellation must require Validation Run Abandonment first.
Cancellation must never abandon a Planning Run or Validation Run silently.

## Planning Tooling Failure

Shared execution failures should use common error kinds and serialization helpers when their mechanisms match.
Examples include Git, Sandcastle, Repository Preparation, agent execution, output-contract, token-usage, workspace, and cleanup failures.

Lifecycle records must remain owner-specific.
A Validation Tooling Failure belongs to a Validation Run.
A Planning Tooling Failure belongs to a Planning Run.
The implementation must not introduce a generic persisted Tooling Failure that requires a generic Run owner.

Planning-specific workspace fields and Validation-specific Candidate fields must remain in their applicable records.
Shared adapters may map common execution errors into the applicable owner-specific record.

## Approved Task revision

The existing Task Context draft workflow must remain the supported editing path:

```text
by task context draft <task-id>
# edit the draft
by task context apply <task-id>
```

Applying an identical draft must be a no-op and must preserve Task Approval.
Applying a changed draft to a Todo Task must not mutate the Task on the first command.
The command must return a structured confirmation-required result.
The result must show that Task Approval will become invalid, that the Task will return to New, and which exact command confirms the change.

The confirmation must be bound to the current approved Task Context, proposed draft, and dependency edges by digest or equivalent exact identity.
A confirmed apply must atomically:

- Apply the exact draft.
- Move the Task from Todo to New.
- Invalidate the previous Task Approval.
- Remove the Task Context Draft.
- Return `by task submit <task-id>` as the next command.

Task Comment and Task Dependency changes to a Todo Task must use the same confirmation principle.
The design must not add a separate `by task revise` command.

After Change Start, Task Context, Task Comments, and Task Dependencies must remain immutable through these commands.
Implementation Blocker Resolution must remain the supported path for accepted intent changes during implementation.

## Inspection surface

The first complete Planning Gate must provide:

- `by task submit <task-id>`.
- `by task show <task-id>`.
- `by task findings <task-id>`.
- `by task planning-runs <task-id>`.
- `by planning-run show <planning-run-id>`.
- `by planning-run artifact <planning-run-id> <artifact-ref>`.
- `by planning-run abandon <planning-run-id> --reason <reason>`.

`by task show` must include the current Planning Run identity, outcome, Finding count, approval validity, and applicable next command.
`by task findings` must expose the current Planning Findings and an explicit empty state.
`by task planning-runs` must expose compact complete Planning Run History.
`by planning-run show` must expose the proposal, policy, rounds, Findings, Tooling Failures, cleanup, and stored Artifact metadata.
`by planning-run artifact` must expand one exact stored Artifact.

All commands must follow the agent-first structured output policy in `docs/cli-output.md`.
Errors must include an actionable command when recovery is possible.

## Boundaries and dependencies

BY-54, `Enforce one Active Validation Run per Change`, is Done.
It establishes the reusable SQLite execution-lock primitive, durable active-run relation pattern, and accepted Validation cancellation interaction that Task Submission execution ownership requires.

`src/task/` must own Task Submission, Planning Runs, Planning Findings, Task Approval, and their persistence ports.
CLI modules must route commands and translate results without coordinating persistence.
Shared adapters must remain under their established owners in `src/agent/`, `src/repositoryPreparation/`, `src/sqlite/`, and the extracted repository-workspace seam.
Slice 3 must add the next ordered SQLite migration and must verify upgrade from the previous schema.

Task Submission may share these mechanisms:

- SQLite execution-lock infrastructure.
- Disposable Sandcastle workspace infrastructure.
- Repository Preparation execution.
- Agent Profile and Agent Environment resolution.
- Reviewer output decoding primitives.
- Tooling error kinds and serialization helpers.
- Artifact storage and inspection infrastructure.

Task Submission must not share these domain owners:

- Planning Run and Validation Run.
- Planning Finding and Finding ownership.
- Planning Policy Snapshot and Validation Policy Snapshot.
- Planning Workspace and Validation Workspace.
- Planning Tooling Failure and Validation Tooling Failure.
- Task Approval and Candidate validation outcome.

## Iterative implementation sequence

The implementation should use a small number of end-to-end slices.
Do not create every possible follow-up Task before implementation evidence exists.
Create only the next implementable Task, complete it, dogfood it, and then refine the next slice.

### Slice 1: Safe Validation execution ownership

Existing Task: BY-54.

Observable capability:
One Change has at most one Active Validation Run, and an operator can recover an interrupted Validation Run explicitly.

Primary seam:
Run concurrent real `by change submit` processes, interrupt the owner, inspect the durable Active Validation Run, and recover through `by validation-run abandon`.

BY-54 is Done and establishes the execution-lock and active-run primitives that Planning needs.

### Slice 2: One shared reviewer Finding contract

Task: BY-83.

Observable capability:
Acceptance and Specialist Review return only material blocking Findings without severity classifications.

Primary seam:
Run Change Submission with reviewer output that contains the supported fields and inspect the persisted Finding through the CLI.

Required behavior:

- Remove `severity` from reviewer prompts and output decoding.
- Preserve `title`, `description`, `evidence`, `files`, and Validation `artifactRefs`.
- Leave any legacy nullable severity storage unused by new reviewer output.
- Omit severity from current CLI Finding views.
- Keep all Findings blocking.
- Keep Artifact reference validation and expansion.

This slice gives Planning a smaller shared contract without making Planning implementation responsible for migrating Validation behavior.

### Slice 3: End-to-end Task Submission

Observable capability:
An operator can submit one New Task for Planning Review and receive either a Todo Task or durable Planning Findings.

Primary seam:
Run `by task submit` against a real repository, inspect the Task and Planning Run, and repeat the command to prove result reuse.

Observable variations must also prove:

- A Finding-blocked result and unchanged Finding reuse.
- Planning Tooling Failure and retry.
- Concurrent Task Submission rejection.
- Interrupted Planning Run inspection and Abandonment.
- Concurrent Planning Proposal Snapshot mutation and stale-submission rejection.
- Task cancellation rejection while Planning execution or recovery remains active.

The Task Verification Contract must address the Material Risk that Task Context or dependency facts change after submission or approval.
It must require evidence that Task Approval binds the exact Planning Proposal Snapshot and that concurrent mutation cannot create approval.
Planning Review must also enforce the repository current-system invariant and its evidence-lifecycle requirements when the proposal retires a concept.
Until Slice 4 provides confirmed approved-Task revision, the slice must reject mutation of approved Task intent.

This slice owns:

- Planning preflight and configuration.
- Planning Proposal Snapshot and Planning Base.
- Planning Policy Snapshot.
- Planning Workspace and Repository Preparation.
- Planning Reviewer Session.
- Planning Run, Planning Findings, Planning Tooling Failures, and Artifacts.
- Active Planning Run ownership and Abandonment.
- Atomic Task Approval.
- Removal of direct Task Approval.
- Planning Run reuse.
- Cancellation interaction.
- Complete initial inspection commands.

This slice is broad across files but narrow in observable capability.
Splitting its internal layers would leave unsupported partial Planning behavior.

### Slice 4: Safe approved-Task revision and Change Start validity

Observable capability:
An operator can revise a Todo Task with explicit confirmation, resubmit it, and start a Change only from a valid Task Approval.

Primary seam:
Approve a Task through Task Submission, propose a changed Task Context, confirm invalidation, resubmit it, and start a Change against a fetched descendant of the reviewed Planning Base.

Observable variations must also prove:

- Identical Task Context apply as a no-op.
- Confirmed revision that removes or supersedes an over-specified accepted requirement.
- Task Comment confirmation and invalidation.
- Task Dependency confirmation and invalidation.
- Rejection of every intent edit after Change Start.
- Change Start rejection when the Planning Base is not an ancestor of the fetched Change Base.
- Explicit Todo resubmission and each pass, Finding, and tooling-failure result after invalid ancestry.

The Task Verification Contract must require evidence that confirmed revision invalidates the exact prior Task Approval.
It must also require evidence that a revision can explicitly supersede prior accepted intent and that Change Start captures only the newly approved intent.

This slice owns:

- Digest-bound confirmation for Task Context changes.
- Equivalent confirmation for Task Comments and Task Dependencies.
- Todo-to-New invalidation.
- Rejection after Change Start.
- Planning Base ancestry verification at Change Start.
- Explicit resubmission after invalid ancestry.

Before this slice lands, approved Tasks must remain immutable rather than permit silent approval invalidation.

## Task creation policy

Do not create one Task per module, command, migration, or test group.
The four slices above are the maximum initial decomposition.
BY-54 already owns Slice 1.

The approved high-level sequence is:

1. BY-54 remains the completed owner of Validation cancellation behavior and the shared execution lock.
2. Complete BY-83 as Slice 2 before the verification portfolio migration.
3. Complete the verification portfolio migration and closure.
4. Complete the codebase simplification audit and each approved shared-foundation simplification that Planning would otherwise consume.
5. Create Slice 3 only after BY-54 and BY-83 are Done and the preceding program work is complete.
6. Create Slice 4 only after Slice 3 is Done and has been dogfooded.
7. Split a slice only when new evidence establishes an independently useful capability or a real blocker.

Sequence does not create a Task Dependency by itself.
Record a dependency only when the later Task cannot be implemented or verified before the prerequisite is Done.
Slice 3 has a real dependency on BY-54 because it consumes BY-54's execution-ownership primitive.
Slice 3 must depend on Slice 2 because it consumes the shared reviewer Finding contract.
Slice 4 must depend on Slice 3 because it revises Task Approval created by Task Submission.

## ADR disposition

ADR 0005 retains ownership of named Task lifecycle operations.
The accepted ADR now defines Task Submission as the approval operation and Task Approval as conditional on its exact reviewed proposal, planning policy, and Planning Base.

## Deferred questions

These questions are outside the first implementation sequence.
Move them to `docs/open-questions.md` after that file's current ownership work is complete.
Do not create implementation Tasks for these questions until evidence and an accepted decision establish work.

### Repository drift after Task Approval

How should repository changes between successful Task Submission and Change Start affect Task Approval beyond the accepted ancestry rule?
Should tree-equivalent history repair preserve approval after a force-push?

### Related Task discovery

Should Planning Review discover related Tasks beyond direct dependency edges?
If so, which bounded search and typed relationship model prevents prompt growth and false dependencies?
The search must include Done and Cancelled Tasks because they contain implementation and failed-approach evidence.

### Conditional Validation Reviewers

Should Specialist Review selection depend on changed paths, Task metadata, or other evidence?
How can conditional selection remain inspectable in the Validation Policy Snapshot?

### Planning observability

Which measurements justify their storage cost?
Candidate measurements include review duration, token use, attempts per Task, Spike frequency, and later issues that Planning Review did or did not detect.
Workspace creation and Repository Preparation duration belong to this question.

## Approval

The operator previously approved the detailed lifecycle design, ownership boundaries, and four-slice sequence preserved in this file.
The later lifecycle and evidence review superseded approval to create Tasks from that detail without refresh.
The planning capability remains accepted, but its complete current target and implementation slices are unapproved.
Exact configuration, lifecycle, evidence, and persistence choices require renewed operator review.
Deferred questions remain unapproved and outside implementation.
The applicable SQLite Tasks must eventually own implementation requirements.
Remove this working plan after refreshed Tasks and current architecture contain every accepted requirement and each deferred question has an authoritative disposition.
