---
status: approved
artifact_kind: working-plan
remove_when: approved portfolio decisions and deferred dispositions are transferred to authoritative artifacts, every migration slice is recorded as an approved Task, and portfolio closure is complete
---

# Verification portfolio redesign

> Non-authoritative working plan.
> This file records the operator-approved verification portfolio plan.
> Agents must use it only when the operator or an active Task explicitly identifies it as planning context.

## Outcome

But Why must have a risk-driven verification portfolio that provides sufficient confidence at justified execution and maintenance cost.
The portfolio must establish approved Verification Claims against durable Material Risks.
It must not use test count or coverage percentage as its design target.
A durable test must exist only when maintained automation at that seam provides justified confidence.

## Authority

Accepted requirements define required behavior.
Repository instructions define mandatory gates.
The root `VERIFICATION.md` will define accepted project verification strategy after the operator approves that strategy.
SQLite Task Context will define each implementation slice and its Task Verification Contract.
Executable code and configuration determine whether a proposed verification mechanism exists.

This working plan does not define current project verification policy.
The operator has approved the complete risks, claims, evidence owners, mechanisms, sentinels, budgets, reconciliation, and migration structure recorded here.
They remain planning context until VP-0 records the strategy in `VERIFICATION.md` and each applicable implementation requirement in a SQLite Task.

## Scope and sequence

The verification portfolio redesign must precede implementation of Task Submission Slice 3.
The work must use this sequence:

1. Complete BY-83 and its shared reviewer Finding contract.
2. Establish the accepted current verification strategy in `VERIFICATION.md`.
3. Design the target verification portfolio from Material Risks and Verification Claims.
4. Obtain operator approval for the target portfolio before using individual existing tests as design precedent.
5. Reconcile the existing checks and tests against the approved target.
6. Split the required migration into independently verifiable implementation Tasks.
7. Implement and dogfood those Tasks.
8. Complete the approved codebase simplification audit and shared-foundation simplifications.
9. Begin Task Submission Slice 3 only after the preceding work is complete.

The planning-gate work must use Task Verification Contracts from its first new implementation Task.
The planning-gate working plan remains a separate artifact because it owns a separate product capability and implementation sequence.

The Implementation Advisor visible pilot is an approved exception to the high-level program order.
Its planning and implementation may proceed before the verification portfolio migration because no portfolio migration Task exists yet.
Complete the Implementation Advisor Change before creating VP-0 so the portfolio baseline can include the resulting supported capability.
This working plan owns the cross-program portfolio update.
The Implementation Advisor Tasks own only the approved implementation slices and their Task Verification Contracts.

## Boundaries

This plan owns the project verification strategy, target verification portfolio, current-portfolio reconciliation, and migration sequence.
It does not own Task Submission behavior, Planning Runs, Planning Findings, or Task Approval.
It does not assume that every current test remains useful.
It does not assume that every approved Verification Claim requires a durable automated test.
It does not treat historical tests as accepted policy.
It does not introduce numerical risk scoring.
It does not add speculative edge cases that lack accepted requirements or concrete project evidence.

Apply the verification skill's sufficiency rule through these project boundaries:

- Check exact identity at the named lifecycle or external-mutation boundary instead of maintaining universal provenance.
- Prefer explicit rejection, recovery, or operator action over automatic repair and supervision.
- Do not add universal provenance graphs, process supervisors, repository registries, runtime migration fingerprints, or environment attestation without concrete evidence.
- Keep unresolved product policy, including Repository Preparation drift, out of Verification Claims until the operator decides the supported behavior.
- Do not weaken a required guarantee only because implementation is difficult.

The term `verification portfolio redesign` identifies this work.
The project term `Validation` continues to identify the Change-owned Validation Gate and its domain records.
Record production-code simplification candidates in the separate [codebase simplification audit](codebase-simplification-audit.md).
Do not implement those candidates through verification-portfolio Tasks.

## Portfolio organization

The portfolio design must use three separate levels:

- A Material Risk states why a plausible failure has a meaningful consequence.
- A capability area locates supported behavior where a Material Risk can occur.
- An implementation slice delivers one independently useful portfolio improvement.

A Material Risk may apply to multiple capability areas.
Do not duplicate a cross-cutting Material Risk for each capability area.
Do not treat a capability area as an implementation slice or evidence owner.

Begin with a coarse map of the complete supported system.
Use that map to prevent capability-by-capability design from leaving gaps or assigning one claim to multiple expensive checks.
After the coarse map is complete, define and reconcile the portfolio one capability area at a time.

Use two groups in the capability map.

The supported workflow capabilities are:

1. Task intent, dependencies, and lifecycle.
2. Change implementation and Candidate selection, including Managed Worktrees, Implementation Blockers, and Candidate capture.
3. Validation execution, evidence, judgment, and recovery.
4. Publication, reconciliation, cleanup, and completion.

The cross-cutting foundations are:

5. Shared Repository State and migrations.
6. Agent-facing CLI and structured output.
7. Repository initialization, configuration, Repository Preparation, and agent execution.

A cross-cutting foundation supports the workflow capabilities.
It does not become a separate end-to-end workflow only because it owns evidence or a mechanism.

The capability map must describe the supported current system.
It must not include the unimplemented Task Submission planning gate.

## Approved cross-cutting Material Risks

The portfolio must address these Material Risks across the applicable capability areas:

1. The system uses the wrong domain object or provenance facts, such as the Task, Change, Candidate, Change Base, policy snapshot, or ownership binding.
   The wrong work can be judged, completed, or published.
2. A failed or incomplete operation is reported or recorded as successful.
   Work can be judged, completed, or published without the required evidence.
3. Concurrency, interruption, or an uncertain external mutation leaves Shared Repository State inconsistent with Git, remote, or workspace facts, or leaves no trustworthy recovery path.
   The system can lose, duplicate, or incorrectly resume work.

Capability-specific Material Risks must add concrete failure consequences that these cross-cutting risks do not express sufficiently.

## Approved capability-specific Material Risks

### Task intent, dependencies, and lifecycle

1. A Task-backed Change starts while a direct Task Dependency is not Done.
   Implementation can rely on behavior that is not available.
2. A Task reaches Done or Cancelled while its linked Change lacks the corresponding authoritative outcome.
   Task Lifecycle can hide unfinished or active work.

### Change implementation and Candidate selection

1. A Change loses its binding to its Repository Branch or Managed Worktree.
   Implementer writes or Candidate capture can use another Change's code lineage.
2. A Blocked Change starts new implementation or Submission before its Implementation Blocker is resolved.
   But Why can advance work under intent that requires an external decision.
3. Validation or publication uses Candidate provenance that differs from the Candidate captured by Submission.
   Validation can approve code different from the code that publication delivers.

### Validation execution, evidence, judgment, and recovery

1. A Validation Run or its run-owned evidence resolves to a different Candidate or Validation Policy Snapshot from the pair selected by Submission.
   But Why can publish or complete a Change using evidence for different code or validation rules.
2. The fixed Validation Gate omits, misorders, or applies the wrong eligibility to a required producer.
   A Candidate can pass without required Prepare, Check, Acceptance Review, or Specialist evidence or judgment.
3. Acceptance or Specialist Review receives the wrong Candidate scope, Acceptance Context, instructions, profile, or resumed-session identity, or invalid producer output is recorded as a judgment.
   A false pass can publish code that violates approved intent, or invalid review output can block valid work.
4. An interrupted or abandoned Validation Run accepts late evidence or a changed outcome, or recovery clears before exact cleanup succeeds.
   But Why can publish from stale evidence, overwrite an abandoned result, or start an unsafe retry.

### Publication, reconciliation, cleanup, and completion

1. Candidate Publication uses the wrong owned GitHub repository, base branch, Remote Change Branch, pull request, or Candidate head.
   A validated Candidate can be delivered to the wrong target or mutate unrelated work.
2. Retry or Reconciliation records success without one unambiguous observation of the owned target and exact Candidate head, including a merged pull request whose head differs from the published Candidate.
   But Why can associate the wrong Candidate with a pull request or close a Change and Task for the wrong merge instead of leaving uncertainty recoverable.
3. Cleanup deletes the recorded Remote Change Branch at a head other than the expected published head.
   Cleanup can destroy later or unrelated remote work.
4. A No-Change Submission receives the wrong outcome for its Change type or lacks stable tracked-tree equality against the exact fetched Change Base.
   A task-backed No-Change can complete without the required Acceptance Review, or a taskless No-Change can close instead of remaining open with `nothing_to_submit`.
   No-Change does not require equality of environments, dependencies, or untracked files.

### Shared Repository State and migrations

1. The main checkout and linked worktrees resolve operational state from different Git common directories, or a persisted Local Repository identity mismatch is accepted.
   But Why can read or mutate another repository's Tasks, Changes, Validation Runs, or Artifacts, or create split state that later operations trust.
2. A migration chain is reordered or rewritten, a populated upgrade loses or mislinks a required fact, or a persisted-value decoder turns malformed consequential data into a valid-looking domain fact.
   Existing databases and new databases can implement different meaning, so But Why can judge, resume, publish, or complete against false history.

### Agent-facing CLI and structured output

1. The process exit status and structured result disagree, or the result omits decision-relevant status or recovery information.
   An agent can treat unfinished work as complete, repeat a completed mutation, or choose unsafe recovery.
2. Stdout contains non-contract text, or TOON, JSON, and error variants no longer represent one result with the same meaning.
   Automation can fail to parse the result or act on diagnostics as if they were the result.
3. Inspection output omits or truncates decision-relevant evidence without truthful limits and exact retrieval guidance or explicit unavailability.
   An agent can make a recovery or judgment decision without knowing that relevant evidence was omitted.
4. Valid command syntax reaches the wrong operation, or invalid syntax reaches a handler or mutation.
   An agent can mutate or inspect the wrong lifecycle object.

### Repository initialization, configuration, Repository Preparation, and agent execution

1. Before publication, the candidate source launcher loads candidate CLI or migration code, operates Shared Repository State itself, or selects a Trusted But Why Executable other than the canonical main-checkout executable.
   Candidate or incompatible code can mutate Shared Repository State.
2. Repo Config and Global Config do not follow documented precedence and path rules, or Validation reuse uses a different resolved policy from the recorded snapshot.
   Preparation, Checks, or reviewers can run with the wrong commands, paths, instructions, Agent Profiles, or resources.
3. Repository Preparation is skipped, uses the wrong operation inputs, runs in the wrong required workspace, or allows failure to produce readiness or a passed Validation Run.
   Implementation or Validation can proceed with an incomplete environment.
4. The selected Agent Profile, role instructions, Agent Environment, or configured local resources resolve or launch incorrectly, or reviewer continuity binds to a different identity.
   The wrong capability, policy, or development environment can implement or review a Change.
The first risk is temporary.
Before publication, `just by` must use the canonical main-checkout executable for real Shared Repository State.
After publication, the installed package will become the trusted executable for normal repository operations.
`just by` will remain a development interface and will not define the normal installed workflow.
When publication changes the supported path, remove the source-checkout risk from `VERIFICATION.md` and establish the accepted published-package compatibility policy.
Do not design that future compatibility policy in this portfolio redesign.

The required behavior when effective Repository Preparation changes between Change Start and Change Submit remains unresolved.

## Approved Verification Claims

### Task intent, dependencies, and lifecycle

**TS-1: Dependency-gated Task-backed Change Start**

A new Task-backed Change Start may create work only when the Task is Todo and every direct Task Dependency is Done.
Otherwise, it must report the blocking dependency facts without creating a Change or advancing the Task.
This claim excludes Task Submission, Planning Proposal Snapshot, and Task Approval behavior.

**TS-2: Authoritative linked-Task terminal states**

A linked Task may reach Done or Cancelled only in the same atomic persistence operation that closes its linked Change.
The owning publication, No-Change, or cancellation workflow must supply the authoritative outcome.
If that workflow supplies no valid outcome, the Task must remain nonterminal.
TS-2 owns the atomic local lifecycle transition and does not own remote observation.

Current code does not satisfy TS-2 when Reconciliation observes a merged pull request whose head differs from the recorded Candidate.
Plan the product correction separately from evidence-portfolio changes, but require both before TS-2 is complete.

### Change implementation and Candidate selection

**CS-1: Change binding at work seams**

Before agent launch or Candidate capture, But Why must verify the recorded Local Repository, Repository Branch, and Managed Worktree binding for the Change.
A mismatch must reject the operation without launching the agent or capturing a Candidate.

Current implementation launch does not reverify the recorded binding before it starts an Interactive Session.
Candidate capture also does not receive the recorded Managed Worktree path needed to verify that binding at the Submit seam.
Plan both product corrections separately from evidence-portfolio changes, but require them before CS-1 is complete.

**CS-2: Blocked Change gate**

After an Implementation Blocker is stored, new implementation and Submission commands must reject.
Implementation Blocker Resolution is the only operation that makes the Change implementable again.
But Why does not claim that it detects or stops an already-running external process.

**CS-3: Exact Candidate identity**

Candidate capture must establish the exact Change, Change Base commit, and Repository Branch head commit.
Validation and Validation Run reuse must use that exact Candidate identity.
A mismatch must reject the operation or enter explicit recovery.
Candidate Publication consumes this identity and owns its separate remote-target checks through PUB-1.

### Validation execution, evidence, judgment, and recovery

**VE-1: Validation Run-rooted evidence**

A Validation Run must identify one exact Candidate and immutable Validation Policy Snapshot.
Findings, Artifacts, Tooling Failures, workspace facts, and review rounds must bind through that Validation Run.
Passed Validation Run reuse must require the same Candidate and policy binding.
VE-1 owns persisted Validation Run binding and reuse, while CFG-1 owns policy resolution.

**VE-2: Fixed Validation Gate**

But Why must run every required validation phase and producer for the Change type in the required order.
An omitted phase, wrong eligibility decision, Finding, or tooling failure must prevent a passed Validation Run.

**VE-3: Reviewer boundary**

Validation orchestration must supply each reviewer with the exact Candidate scope and matching Reviewer Session identity.
For a task-backed Change, it must supply Acceptance Context to Acceptance Review as review authority and to each Specialist Review as an authoritative scope constraint.
Each Specialist Review must also receive its configured concern.
Only structurally valid producer output with resolvable current-Run Artifact references may become review evidence.
VE-3 owns review-evidence and session binding, while AG-1 owns launch configuration.
This claim does not assert that But Why can prove reviewer reasoning or semantic concern adherence.

**VE-4: Validation Run recovery**

At most one Validation Run may be active for a Change.
Validation Run Abandonment must record a tooling failure and clear the active relation only after exact cleanup succeeds.
After completion or abandonment, late work must not append accepted evidence or change the terminal outcome.
This claim does not require But Why to supervise or terminate external processes.

Current persistence does not consistently require a running Validation Run before it records rounds or changes the outcome.
Plan the terminal-state guard separately from evidence-portfolio changes, but require both before VE-4 is complete.

### Publication, reconciliation, cleanup, and completion

**PUB-1: Exact owned publication target**

Candidate Publication must consume the exact Candidate head established by CS-3 and verify the recorded repository, base branch, Remote Change Branch, and owned pull request.
A missing, mismatched, or ambiguous remote-target fact must not produce publication success.
PUB-1 owns remote-target verification and does not redefine Candidate identity.

**PUB-2: Honest publication recovery**

After an uncertain remote mutation, But Why may record publication only when one unambiguous observation matches the owned target and exact Candidate head.
Otherwise, publication must remain unresolved for explicit recovery.
This claim does not require exactly-once remote mutation.

**PUB-3: Exact merged completion**

Reconciliation may supply a merged completion outcome only when the owned pull request observation matches the recorded target and published Candidate head.
Unavailable or mismatched facts must produce no completion outcome or an explicit rejection.
PUB-3 owns the external observation, while TS-2 owns the atomic local lifecycle transition.

**PUB-4: Safe Remote Change Branch cleanup**

Cleanup may delete only the recorded Remote Change Branch at the exact expected published head and must use `force-with-lease` for that head.
A mismatch, unavailable observation, lease failure, or uncertain result must leave cleanup pending.

**PUB-5: Type-directed No-Change**

No-Change requires a stable Candidate head whose tracked tree equals the exact fetched Change Base tree.
A taskless No-Change Submission must return `nothing_to_submit` before Validation and remain open.
A task-backed No-Change Submission must run Acceptance Review and may complete without a pull request only when that review passes.
Tree inequality must forbid a No-Change outcome.
This claim does not require equality of environments, dependencies, or untracked files.

Current Reconciliation can complete a Change when the merged pull request head differs from the published Candidate, so PUB-3 is unmet.
Current publication can use a mutable remote name without rechecking its URL immediately before push, so PUB-1 is not enforced at the irreversible mutation seam.
Current Candidate capture does not make a final head check around its tracked-tree comparison, so concurrent head movement can make PUB-5 describe a different commit.
Plan these product corrections separately from evidence-portfolio changes, but require them before their claims are complete.

### Shared Repository State and migrations

**SRS-1: Canonical Shared Repository State**

Every supported main-checkout or linked-worktree operation must derive Shared Repository State from the same canonical realpath Git common directory.
But Why must initialize or compare the persisted Local Repository identity and reject a mismatch before workflow code uses the state.
This claim does not require repository UUID federation, relocation repair, or worktree repair.

**MIG-1: Safe forward migrations**

Shared Repository State must use one ordered append-only migration chain beginning with `0001_baseline`.
A migration that changes populated data must preserve the required facts and owner links it changes or fail without exposing partial success.
This claim does not require runtime migration checksums or exhaustive semantic round trips.
Databases containing a running Validation Run from before migration `0009` are outside the supported upgrade input.

**SRS-2: Safe persisted-data handling**

Malformed persisted data that affects lifecycle, ownership, policy, or evidence must not become a valid-looking domain fact.
Optional Reviewer Session metadata may invalidate continuity and cause a fresh session instead of failing the workflow.
This claim does not require strict validation of every harmless scalar.

Current decoding can silently omit malformed Acceptance Context `resolutions` and can cast arbitrary JSON into a Candidate Validation Policy Snapshot.
Plan both decoder corrections separately from evidence-portfolio changes, but require them before SRS-2 is complete.

### Agent-facing CLI and structured output

**CLI-1: Truthful command result**

The process exit status and structured result must agree on the command outcome.
The result must provide the decision-relevant status and applicable recovery, next action, or operator handoff.
It must repeat target identity when But Why inferred the target or recovery could affect the wrong object.

**CLI-2: One structured result**

Each invocation must produce one pre-serialization structured result.
TOON and JSON must preserve the same meaning for success, usage-error, and runtime-error outcomes.
Stdout must contain only that result, while progress and logs use stderr.
Byte-identical formats are not required.

**CLI-3: Truthful inspection limits**

When inspection output omits or truncates decision-relevant evidence, it must state the applicable limit or truncation scope.
Retained evidence must have an exact retrieval command, and unavailable evidence must be identified as unavailable.
Evidence does not need to appear inline.

**CLI-4: Correct command routing**

Each supported canonical command form must reach the intended operation with its supplied positional and option values.
Invalid syntax must produce a usage result before a domain mutation runs.
This claim does not require compatibility with undocumented syntax.

The empty-reason branch of Validation Run Abandonment returns a different JSON error shape from normal usage errors, so CLI-2 is currently unmet.
Plan the product correction separately from evidence-portfolio changes, but require it before CLI-2 is complete.

### Repository initialization, configuration, Repository Preparation, and agent execution

**RI-1: Canonical pre-publication launcher**

Before publication, the candidate `bin/by` may only locate and start the canonical main-checkout Trusted But Why Executable.
It must not load candidate CLI or migration code or operate Shared Repository State itself.
If the canonical main checkout or executable is unavailable, the launcher must fail closed.
This claim ends when the installed package becomes the supported executable.

**CFG-1: Deterministic effective policy**

Repo Config and Global Config must resolve through documented precedence and path rules.
Invalid configuration, unresolved role selection, or missing required local resources must reject before the applicable operation runs.
The resolved Validation policy must contain every policy field that execution consumes and must be persisted without changing its meaning.
CFG-1 owns deterministic resolution and snapshot fidelity, while VE-1 owns Validation Run binding and reuse.
This claim does not prove operator intent or use a raw configuration hash as policy evidence.

**RP-1: Repository Preparation in required workspaces**

Repository Preparation must run the resolved command in each required Managed Worktree or Validation Workspace.
A nonzero exit, timeout, execution failure, observation failure, or Candidate-integrity failure must prevent readiness or a passed Validation Run.
This claim does not require environment equality, dependency attestation, or Preparation in the task-backed no-change Acceptance-only path.
It does not decide how Preparation policy changes between Change Start and Change Submit behave.

**AG-1: Agent launch fidelity**

Implementer and reviewer launches must use the resolved role profile, role instructions, Agent Environment, and configured resource allowlists.
Missing required local instructions, extensions, or skills must reject before launch.
AG-1 owns launch configuration, while VE-3 owns Reviewer Session identity and continuity.
This claim does not attest external model behavior or supervise external processes.

The behavior when Repository Preparation policy changes between Change Start and Change Submit remains a separate product decision.

### Cross-cutting claim coverage

The capability-specific Verification Claims collectively address the approved cross-cutting Material Risks.
Do not create separate universal claims that require system-wide provenance, transactional external systems, automatic repair, or maximum prevention.

## Approved target evidence owners

Evidence ownership names the observable seam that establishes a Verification Claim.
A filename suffix, directory, or routine-versus-full suite assignment does not define ownership.
Organize durable evidence by capability and claim.

### Task intent, dependencies, and lifecycle

**TS-1 owner: capability-local Change Start command evidence**

Exercise the in-process public Change Start command with a Task whose direct Dependency is not Done and with a Task whose direct Dependencies are all Done.
Observe command outcome, Task state, Change records, and absence or presence of Change Start side effects.
This evidence does not require real Git or a separate process.
Move the relevant cases out of the generic Managed Worktree boundary grouping.

**TS-2 owner: capability-local real-SQLite lifecycle persistence evidence**

Exercise merged, No-Change, and cancelled linked-Task terminal transitions against real SQLite.
Observe both Change and Task records after success.
Use one representative SQLite abort trigger on the second record update to establish rollback of the first update through the shared immediate transaction.
This evidence requires real SQLite because transaction atomicity is part of the claim, but it does not require remote or process integration.
Use focused captured cancellation-workflow evidence to establish that unavailable, mismatched, or merged pull-request observations do not supply an invalid cancellation outcome.
PUB-3 separately owns evidence that remote observation supplies a valid merged outcome.

Neither TS-1 nor TS-2 requires a system sentinel.

### Change implementation and Candidate selection

**CS-1 owner: capability-local Change binding command evidence**

Exercise the in-process public Implement and Submit command seams with real Git and SQLite facts.
For each recorded Local Repository, Repository Branch, or Managed Worktree mismatch, observe rejection before agent launch, Candidate capture, or related state mutation.
Use a captured agent-launch call and Candidate persistence observations instead of a real agent process.
This owner requires the planned Managed Worktree recheck correction before it can establish the complete claim.

**CS-2 owner: capability-local Implementation Blocker command evidence**

Exercise Blocker storage, Implement, Submit, and Blocker Resolution through their in-process public command seams with real SQLite.
Observe that a stored blocker rejects Implement and Submit without starting their external work.
Observe that Blocker Resolution removes the gate and permits implementation to proceed.
Use captured side-effect calls instead of real agent, Validation, or publication processes.

**CS-3 owner: capability-local Candidate identity submission evidence**

Exercise Submit orchestration with real Git Candidate capture and real SQLite Candidate and Validation Run persistence.
Observe the exact Change, Change Base commit, and Repository Branch head through Candidate capture, Validation input, Validation Run reuse, and the captured Candidate Publication input.
A mismatched identity must reject or start fresh Validation as the applicable workflow requires.
Use reviewer, GitHub, and captured publication Adapters because remote-target behavior belongs to PUB-1.

CS-1 may use multiple scenarios at its two pre-mutation seams while retaining one claim owner.
None of CS-1, CS-2, or CS-3 requires a separate-process system sentinel.
Do not create one file per claim solely to encode ownership.

### Validation execution, evidence, judgment, and recovery

**VE-1 owner: capability-local real-SQLite Validation Run evidence**

Exercise Validation Run persistence against real SQLite.
Observe exact Candidate and policy binding, run-owned Findings, Artifacts, Tooling Failures, workspace facts, review rounds, and passed-Run reuse.
Use temporary Artifact files only when reference resolution is part of the scenario.
CFG-1 separately owns policy resolution.

**VE-2 owner: capability-local Candidate Validation service evidence**

Exercise the in-process Candidate Validation service for each supported Change type.
Observe required phase and producer order, eligibility, stop conditions, and terminal outcome.
Use fake Check commands and reviewer runtimes.
Use the minimal real Git Validation Workspace that the current public service requires, without treating Git workspace creation as part of the claim.

**VE-3 owner: capability-local review-boundary evidence**

Exercise the Acceptance and Specialist review phases with real SQLite and temporary Artifact storage.
Observe exact Candidate scope, Acceptance Context role, configured Specialist concern, Reviewer Session identity, structurally valid output, and current-Run Artifact references.
Observe that every task-backed Specialist receives the exact Acceptance Context while taskless Specialist Review receives none.
Use a fake reviewer runtime and one real persisted session-store composition where continuity is part of the scenario.
AG-1 separately owns launch configuration.
Do not assert model reasoning or semantic concern adherence.

**VE-4 owner: capability-local Validation Run recovery evidence**

Exercise Validation Run Abandonment and terminal write guards against real SQLite.
Observe active-Run uniqueness, cleanup ordering, cleanup failure, abandonment outcome, active-relation clearing, idempotence, and rejection of late evidence or outcome changes.
Use deterministic cleanup for workflow scenarios and retain one focused real-Git cleanup Adapter check only if that Adapter behavior remains distinct.
Do not require external-process termination or supervision.
This owner requires the planned terminal-state correction before it can establish the complete claim.

None of VE-1, VE-2, VE-3, or VE-4 requires a system sentinel.

### Publication, reconciliation, cleanup, and completion

**PUB-1 owner: capability-local Candidate Publication evidence**

Exercise Candidate Publication with real SQLite, a fake GitHub boundary, and one real local Git remote scenario.
Observe exact repository, base branch, Remote Change Branch, Candidate head, and owned pull request facts before publication success.
Observe that publication eligibility uses the exact persisted Validation Policy Snapshot approved by the passed Validation Run.
Use the real local remote to verify the immediate remote-URL binding at the irreversible push seam after the planned correction.
CS-3 separately owns Candidate identity before publication, while CFG-1 and VE-1 own policy resolution, persistence, and reuse.

**PUB-2 owner: capability-local publication recovery evidence**

Exercise Candidate Publication recovery with real SQLite and a stateful fake GitHub boundary.
Observe response loss followed by zero, one exact, or multiple remote observations.
Only one unambiguous exact observation may record publication, while every other case remains explicitly unresolved.
Do not require live GitHub or exactly-once mutation.

**PUB-3 owner: capability-local Change Reconciliation evidence**

Exercise Change Reconciliation with a fake GitHub boundary and captured persistence.
Observe exact owned repository, base branch, Remote Change Branch, merged state, and published Candidate head before the workflow requests merged completion.
TS-2 separately owns the real-SQLite Change and Task transaction.
This owner requires the planned merged-head mismatch correction before it can establish the complete claim.

**PUB-4 owner: capability-local real-Git cleanup evidence**

Exercise public Change cleanup with one real bare Git remote to establish actual `force-with-lease` deletion of the exact Remote Change Branch head.
Use a fake remote Adapter for mismatch, unavailable observation, lease failure, and uncertain-result variations.
Leave cleanup pending in every rejected or uncertain case.
Do not include unrelated local worktree or Repository Branch cleanup in this claim owner.

**PUB-5 owner: capability-local No-Change Submission evidence**

Exercise Change Submit with real Git Candidate capture, a local bare remote, and real SQLite.
Observe stable tracked-tree equality against the exact fetched Change Base, taskless `nothing_to_submit`, and task-backed Acceptance Review before completion.
Use fake Validation and publication boundaries where their separate behavior is not part of the claim.
This owner requires the planned final Candidate-head stability correction before it can establish the complete claim.

None of PUB-1 through PUB-5 requires a full CLI, external-process, or live-GitHub system sentinel.
The narrowly bounded real-Git scenarios belong to their claims and are not broad workflow sentinels.

### Shared Repository State and migrations

**SRS-1 owner: capability-local shared repository-context evidence**

Exercise an in-process Task command from a real Git main checkout and linked worktree with real SQLite.
Observe that both entrypoints resolve the realpathed Git common directory, use only its Shared Repository State, and reject a persisted Local Repository identity mismatch before workflow execution.
Use source inspection of composition loaders to confirm that other workflows consume the same repository-context owner.
Do not add repository federation, relocation repair, or worktree repair.

**MIG-1 owner: capability-local populated real-SQLite upgrade evidence**

Seed a supported pre-upgrade SQLite database with populated Tasks, Changes, owner links, Reviewer Sessions, and published cleanup state.
Acquire repository storage through the normal migration composition and observe preservation through the complete current chain from `0006` through `0010`.
Use no running Validation Run in the pre-`0009` fixture because that input is unsupported.
Observe that the project ledger begins with `0001_baseline`.
Use static review of the migration registry, migration artifacts, and accepted ADR for the append-only policy.
Rely on the pinned Effect SQL Migrator contract for numeric ordering, duplicate-ID rejection, transactional migration effects, and rollback.
Do not add runtime checksums or durable tests that only repeat those library guarantees.

**SRS-2 owner: capability-local real-SQLite decoder evidence**

Insert malformed consequential values through real SQLite and read them through public persistence Adapters.
Observe `RepositoryPersistedDataInvalid` instead of a valid-looking domain record.
Cover malformed Acceptance Context `resolutions` and Candidate Validation policy snapshots after their planned decoder corrections.
A present but malformed Acceptance Context `resolutions` value must not become apparently valid approved intent with missing resolutions.
Arbitrary JSON must not become apparently valid structured Validation policy evidence.
Malformed optional Reviewer Session metadata may invalidate continuity and cause a fresh session without failing the workflow.
Do not add validation for lifecycle values protected by SQLite constraints, non-authoritative Implementation Decisions, or harmless scalars.

None of SRS-1, MIG-1, or SRS-2 requires a system sentinel.

### Agent-facing CLI and structured output

**CLI-1 owner: one real-process command-result sentinel**

Exercise the built `dist/main.js` process through the supported CLI launcher.
Observe OS exit status and the one structured stdout result together for success, usage failure, and one inferred-target runtime failure.
The inferred-target case must repeat the target facts and applicable recovery or operator handoff.
Use an isolated temporary workspace and add real Git or SQLite only for that one target-inference case.

**CLI-2 owner: the same real-process serialization sentinel**

Use the CLI-1 process sentinel to observe one stdout document, stderr-only logging, and process status through the complete output path.
Decode JSON and TOON and compare their semantic values rather than bytes.
Use cheaper serializer and in-process command evidence for format and error variations that do not require OS channels.
This owner requires the planned empty-abandonment-reason usage-shape correction before it can establish the complete claim.

**CLI-3 owner: capability-local inspection evidence**

Exercise public in-process Task, Change, and Validation inspection commands with real SQLite and temporary Artifact files.
Observe every applicable limit or truncation scope, exact detail command, complete retained-evidence retrieval, and explicit unavailable result.
An exact detail command that identifies an Artifact as unavailable satisfies the claim without requiring the inline summary to probe every Artifact.

**CLI-4 owner: capability-local command-tree routing evidence**

Exercise every documented canonical command form through the in-process command tree with captured handlers.
Observe correct operation selection and positional and option value forwarding.
Observe invalid syntax producing a usage result before a captured mutation can run.
Use real SQLite or Git only for a representative pre-mutation observation that a captured handler cannot establish.
Do not protect undocumented syntax.

CLI-1 and CLI-2 share exactly one small real-process system sentinel because OS exit status, stdout, and stderr integration are part of those claims.
Do not multiply process sentinels across commands.
CLI-3 and CLI-4 require no system sentinel.

### Repository initialization, configuration, Repository Preparation, and agent execution

**RI-1 owner: one real-process source-workflow isolation sentinel**

Exercise the Candidate `bin/by` launcher from a real Git linked worktree with real SQLite.
Observe delegation to the canonical main-checkout Trusted But Why Executable, exclusion of Candidate-only CLI and migration code, and use of canonical Shared Repository State.
Observe fail-closed results when the main checkout or Trusted But Why Executable is unavailable.
Keep this sentinel separate from the generic CLI process sentinel because it exercises the temporary source-workflow launcher path.

**CFG-1 owner: capability-local effective-policy snapshot evidence**

Exercise Repo Config and Global Config resolution through Candidate Validation policy persistence and inspection with real SQLite.
Observe documented precedence and paths, role selection, required local resources, every policy field consumed by execution, and preservation of policy meaning in the stored snapshot.
Observe invalid configuration or unresolved required resources rejecting before the applicable operation.
VE-1 separately owns Validation Run binding and reuse.
SRS-2 separately owns malformed persisted-policy rejection.

**RP-1 owner: capability-local Repository Preparation evidence**

Exercise public Change Start and Candidate Validation preparation seams with small real marker commands.
Observe the resolved command and operation inputs in the required Managed Worktree and Validation Workspace.
Observe nonzero exit, timeout, execution failure, observation failure, and Candidate-integrity failure preventing readiness or a passed Validation Run.
Use captured downstream calls to establish that later phases do not start.
Keep task-backed No-Change and unresolved Preparation-policy drift outside this owner.

**AG-1 owner: capability-local agent-launch handoff evidence**

Exercise Implementer and reviewer launch handoffs with captured launch calls and fake agent runtimes.
Observe the resolved Agent Profile, complete role instructions, Agent Environment wrapper, and configured resource flags.
Observe missing required local instructions, extensions, or skills rejecting before launch.
Rely on Sandcastle for its pinned process and session mechanics, but do not attribute But Why profile, prompt, resource, or Candidate identity policy to that library.
VE-3 separately owns Reviewer Session identity and continuity.
Do not run a real model or claim model behavior, OS-level resource enforcement, or process supervision.

RI-1 requires its distinct source-workflow real-process sentinel.
CFG-1, RP-1, and AG-1 require no additional system sentinel.

## Approved target cost policy

The target portfolio has no fixed per-claim, routine-suite, or complete-suite runtime warning threshold.
Remove the current 10-second and 30-second advisory warnings because no identified decision or operator action consumes them.
Do not replace them with percentile tracking, repeated-run protocols, or another performance mechanism without a concrete need.

Measure focused runtime and maintained-workload impact before and after adding or moving expensive evidence.
Use one focused run before and after the change and one run of the applicable maintained blocking workflow.
Record wall time and result without introducing a repeated-run or percentile protocol.
Admit expensive evidence only when it owns a distinct approved claim, the full integration is necessary to observe that claim, the blocking workflow passes, and no known intermittent failure remains.
When measured cost increases and a cheaper reliable seam is available, use the cheaper seam.
When no cheaper seam exists, make the measured cost an explicit operator decision instead of applying a hidden threshold.
The portfolio has no numerical runtime threshold.
Its stability budget is zero known intermittent failures in retained evidence.

Use two Vitest workers as a temporary current-suite control because two serialized complete-test samples passed while two three-worker samples failed.
Retain the Git-common-directory capacity lock temporarily for complete test, coverage, and quality workloads because concurrent complete-test pairs failed with both one and two workers.
Keep focused selections unlocked for concurrent agent work.
Re-evaluate the worker limit and remove the capacity lock after portfolio reconciliation removes the observed contention or makes the broad complete workload unnecessary.
These temporary controls are migration constraints, not accepted permanent evidence mechanisms.

## Known current state

The root `VERIFICATION.md` defines the accepted current verification strategy on `origin/main`.
`docs/tooling.md` defines supported contributor commands and current quality ownership.
The repository provides focused tests, type checking, Biome checks, documentation checks, ast-grep structural checks, Fallow checks, builds, coverage, routine quality, and full quality.

`just quality` runs routine tests, routine static checks, and a build.
Its executable runner currently warns after 10 seconds.
`just full-quality` runs the complete selected test suite with the same blocking static checks and build.
Its executable runner currently warns after 30 seconds.
These warning thresholds are historical advisory mechanisms, not accepted target-portfolio budgets.
They do not change the command outcome, and no identified consumer acts on them.
Fresh complete-test measurements took between 92 and 180 seconds on the current four-CPU host, so the 30-second warning is permanently noisy there.

Complete test, coverage, and quality workloads currently share a Git-common-directory capacity lock.
The lock protects host resource use and suite reliability, not product correctness.
A bounded concurrency experiment found that concurrent complete-test pairs failed with either one or two workers even though they finished sooner than serialized pairs.
Focused selections remain unlocked and can run concurrently.
Two serialized complete-test samples passed with two Vitest workers, while two serialized samples failed with three workers in process-sensitive tests.
Treat the lock and worker limit as temporary current-suite controls.
Re-evaluate and remove them when portfolio reconciliation eliminates the complete-workload contention or makes the broad workload unnecessary.

Vitest currently separates `*.boundary.test.ts` from the routine suite.
The routine suite excludes those files, while the full suite includes them.
This filename category is a historical execution-cost split, not an accepted evidence-ownership concept.
The target portfolio must organize evidence by capability and Verification Claim.
It must retain a real Git, SQLite, filesystem, package, or process seam only when that integration is part of the claim.
It must not preserve or replace the generic `boundary` category only to classify tests as slow.
Use a separate Vitest project or configuration only when a distinct setup, environment, process lifecycle, or scheduling requirement justifies it.
The current configuration disables Vitest isolation and uses at most three workers.

`docs/tooling.md` assigns runtime contracts to behavior tests.
It assigns structured serialization to the CLI output codec.
It assigns package inspection to the package contract test.
It assigns reader-visible command and setup contracts to documentation tests.
It assigns named structural contracts to Fallow and ast-grep.

These facts describe available mechanisms.
They do not yet establish that the current portfolio assigns evidence at the cheapest reliable seam.

## Phase 1: Initialize project verification strategy

Inspect repository instructions, supported gates, test configuration, representative checks, accepted decisions, recurring evidence patterns, important uncovered risks, expensive mechanisms, and known instability.
Separate accepted current policy from historical test structure and proposed improvements.

Propose only current strategy for `VERIFICATION.md`.
The proposal may contain these sections when evidence and operator approval support them:

- Important risks.
- Evidence ownership.
- Supported mechanisms and their limits.
- Mandatory gates.
- System sentinels.
- Measured budgets.

Obtain operator approval before creating `VERIFICATION.md`.
If the operator declines a proposed choice, keep that choice in this plan and leave it out of `VERIFICATION.md`.

This phase is complete when `VERIFICATION.md` states the accepted current strategy and agrees with executable mechanisms.

## Phase 2: Design the target portfolio

Confirm a coarse and complete map of the supported capability areas.
Identify a finite set of cross-cutting and capability-specific Material Risks for that map.
For each capability area, apply the relevant cross-cutting Material Risks and identify its specific Material Risks.
For each Material Risk, define the smallest sufficient set of Verification Claims.
Do not create one Verification Claim per capability area or existing test.
Do not inspect individual existing tests as design precedent before the operator approves the proposed risks and claims.

For each approved Verification Claim, select one primary evidence owner at the cheapest reliable seam.
Use the closest public seam that observes the complete claim.
Use a real end-to-end seam only when integration is part of the claim.
Keep a small number of system sentinels for critical end-to-end paths.
Use lower-cost seams for variations that do not require the complete system.

Define runtime and stability budgets with explicit measurement methods.
Measure a proposed slow test at its focused seam and against the maintained suite before admitting it.
Do not increase a shared timeout to accommodate one slow test.

Obtain operator approval for the target risks, claims, evidence owners, sentinels, and budgets.
Keep unapproved mechanisms and experiments in this plan.

This phase is complete when the approved target is finite, distinct, independent of the current test inventory, and explicit about the cost of expensive evidence.

## Phase 3: Reconcile the current portfolio

Reconcile one approved capability area at a time against the complete portfolio map.
Map each existing check or test to one approved Verification Claim.
When one check crosses capability areas, assign its primary claim and record only distinct supporting claims.
Do not create duplicate evidence owners for one cross-cutting claim.
Record checks that support no distinct approved claim.
Record approved claims that lack sufficient evidence.
Record duplicated evidence ownership and expensive seams that lack a distinct justification.

For each mapped item, decide whether to retain, consolidate, move to a cheaper seam, replace, or remove it.
An existing test does not earn retention merely because it exercises supported functionality.
When automated evidence is flaky, brittle, or disproportionately costly and its Material Risk does not justify durable automation, remove it even when no automated replacement is added.
Use lower-cost evidence when the claim still needs support, and record that mandatory gates are sufficient when no additional evidence is justified.
Add evidence only when an approved Verification Claim remains unsupported.
Use targeted diff, search, inspection, type checking, or a one-time script instead of durable evidence when the claim concerns retired text, symbols, files, or implementation structure.
Use test-double evidence only when the Verification Claim does not require integration with the real dependency.

Present the reconciled target for operator approval before creating implementation Tasks.

This phase is complete when every retained check owns a distinct claim, every approved claim has sufficient planned evidence, and the planned portfolio meets its approved budgets.

### Approved Task capability reconciliation

Replace the current real-Git TS-1 Managed Worktree scenario with evidence through the existing injectable Change Start use case.
Cover an unfinished direct dependency, exact blocking facts, unchanged Todo state, no Change or side effect, and successful Change Start when every direct Dependency is Done.
Do not add a CLI injection seam solely for evidence.
The direct dependency persistence projection does not own TS-1 because it does not observe Change Start.
Remove it from TS-1 ownership and retain it only if another approved claim needs it.

Consolidate TS-2 into capability-local real-SQLite lifecycle evidence.
Cover merged, No-Change, and cancellation success plus one representative second-update abort that leaves both records unchanged.
Use cheaper captured cancellation-workflow evidence for unavailable, mismatched, and merged pull-request observations.
Move merged remote observation to PUB-3 and No-Change routing to PUB-5.
Consolidate duplicate cancellation and completion scenarios.
Treat generic Task lifecycle tests as removal candidates unless another approved claim owns them.

This reconciliation requires no Task capability system sentinel.
TS-1 evidence should become cheaper by removing repository-copy and real-Git setup.
TS-2 must retain real SQLite but must not include remote, Git, cleanup, or full CLI setup.

### Approved Change capability reconciliation

Replace fragmented CS-1 component evidence with real-Git and real-SQLite binding scenarios at both the Implementer launch and Candidate capture seams.
Observe recorded Local Repository, Repository Branch, and Managed Worktree mismatches rejecting with zero launch, capture, or related state-mutation calls.
Current Implement does not recheck the recorded binding, and Candidate capture does not receive the recorded Managed Worktree path.
Require the product correction at both seams before CS-1 is complete.
Do not decide the exact shared binding Adapter only to simplify evidence.

Replace the expensive process-level CS-2 blocker scenario with focused in-process Implement and Submit evidence backed by real SQLite.
Observe both commands rejecting a stored blocker without starting external work, and observe Blocker Resolution restoring implementation eligibility.
Retain focused real-SQLite blocker storage invariants as supporting evidence.
Keep running-agent continuation behavior outside CS-2.

Retain real-Git Candidate capture and exact real-SQLite identity evidence for CS-3.
Add one composed Submit scenario that follows the exact Change, Change Base commit, and Repository Branch head through Candidate capture, Validation start or reuse, and captured publication input.
Keep remote publication facts under PUB-1.
Move Validation, Publication, Reconciliation, inspection, CLI routing, and cleanup evidence out of CS ownership when it does not establish a CS claim.

This reconciliation requires no Change capability system sentinel.

### Approved Validation capability reconciliation

Consolidate VE-1 into one focused real-SQLite owner set.
Cover exact Candidate and policy identity, Validation Run-owned Findings, Artifacts, Tooling Failures, workspace facts, and rounds, isolation between Validation Runs, and passed reuse only for the same Candidate and policy.
Move policy resolution to CFG-1 and inspection presentation to CLI-3.

Replace manually assembled Gate evidence with a VE-2 Candidate Validation service matrix.
Cover taskless changed, task-backed changed, and task-backed No-Change Candidates, required phase and producer order, stop conditions, and passed, blocked, or tooling-failed outcomes.
Retain direct producer tests only when they own a cheaper distinct variation.

Consolidate VE-3 around exact Candidate scope, Acceptance Context or Specialist concern, output structure, current-Run Artifact references, and persisted Reviewer Session identity.
Use real SQLite and temporary Artifact storage with a fake reviewer runtime.
Keep real cross-workspace process mechanics under AG-1 rather than adding a VE-3 process sentinel.
Treat severity assertions as superseded target evidence and use the shared reviewer contract produced by BY-83 instead of duplicating that Task.

Make VE-4 terminal write guards the first Validation product correction.
After completion or abandonment, real SQLite must reject late rounds, Artifacts, workspace facts, Tooling Failures, and outcome changes without changing the terminal outcome or active relation.
Cover active-Run uniqueness, cleanup failure, successful abandonment, active-relation clearing, and repeated abandonment.
Move inspection behavior to CLI-3, workspace lifecycle behavior to RP-1, and agent launch behavior to AG-1.

This reconciliation requires no Validation system sentinel.

### Approved Publication capability reconciliation

Consolidate PUB-1 into exact target, Candidate head, owned pull request, and persisted Validation policy eligibility evidence with real SQLite, a fake GitHub boundary, and one real local remote for immediate URL binding.
Retain cheap gateway command-shape or parser evidence only when it owns a distinct Adapter contract.
Do not make policy resolution a PUB-1 concern.

Consolidate PUB-2 into zero, exactly one, and multiple or ambiguous remote-observation recovery cases with real SQLite and a stateful fake GitHub boundary.
Replace implementation-specific retry-count assertions with semantic unresolved-recovery outcomes.
Do not add exactly-once or live-GitHub evidence.

Correct PUB-3 so Reconciliation rejects a merged pull request whose head differs from the persisted Candidate.
Replace the current mismatched-head completion expectation with mismatch rejection, matching-head completion request, and unavailable or malformed observation cases.
Move real-SQLite atomic completion to TS-2.

Keep one real bare-remote `force-with-lease` deletion and a cheap rejection matrix for PUB-4.
Cover URL mismatch, head mismatch, lease failure, and uncertain deletion remaining pending.
Move unrelated local worktree, local Repository Branch, container, and process cleanup outside PUB-4.

Replace fragmented fake Submit scenarios with one composed PUB-5 scenario using real Git Candidate capture, a local bare remote, real SQLite, and fake Validation and publication boundaries.
Cover taskless `nothing_to_submit`, task-backed Acceptance-only completion, tree inequality rejecting No-Change, and stable Candidate head around tree comparison.
Move Acceptance behavior to VE-2, completion persistence to TS-2, and CLI presentation to CLI ownership.

Treat commit-message and publication-metadata tests as removal candidates unless another approved claim adopts them.
This reconciliation requires no broad CLI, process, or live-GitHub sentinel.

### Approved Shared Repository State capability reconciliation

Consolidate SRS-1 into one real main-checkout and linked-worktree scenario.
Observe both entrypoints resolving the same real Git common directory, using one state database, creating no worktree-local state, and rejecting a mismatched persisted repository identity before workflow use.
Migrations may run before the identity check because the approved claim does not require zero initialization mutation.
Move shared Task Context draft behavior to another approved owner or remove it if none exists.

Replace unsupported migration-failure and duplicate ledger tests with MIG-1 evidence from two supported paths.
Retain one fresh-database observation of the complete chain from `0001` through the current migration.
Create one representative populated database at migration `0005`, acquire it through normal storage composition, run migrations `0006` through `0010`, and observe preservation of required facts and owner links.
Use no pre-`0009` running Validation Run.
Rely on pinned Effect SQL guarantees for migration ordering, duplicate rejection, and transaction rollback.
Do not add checksums, generic transaction tests, or one fixture per historical migration.

Correct only the two confirmed SRS-2 decoder defects.
A present malformed Acceptance Context `resolutions` value and malformed Candidate Validation Policy Snapshot JSON must fail as `RepositoryPersistedDataInvalid` through their public SQLite Adapters.
Optional malformed Reviewer Session metadata may still cause fresh continuity.
Do not add decoding for schema-constrained values, non-authoritative Implementation Decisions, or harmless scalars.

Remove duplicate identity smoke tests, unsupported migration fixtures, generic transaction probes, and helper-only decoder tests from SRS ownership unless they support another distinct approved claim.
This reconciliation requires no Shared Repository State system sentinel.

### Approved CLI capability reconciliation

Replace scattered CLI-1 and CLI-2 process tests with one isolated built-CLI sentinel.
Cover success with logs only on stderr, usage failure in JSON and TOON, one inferred-Change runtime failure with target facts and recovery guidance, and OS exit status matching the structured result.
Retain cheaper serializer evidence only for distinct format variations.

Consolidate CLI-3 around real-SQLite and real-Artifact inspection behavior.
Cover Task list limits and complete retrieval, Change Finding and Validation Run detail commands, and Artifact preview, truncation, full retrieval, empty content, and unavailable content.
Move lifecycle and persistence behavior to their capability owners.

Replace scattered parser and forwarding tests with one in-process CLI-4 canonical-command matrix.
Observe every documented command reaching the intended operation with correct positional and option values.
Observe invalid syntax reaching no operation or mutation.
Use existing injected operation seams and add no capture seam unless the existing design cannot observe routing.

The operator rejects durable selector-specific evidence for removed `--output` and `-o` forms in the target portfolio.
Remove those tests during the portfolio migration because generic CLI-4 unknown-option evidence establishes parser rejection without preserving removed interface vocabulary.
BY-86 currently requires those selector-specific rejection tests for its in-flight Change, so the portfolio migration must explicitly supersede that requirement instead of mutating the accepted BY-86 Task Context.
Remove duplicate JSON help, exact serialization, and large concurrent process workflow evidence from CLI ownership unless another approved claim adopts it.
Do not add or retain evidence for a `task start` command because the current interface does not contain that command.
Do not add a process test per command.
The approved empty Validation Run abandonment-reason shape correction remains required before CLI-2 is complete.

### Approved runtime-foundation reconciliation

Keep one RI-1 real-process sentinel through Candidate `bin/by` with a real linked worktree and real SQLite.
Observe delegation to the canonical main-checkout Trusted But Why Executable, use of canonical Shared Repository State, exclusion of Candidate-local executable and migration code, and fail-closed behavior.
Remove incidental path-format and unusual-newline variations unless another approved claim needs them.
Do not add another RI-1 process sentinel.

Consolidate CFG-1 into one composed configuration-to-persisted-policy scenario with real SQLite.
Observe documented precedence and paths, role selection, required resources, every policy field consumed by execution, and preservation of policy meaning in the stored snapshot.
Retain focused resolver evidence only for distinct inexpensive variations.
Keep Validation Run identity under VE-1 and malformed persisted policy under SRS-2.

Exercise RP-1 with small real marker commands in the Managed Worktree and Validation Workspace.
Observe the resolved command, working directory, operation inputs, and readiness gate.
Use cheaper captured seams for nonzero exit, timeout, execution failure, observation failure, Candidate-integrity failure, and prevention of downstream work.
Do not add a broad workflow or process sentinel.

Exercise AG-1 through captured launch calls and fake agent runtimes.
Observe the resolved Agent Profile, complete role instructions, Agent Environment wrapper, configured resource flags, and rejection of missing required resources before launch.
Remove duplicate real-process, cross-workspace, external Herdr, and resource-isolation evidence.
Rely on Sandcastle for pinned process and session mechanics, but retain But Why ownership of launch configuration.
Do not run a real model or claim model behavior, OS-level resource enforcement, or process supervision.

## Phase 4: Plan and implement migration slices

Complete BY-83 before the first verification portfolio migration Task.
Treat merged BY-86 behavior and completed BY-87 work as inputs to the final CLI inventory.
Reconcile their Task and Change lifecycle records before a migration Task requires their terminal state.

The approved migration has 14 vertical Tasks:

1. One portfolio-controls Task records the target root `VERIFICATION.md`, updates packaged Implementer guidance, and removes obsolete timing warnings.
2. Five product-correction Tasks own Change binding verification, Validation terminal-write guards, exact publication and Candidate identity, the two confirmed persisted-data decoder corrections, and the empty Validation Run abandonment-reason result.
3. Seven evidence-migration Tasks own Task lifecycle, Change and Candidate, Validation, publication, Shared Repository State, CLI, and runtime-foundation evidence.
4. One closure Task confirms distinct claim ownership, measures the maintained workflows, removes or explicitly retains temporary suite controls, and removes the generic `boundary` category.

### Migration ledger

This ledger prevents an approved migration slice from becoming implicit before its SQLite Task is created.
The slot name is planning vocabulary only, is never a CLI command identifier or Task ID, and is not a domain record or implementation authority.
Create one portfolio Task at a time from current repository evidence, record its Task ID here, implement and dogfood it, and then refine the next slot.
The `State` column is a manually maintained planning summary with allowed values `Planned`, `Active`, `Done`, and `Superseded`.
SQLite Task and Change state remains authoritative.
Update this ledger when a Task is created or its planning summary changes.
Remove the ledger with this plan after authoritative artifacts contain the accepted strategy and every migration Task is complete.

| Order | Slot | Observable outcome | Required program input | SQLite Task | State |
| --- | --- | --- | --- | --- | --- |
| 1 | VP-0 Portfolio controls | `VERIFICATION.md`, packaged Implementer guidance, and maintained quality controls state the accepted strategy without obsolete timing rules. | BY-83 Done. | Not created | Planned |
| 2 | VP-CS1 Change binding correction | Implement and Candidate capture reject a recorded repository, branch, or worktree mismatch before external work. | VP-0 complete. | Not created | Planned |
| 3 | VP-VE4 Validation terminal-write correction | Completed and abandoned Validation Runs reject late rounds, Findings, Artifacts, workspace facts, Tooling Failures, and outcome writes. | VP-0 and BY-54 complete. | Not created | Planned |
| 4 | VP-PUB-CORR Exact publication identity correction | Publication, merged completion, and No-Change comparison reject mismatched or moving Candidate and target facts. | VP-0 complete. | Not created | Planned |
| 5 | VP-SRS2 Confirmed decoder correction | The two approved malformed persisted values return `RepositoryPersistedDataInvalid` at their public SQLite trust seams. | VP-0 complete. | Not created | Planned |
| 6 | VP-CLI2 Abandonment-result correction | An empty Validation Run abandonment reason returns the supported structured usage error and exit status without mutation. | VP-0 complete. | Not created | Planned |
| 7 | VP-TS Task evidence migration | TS-1 and TS-2 have distinct capability-local evidence owners without generic lifecycle duplication. | VP-0 and VP-PUB-CORR complete; sequence after BY-66. | Not created | Planned |
| 8 | VP-CS Change evidence migration | CS-1 through CS-3 have sufficient evidence at their approved Change and Candidate seams. | VP-CS1 complete. | Not created | Planned |
| 9 | VP-VE Validation evidence migration | VE-1 through VE-4 have sufficient Validation Run, gate, reviewer-boundary, and recovery evidence. | VP-VE4 and BY-83 complete; sequence after BY-71. | Not created | Planned |
| 10 | VP-PUB-EVID Publication evidence migration | PUB-1 through PUB-5 have sufficient target, recovery, cleanup, and completion evidence. | VP-PUB-CORR complete. | Not created | Planned |
| 11 | VP-SRS Shared-state evidence migration | SRS-1, MIG-1, and the approved SRS-2 cases have sufficient current-system evidence. | VP-SRS2 complete. | Not created | Planned |
| 12 | VP-CLI CLI evidence migration | CLI-1 through CLI-4 use one justified process sentinel plus capability-local inspection and routing evidence. | VP-CLI2, BY-86, and BY-87 complete. | Not created | Planned |
| 13 | VP-RUN Runtime-foundation evidence migration | RI-1, CFG-1, RP-1, and AG-1 have sufficient evidence at their approved seams. | VP-0 complete; sequence after BY-68. | Not created | Planned |
| 14 | VP-CLOSE Portfolio closure | Every retained check has distinct ownership, maintained workflows are measured, and temporary controls and categories have final dispositions. | VP-TS, VP-CS, VP-VE, VP-PUB-EVID, VP-SRS, VP-CLI, and VP-RUN complete. | Not created | Planned |

A required program input controls creation order but becomes a SQLite Task Dependency only when the later Task cannot be implemented or verified without the earlier Task's completed result.

Each product correction must be complete before the evidence migration that claims its corrected behavior.
BY-83 must be complete before Validation evidence migration.
BY-86 and BY-87 must be complete before final CLI evidence migration.
Every evidence migration must be complete before portfolio closure.

Run BY-66 before Task lifecycle evidence migration, BY-68 before runtime-foundation evidence migration, and BY-71 before Validation evidence migration to avoid evidence churn.
These are sequencing choices rather than Task Dependencies unless the later Task cannot be implemented or verified without the earlier result.
BY-69 does not own the two decoder corrections because its unresolved public error contract belongs to separate active-Task reconciliation.

Split the approved reconciliation into independently useful vertical Tasks.
Do not create one Task per test file, module, mechanism, or cleanup category.
Each Task must produce an observable improvement in confidence, cost, stability, or evidence ownership.
Each Task Context must contain a Task Verification Contract.
When a Task retires a concept, its Task Verification Contract must apply the repository current-system invariant.
The contract must identify the retired concept, its replacement, affected repository surfaces, targeted search scope, and each accepted exception.
It must distinguish durable current-behavior evidence from one-time removal evidence and require targeted diff, search, and inspection evidence for the removal claim.
Do not create durable evidence whose only purpose is to prove that the retired concept is absent.

Record this evidence-lifecycle strategy in the target root `VERIFICATION.md` before migration implementation begins.
One approved migration Task must update the packaged Implementer guidance so completion includes current-system reconciliation and the required one-time evidence.
Do not make that product-instruction change directly from this working plan.

Implement one approved Task at a time.
Collect the evidence required by its Task Verification Contract.
Run every mandatory repository gate.
Dogfood the resulting portfolio before refining the next Task.
Create the next Task only when current implementation evidence supports its boundary.

This phase is complete when every approved portfolio claim has sufficient maintained evidence, every retained check has distinct ownership, and the accepted budgets pass their measurement procedures.

## Implementation Advisor handoff

The Implementation Advisor is part of the agent-execution foundation after its implementation Change closes.
Before creating VP-0, update the approved capability map, Material Risks, Verification Claims, and evidence owners for the resulting supported behavior.
The update must include separate Agent Profile resolution, qualifying-delta scheduling, accumulated-delta preservation, structured rule and citation validation, duplicate suppression, fail-open behavior, bounded read-only tools, and non-waking advice delivery.
The update must preserve `continue-change` as the sole Interactive Session liveness owner.
It must not claim semantic model correctness from deterministic evidence.
Use the approved spike report in [implementation-advisor-spike.md](implementation-advisor-spike.md) as one-time feasibility evidence, not as durable current-behavior evidence.

The Implementation Advisor Task Verification Contract must establish the implementation-specific evidence needed before the Change closes.
Do not delegate the portfolio capability, risk, claim, or evidence-owner design to that Task.

## Planning-gate handoff

Do not start Slice 3 of the Task Submission planning gate before this plan is complete.
After portfolio closure, complete the approved codebase simplification audit and each approved shared-foundation simplification that Planning would otherwise consume.
Then start Planning Slice 3.
When planning-gate implementation resumes, create every new Task with an approved Task Verification Contract.
The planner must define the contract.
The Planning Reviewer must judge its feasibility and sufficiency.
The Implementer must execute it.
The Acceptance Reviewer must judge the resulting evidence.

Defer approval-binding verification to the Task Submission planning gate.
Its Material Risk is that Task Context or dependency facts can change after submission or approval, so implementation or Acceptance Review can use intent that the operator did not approve.
Slice 3 must prove that approval binds the exact Planning Proposal Snapshot and that concurrent mutation cannot create approval.
Until Slice 4 provides confirmed revision, approved Task intent must remain immutable.
Slice 4 must prove that an approved revision explicitly invalidates the old approval and that Change Start captures only the newly approved intent.
Do not include this future behavior in the current-system portfolio.

BY-83, `Use one material reviewer Finding contract`, belongs to Slice 2 of the Task Submission planning-gate sequence.
It owns removal of Finding severity, the shared reviewer-output core contract, Validation-specific Artifact references, prompts, persistence writes, inspection views, and affected documentation.
The verification portfolio must not create a duplicate severity-removal correction or Task.
VE-3 reconciliation must treat severity assertions as superseded target evidence and use BY-83's resulting contract when that Task is complete.

## Approved design decisions

The operator approved the capability map, Material Risks, Verification Claims, evidence owners, system sentinels, cost policy, current-portfolio reconciliation, and 14-Task migration structure.
BY-83 runs before the verification portfolio migration.
The Implementation Advisor visible pilot may proceed before BY-83 and the verification portfolio migration.
Complete the Implementation Advisor Change and its cross-program portfolio update before creating VP-0.
The remaining high-level program order is BY-83, verification portfolio migration, shared-foundation simplification, Planning Slices 3 and 4, and then normal product and release work.
The pre-v1 Shared Repository State reset remains a separate optional decision.

## Approval

The operator approved this complete plan on 2026-08-01.
The plan remains non-authoritative planning context while implementation proceeds.
Evaluate each architectural decision against the repository ADR qualification rules before recording its authoritative form.
Record accepted project verification strategy in `VERIFICATION.md`.
Record implementation requirements and Task Verification Contracts in SQLite Tasks.
Transfer each deferred disposition to its applicable current documentation, open question, Task, or explicit operator rejection.
Remove this working plan after those authoritative artifacts contain every accepted decision and disposition and the approved migration is complete.
