# Active Task reconciliation

Status: Approved as provisional handoff context on 2026-08-01.
The operator has not approved any proposed Task disposition in this plan except the completed cancellation of BY-67.

Remove this plan after every retained requirement and approved disposition is recorded in SQLite Tasks, current documentation, or an accepted ADR, and every superseded Task is cancelled or completed.

## Purpose and authority

This plan preserves the audit of active Tasks while verification portfolio planning continues.
It is not implementation authority and must not override accepted Task Context.
The dedicated reconciliation session must review each proposed disposition with the operator before it mutates a Task.

The verification portfolio remains the current main-session outcome.
Active Task reconciliation is a separate future outcome because it requires Task-specific product decisions and user dialogue.

## Audit scope

The audit compared every active Task with current code, `CONTEXT.md`, `docs/architecture.md`, `docs/cli-output.md`, `docs/tooling.md`, accepted ADRs, current working plans, Task Dependencies, and active Change state.
Three independent domain-group audits covered release and cancellation, lifecycle and runtime, and Validation and CLI Tasks.
Focused tests passed during the read-only audits, but no full repository gate was required for this planning investigation.

The audited active set was BY-11, BY-14, BY-15, BY-22, BY-41, BY-42, BY-53, BY-60, BY-66, BY-67, BY-68, BY-69, BY-70, BY-71, BY-83, BY-86, and BY-87.

## Completed disposition

### BY-67: Strictly decode persisted SQLite structured data

BY-67 was cancelled with operator approval.
Its broad requirement to validate every persisted structured value conflicts with the approved verification portfolio scope.
The approved scope contains only the confirmed malformed Acceptance Context `resolutions` and Candidate Validation Policy Snapshot corrections.
A future portfolio Task must own those two corrections without recreating BY-67's broader requirement.

## Proposed cancellation

### BY-70: Delete Remote Change Branches through GitHub CLI safely

Proposed disposition: cancel after operator review in the dedicated reconciliation session.

BY-7 already delivered exact-head Remote Change Branch deletion.
Current Git `force-with-lease` behavior satisfies the approved PUB-4 claim.
BY-70 requires replacement with GitHub GraphQL, but no current defect, ADR, or approved product requirement establishes a benefit for that provider-specific replacement.
The verification portfolio retains one real bare-remote `force-with-lease` deletion scenario and cheaper rejection evidence.

## Proposed replacement or revision

Current approved Task intent is immutable under the supported workflow.
When a required correction changes accepted intent, the dedicated session must cancel and replace the Task unless a supported revision capability exists by then.

### BY-14: Publish But Why to npm

The publication capability remains required.
The Task cites three historical documentation paths that no longer exist.
Its package-content criterion names only the `but-why` skill, while BY-22 requires both `but-why` and `to-tasks-by`.
Its acceptance criteria and approved comment disagree about whether the Skills CLI bootstrap uses `--copy`.
Do not start BY-14 unchanged.
Reconcile it only after BY-11, BY-22, and BY-87 reach their required terminal states and the bootstrap command is decided.

### BY-22: Ship portable But Why agent skills

The portable two-skill packaging capability remains required.
The repository currently contains only the packaged `but-why` skill, so the missing `to-tasks-by` skill is a real gap.
The accepted requirement to apply a portable TDD policy has no current authority and conflicts with the approved proportionate verification strategy.
A replacement must use approved Task intent, vertical slices, Task Verification Contracts, and proportionate evidence without introducing universal TDD.
The standard Skills CLI installation path must be verified before the replacement is approved.

### BY-60: Hide Reviewer Session usability behind Reviewer Agent Runtime

The provider-classification boundary remains valid.
Acceptance Review currently inspects Sandcastle failure tags and message text.
Specialist Review contains the same abstraction leak, but BY-60 names only Acceptance Review.
A replacement should cover both current reviewer paths and must not absorb the future Planning Reviewer Session owned by the Task Submission planning gate.
BY-60 does not duplicate BY-83 because BY-83 owns the reviewer Finding contract rather than Reviewer Session usability.

### BY-69: Preserve typed impossible-state failures through CLI output

The structured-diagnosis problem remains valid, but the accepted scope is too broad and does not identify exact public error semantics.
A replacement must identify the exact persisted-state cases, public structured error code, recovery fields, and inconsistent Change records it owns.
It must not recreate the cancelled BY-67 scope.
The initial persisted-data cases should be limited to the two approved SRS-2 decoder defects unless another concrete case receives separate approval.
Generic SQL failures, migration failures, ordinary programmer defects, and harmless malformed scalars remain outside that initial scope.

### BY-42: Discard Change work during cancellation

Explicit destructive cleanup remains a coherent capability.
BY-42 duplicates BY-41's cancellation-reason input, persistence, and exposure requirements.
BY-41 should own the reason contract.
A replacement BY-42 should own only explicit discard authorization, persisted cleanup policy, destructive local cleanup, exact-head remote safety, pending cleanup, and reconciliation.
It must remain dependent on the final BY-41 capability.

## Unresolved product decisions

### BY-41: Record cancellation reasons on owned pull requests

Taskless cancellation currently has no operator-supplied reason and stores a hard-coded message.
The Task does not decide whether GitHub records the reason as a pull-request comment, body update, label, or another mechanism.
It also does not define the durable identity used to prevent duplicate records during retries.
Do not start BY-41 until the operator chooses the GitHub representation and idempotency contract.

### BY-53: Preserve Tasks through append-only Task Archives

The recovery capability remains potentially useful and is not superseded.
The Task does not define the result when a SQLite mutation succeeds but the user-state archive append fails.
It also lacks decisions for the canonical user-state path, retention, archive identity, first-mutation semantics, Task Context resolutions, and future Planning Proposal Snapshot and Task Approval data.
BY-53 must not authorize a Shared Repository State reset.
Do not start it until those product decisions are resolved.

## Active Changes and required follow-up

### BY-11: Explain scoped reviewer configuration failures

The observable behavior is implemented and its Change has passed Validation.
Do not cancel or revise the active Change.
After merge and reconciliation, inspect whether obsolete unsupported-runtime types or branches remain and route any current-system cleanup separately.

### BY-86: Select JSON CLI output with a boolean flag

The `--json` behavior is implemented and validated in its active Change.
Do not mutate its accepted Task Context.
After completion, the verification portfolio must explicitly supersede its selector-specific evidence requirement.
Remove durable `--output` and `-o` rejection tests as one-time removal work while retaining generic unknown-option evidence.

### BY-87: Load only selected CLI command implementations

The accepted native ESM Resolution remains aligned.
Do not cancel or supersede the active Change while Validation is running.
Validation must establish successful installed-package Task and Change behavior and complete main-entry reachability, not only absence of immediate loading errors.
The package loading claim justifies package and process evidence, but it does not justify preserving a generic `boundary` test category.

## Tasks currently aligned

### BY-15: Establish post-publication compatibility policy

The Task matches current migration, Shared Repository State, Trusted But Why Executable, and post-publication compatibility boundaries.
Its dependency on BY-14 remains necessary.
A provisional database-reset idea does not supersede the accepted immutable migration policy.

### BY-66: Derive linked Task transitions from Change state

The current Change persistence operation accepts a caller-supplied Task ID and can target a Task unrelated to the Change.
The Task correctly requires deriving the linked Task from durable Change state inside the atomic operation.
Its ownership guard is distinct from the verification portfolio's terminal lifecycle evidence.

### BY-68: Make validation command working directories explicit and consistent

The required working-directory behavior matches current architecture and RP-1.
Current paths pass the applicable directories, but command execution remains split across inconsistent Effect and asynchronous runners.
The Task should retain its current behavior boundary and keep future Planning Workspace preparation outside its scope.

### BY-71: Simplify Change validation orchestration

Current Change Submission duplicates validation-input construction for changed and No-Change Candidates.
Candidate Validation also duplicates Acceptance Review setup.
The Task correctly excludes Task transition ownership, working-directory policy, and reviewer Finding contract changes.
Its future Task Verification Contract must not duplicate portfolio evidence owned by VE, TS, or PUB claims.

### BY-83: Use one material reviewer Finding contract

Current reviewer schemas, prompts, continuation history, persistence, CLI views, and tests still require severity.
The Task matches the current domain rule that every reviewer Finding is blocking and has no severity classification.
It must remove only reviewer Finding severity and must not remove unrelated Prepare or Check severity concepts.
It remains the prerequisite contract for the future Planning Reviewer and the verification portfolio's VE-3 migration.

## Cross-Task constraints

BY-71 owns orchestration simplification, while BY-83 owns reviewer output and persistence contracts.
BY-60 owns provider-specific Reviewer Session usability, while BY-83 owns reviewer Finding structure.
BY-66 owns Change-to-Task identity, while TS-2 owns atomic terminal lifecycle evidence.
BY-68 owns current validation command execution, while the planning gate may later reuse its mechanism without changing current ownership.
BY-69 must remain separate from output selection in BY-86 and serialization ownership in CLI-1 and CLI-2.
BY-42 must not duplicate the reason contract selected for BY-41.

## Dedicated reconciliation session

Start the dedicated session only after the verification portfolio plan is approved.
Provide this plan and `plans/verification-portfolio-redesign.md` as explicit planning context.
Refresh `origin/main` and current Task and Change state before making any disposition.
Re-read each Task Context and its applicable current authority before proposing mutation.
Preserve active Changes and immutable accepted Task Context.
Review one cancellation, replacement, hold, or retained Task with the operator at a time.
Use current-system diff, search, and inspection evidence when a replacement retires accepted vocabulary or durable evidence.

Recommended discussion order:

1. Decide BY-70 cancellation.
2. Resolve BY-22 and then repair BY-14's publication boundary.
3. Resolve BY-41 and narrow BY-42.
4. Replace or narrow BY-60 and BY-69.
5. Resolve BY-53 archive semantics separately from any database-reset decision.
6. Confirm aligned Tasks against repository state immediately before implementation.
7. Reconcile BY-11, BY-86, and BY-87 only after their active Changes reach a terminal state.
