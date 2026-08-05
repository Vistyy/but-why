---
status: requires-refresh-before-task-creation
artifact_kind: working-plan
remove_when: the refreshed strategy is recorded in VERIFICATION.md, every approved migration slice is complete, obsolete evidence is removed, and all deferred product decisions have authoritative dispositions
---

# Verification portfolio redesign

> Non-authoritative working plan.
> The previously approved detailed portfolio and 14-slot migration sequence are stale because lifecycle, evidence, and module ownership are under active simplification.
> Version control preserves the prior design.
> Do not create portfolio migration Tasks from this file until the operator approves a refreshed complete design.

## Outcome

But Why needs a risk-driven verification portfolio that provides sufficient confidence at justified execution and maintenance cost.
The portfolio must test supported outcomes through their owning seams instead of preserving current implementation choreography, duplicated state, filenames, or test categories.

## Current planning relationship

SQLite Task Context and Task state record accepted simplification work and its implementation status.
Current contexts, ADRs, executable sources, and Task Contexts define the supported product seams.

The current root `VERIFICATION.md` intentionally contains only recurring But Why Material Risks and project-specific evidence constraints that affect work across Tasks.
Commands, configuration, product behavior, temporary migration details, and generic verification guidance remain in their existing authorities.
The complete portfolio must not enter that file until its refreshed strategy is approved.

The portfolio design must be refreshed early so simplification Tasks can use proportionate focused evidence.
Broad portfolio migration must occur after important lifecycle and codebase ownership seams stabilize.
This split replaces the previous requirement to migrate the broad portfolio before product simplification.

## Accepted verification principles

A Material Risk must be plausible, consequential, and supported by accepted requirements or concrete repository evidence.
A Verification Claim must state the smallest fact needed to address one Material Risk.
Verification Evidence must observe that claim at the cheapest reliable supported seam.
A test is not required by default.
An existing test does not earn retention because it exists or exercises supported code.
A removed concept requires targeted one-time removal evidence rather than durable tests that preserve retired vocabulary.

Use real SQLite, Git, filesystem, process, package, or remote behavior only when that integration is part of the claim.
Use captured Adapters or in-process supported interfaces for variations that do not require the real dependency.
Keep the smallest number of system sentinels that observe consequential end-to-end integration.
Do not use test count, coverage percentage, file suffix, or a generic `boundary` category as evidence ownership.
Do not add numerical risk scores or universal provenance guarantees.
Do not convert uncertain external or tooling facts into false success.

The stability target remains zero known intermittent failures in retained blocking evidence.
Current worker limits and Git-common-directory capacity locks remain temporary operational controls until the refreshed portfolio proves they can be removed.

## Protected product outcomes

The refreshed portfolio must begin from these accepted outcomes:

1. Approved human intent remains identifiable.
2. Validation applies to the exact Candidate reported as passed.
3. External mutations target the expected repository, branch, pull request, and commit.
4. Concurrent operations cannot corrupt durable state.
5. Destructive cleanup cannot silently lose unique work.
6. Only authoritative terminal facts complete or cancel work.

The review must not derive additional product constraints only to make testing easier.

## Capability map requiring refresh

The refreshed portfolio must cover the supported system after accepted simplification:

1. Task intent, approval, dependencies, and terminal lifecycle.
2. Change implementation activity, Blockers, Decisions, Candidates, and Managed Worktrees.
3. Validation execution, exact evidence, reviewer continuity, judgment, and recovery.
4. Current publication evidence, iterative pull-request updates, reconciliation, cleanup, and terminal completion.
5. Shared Repository State, migrations, explicit snapshots, and persisted-data trust seams.
6. Agent-facing CLI routing, structured output, inspection, and actionable recovery.
7. Repository initialization, configuration, Repository Preparation, handoffs, and Reviewer Agent Runtime behavior.

The map must not treat removed transient Task states, Candidate Publication chronology, Acceptance Context version history, Finding severity, Validation phase status, legacy Implementation Decision content, or permanent Artifact content as supported target behavior.
The unimplemented Task Submission Planning Gate must remain outside the current-system portfolio.

## Known product corrections and simplifications that affect claims

The refreshed design must account for these accepted changes before broad evidence migration:

- Task owns approval and terminal lifecycle while Change owns implementation activity.
- Open Changes allow normal implementation operations by default, while current readiness, publication, blocked activity, and completion are derived validity claims.
- Milestones do not permanently remove capabilities, and operations reject only immediate violations of accepted protected outcomes.
- Generic Task and linked-Task transitions are removed.
- Repository Preparation failure remains actionable evidence but does not block implementation through persisted readiness.
- Missing Managed Worktree recovery reattaches the exact recorded Repository Branch at its current commit without resetting advanced work or guessing a missing branch.
- Each new Validation Run prepares its fresh Validation Workspace, while reused completed passing evidence does not rerun preparation.
- Merged completion compares the exact pull request, Candidate, and head observed by reconciliation with current durable publication in one transaction.
- The same terminal transaction closes the Change and derives and completes its linked Task without repeating the GitHub request.
- Task and Change cancellation commands select the same Change-owned terminal operation, which stores the reason on the Task or taskless Change as applicable.
- Blocked activity derives from an unresolved Implementation Blocker.
- Any open Change may raise one Blocker, authoritative Validation waits for Resolution, and changed Acceptance Context invalidates readiness.
- Fresh passing Validation of the same Candidate already on the pull request does not require artificial republishing.
- Exact merged-Candidate completion closes the Change even when a Blocker remains recorded.
- Acceptance Context current state and Validation Run snapshots remain while the write-only version table is removed.
- Validation Run history remains while Finding severity and phase status are removed.
- Reviewer Session continuity remains mandatory, provider usability classification moves into Reviewer Agent Runtime, and the stored fingerprint remains the only compatibility identity.
- Reviewer Session storage keeps only Change ID, producer, fingerprint, and session reference.
- Duplicate full identity JSON, last Candidate ID, update timestamp, fingerprint index, and related handling are removed.
- Current publication evidence remains while immutable Candidate Publication chronology is removed.
- Submit and reconciliation share owned pull-request fact classification but not lifecycle orchestration.
- Closed-unmerged pull requests permit explicit Submit to validate and reopen the exact owned pull request, while reconciliation only discovers exact merges and retries terminal cleanup.
- Remote Change Branch cleanup uses GraphQL `updateRefs` with pre-read, exact expected commit, and post-error readback rather than Git transport configuration.
- No-Change completion, Acceptance-only No-Change Validation, and their persisted evidence are removed.
- `TaskCompletionKind` and `completion_kind` are removed because Done Task state and linked Change evidence own the only remaining completion path.
- An empty diff produces only `nothing_to_submit`; explicit cancellation owns unnecessary or abandoned work.
- One idempotent terminal cleanup operation serves completion, cancellation, repeated cancellation, and reconciliation.
- Ordinary cleanup preserves dirty or unique local work and changed remote commits.
- Exact-ID `--discard-work` may remove them for one attempt, but remote deletion still compares against the exact commit read for that attempt.
- Terminal cleanup owns Artifact-content deletion and explicit targeted discard.
- Persisted invalid data receives one truthful shared CLI result.
- An explicit immutable SQLite snapshot command replaces Task Archive machinery.

The immutable `0001` through `0012` chain remains, and focused forward migrations should produce the simplified supported schema without discarding Shared Repository State.
Migration evidence must show that supported current facts survive, retired history and fields are removed, and restored transient Task states are rejected rather than mapped to startable work.

## Focused evidence during simplification

During simplification, Change Submit uses `just quality` rather than the complete legacy boundary suite as its blocking Check.
`just full-quality` remains available as a diagnostic migration tool but must not block a Change while it contains known brittle or obsolete evidence.
This direct policy change does not require a separate implementation Task.

Each simplification Task must have a Task Verification Contract before implementation.
The contract must protect only the Material Risks affected by that slice.
The slice must remove obsolete tests with obsolete behavior and add or retain focused evidence through the new supported seam.

Representative focused claims include:

- A terminal Change operation updates only its actual linked Task and does so atomically.
- No empty-diff path can complete a Task without exact merged-Candidate evidence or infer cancellation without operator authority.
- Task inspection reports availability and Change activity without duplicated transient Task state.
- An unresolved Implementation Blocker prevents only operations that would violate accepted authority.
- Validation uses one exact Candidate, policy snapshot, Acceptance Context snapshot, and valid Reviewer Session identity.
- Exact merged-Candidate observation supplies the only merged completion fact.
- Targeted discard cannot affect another Change and ordinary cleanup preserves unique work.
- Malformed consequential persisted data cannot become a valid-looking domain record or an unavailable-storage error.

These examples are not an approved complete claim set.

## Broad portfolio migration

After lifecycle and shared-foundation ownership stabilizes:

1. Refresh the complete capability map.
2. Approve the finite Material Risks and Verification Claims.
3. Assign one primary evidence owner to each claim.
4. Map every retained test and check to one approved claim.
5. Remove evidence with no distinct claim.
6. Consolidate duplicate ownership and move variations to cheaper seams.
7. Remove flaky or disproportionately costly evidence when its claim does not justify durable automation.
8. Retain real integration only where the claim requires it.
9. Measure focused and maintained workflow cost without introducing arbitrary warning thresholds.
10. Remove or explicitly retain temporary worker and capacity controls.
11. Remove the generic `boundary` category unless distinct setup or scheduling still justifies a separate project.
12. Record the accepted current strategy in `VERIFICATION.md`.

## Existing suite warning

Current tests were built around duplicated lifecycle states, broad orchestration, historical records, and implementation-specific seams.
Applying verification terminology to those seams does not make them good evidence owners.
Do not perform a mechanical rename or one-for-one migration.
Simplify product ownership first, retain focused safety evidence, and then redesign the complete maintained suite.

## Planning-gate handoff

Do not start Task Submission implementation from stale portfolio assumptions.
After simplification and broad portfolio closure, refresh the Planning Submission design against Task-owned approval and terminal lifecycle, Change-owned activity, mandatory Reviewer Session continuity, retained Validation history, and removed evidence concepts.
Every new Planning Submission Task must use the accepted verification strategy from its first slice.

## Provisional refresh sequence

1. Complete the minimal-constraint review.
2. Approve the simplified product target and replacement Task graph.
3. Apply approved stale Task dispositions.
4. Implement lifecycle and evidence simplification with focused contracts.
5. Complete broader simplification that changes evidence ownership.
6. Approve the refreshed complete portfolio.
7. Implement broad evidence migration one vertical capability at a time.
8. Close the migration only after every retained check owns a distinct claim and mandatory gates pass.

Sequence does not establish a Task Dependency unless implementation or verification of a later capability requires the earlier completed result.

## Approval state

The operator approved the verification principles, the early-design and later-migration split, and the need to target simplified ownership seams.
The operator has not approved a refreshed complete risk list, claim set, evidence-owner map, sentinel set, cost controls, or migration Task graph.
No verification portfolio Task may be created from this plan until that approval occurs.
