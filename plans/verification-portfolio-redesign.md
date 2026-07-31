---
status: provisional
artifact_kind: working-plan
remove_when: approved portfolio decisions are recorded in VERIFICATION.md and implementation slices are recorded as approved Tasks
---

# Verification portfolio redesign

> Non-authoritative working plan.
> This file records provisional design choices and unresolved questions while the verification portfolio is evaluated.
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
Proposed risks, claims, evidence owners, mechanisms, sentinels, and budgets must remain here until the operator approves them.

## Scope and sequence

The verification portfolio redesign must precede implementation of the Task Submission planning gate.
The work must use this sequence:

1. Establish the accepted current verification strategy in `VERIFICATION.md`.
2. Design the target verification portfolio from Material Risks and Verification Claims.
3. Obtain operator approval for the target portfolio before using individual existing tests as design precedent.
4. Reconcile the existing checks and tests against the approved target.
5. Split the required migration into independently verifiable implementation Tasks.
6. Implement and dogfood those Tasks.
7. Begin the Task Submission planning-gate changes only after the portfolio redesign is complete.

The planning-gate work must use Task Verification Contracts from its first new implementation Task.
The planning-gate working plan remains a separate artifact because it owns a separate product capability and implementation sequence.

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

A Task-backed Change Start creates or resumes work only when the Task is eligible and every direct Task Dependency is Done.
Otherwise, it reports the blocking dependency facts without creating a Change or advancing the Task.

**TS-2: Authoritative linked-Task terminal states**

A linked Task reaches Done only through an authoritative merged owned-pull-request outcome or a passed task-backed No-Change completion.
A linked Task reaches Cancelled only through the linked Change cancellation operation.
The Change terminal record and Task terminal state must commit together.
Unavailable or mismatched remote facts, Active Validation, or invalid completion evidence must leave the Task nonterminal.

Current code does not satisfy TS-2 when Reconciliation observes a merged pull request whose head differs from the recorded Candidate.
Plan the product correction separately from evidence-portfolio changes, but require both before TS-2 is complete.

### Change implementation and Candidate selection

**CS-1: Change binding at work seams**

Before agent launch or Candidate capture, But Why must verify the recorded Local Repository, Repository Branch, and Managed Worktree binding for the Change.
A mismatch must reject the operation without launching the agent or capturing a Candidate.

Current implementation launch does not reverify the recorded Managed Worktree before it starts an Interactive Session.
Plan the product correction separately from evidence-portfolio changes, but require both before CS-1 is complete.

**CS-2: Blocked Change gate**

After an Implementation Blocker is stored, new implementation and Submission commands must reject.
Implementation Blocker Resolution is the only operation that makes the Change implementable again.
But Why does not claim that it detects or stops an already-running external process.

**CS-3: Exact Candidate identity**

Validation, Validation Run reuse, and Candidate Publication must use the exact Change, Change Base commit, and Repository Branch head commit captured for the Candidate.
A mismatch must reject the operation or enter explicit recovery.

### Validation execution, evidence, judgment, and recovery

**VE-1: Run-rooted evidence**

A Validation Run must identify one exact Candidate and immutable Validation Policy Snapshot.
Findings, Artifacts, Tooling Failures, workspace facts, and review rounds must bind through that Validation Run.
Passed reuse, publication, and No-Change completion must require the same Candidate and policy binding.

**VE-2: Fixed Validation Gate**

But Why must run only the validation phases eligible for the Change type and must run them in the required order.
A Finding or tooling failure from a required producer must prevent a passed Validation Run.

**VE-3: Reviewer boundary**

Each reviewer must receive the exact Candidate scope, applicable Acceptance Context or Specialist concern, resolved instructions, Agent Profile, Agent Environment, and matching Reviewer Session identity.
Only structurally valid producer output with resolvable current-Run Artifact references may become review evidence.
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

Candidate Publication must use the recorded repository, base branch, Remote Change Branch, owned pull request, and exact Candidate head.
A missing, mismatched, or ambiguous target fact must not produce publication success.

**PUB-2: Honest publication recovery**

After an uncertain remote mutation, But Why may record publication only when one unambiguous observation matches the owned target and exact Candidate head.
Otherwise, publication must remain unresolved for explicit recovery.
This claim does not require exactly-once remote mutation.

**PUB-3: Exact merged completion**

Reconciliation may close a Change and its linked Task only when the merged owned pull request matches the recorded target and published Candidate head.
Unavailable or mismatched facts must leave the Change and Task nonterminal or explicitly rejected.

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
This claim does not require runtime migration checksums, exhaustive semantic round trips, or backfill of pre-`0009` running Validation Runs.

**SRS-2: Safe persisted-data handling**

Malformed persisted data that affects lifecycle, ownership, policy, or evidence must not become a valid-looking domain fact.
Optional Reviewer Session metadata may invalidate continuity and cause a fresh session instead of failing the workflow.
This claim does not require strict validation of every harmless scalar.

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
Validation Run reuse and Candidate Publication must use the same complete resolved policy snapshot that execution recorded.
This claim does not prove operator intent or use a raw configuration hash as policy evidence.

**RP-1: Repository Preparation in required workspaces**

Repository Preparation must run the resolved command in each required Managed Worktree or Validation Workspace.
A nonzero exit, timeout, execution failure, observation failure, or Candidate-integrity failure must prevent readiness or a passed Validation Run.
This claim does not require environment equality, dependency attestation, or Preparation in the task-backed no-change Acceptance-only path.
It does not decide how Preparation policy changes between Change Start and Change Submit behave.

**AG-1: Agent launch fidelity**

Implementer and reviewer launches must use the resolved role profile, role instructions, Agent Environment, and configured resource allowlists.
Missing required local instructions, extensions, or skills must reject before launch.
A changed reviewer identity must not resume the prior Reviewer Session.
This claim does not attest external model behavior or supervise external processes.

The behavior when Repository Preparation policy changes between Change Start and Change Submit remains a separate product decision.

### Cross-cutting claim coverage

The capability-specific Verification Claims collectively address the approved cross-cutting Material Risks.
Do not create separate universal claims that require system-wide provenance, transactional external systems, automatic repair, or maximum prevention.

## Known current state

The root `VERIFICATION.md` defines the accepted current verification strategy on `origin/main`.
`docs/tooling.md` defines supported contributor commands and current quality ownership.
The repository provides focused tests, type checking, Biome checks, documentation checks, ast-grep structural checks, Fallow checks, builds, coverage, routine quality, and full quality.

`just quality` runs routine tests, routine static checks, and a build.
The executable quality runner reports when this workload exceeds its 10-second operating budget.
`just full-quality` runs the complete selected test suite with the same blocking static checks and build.
The executable quality runner reports when this workload exceeds its 30-second operating budget.

Vitest separates `*.boundary.test.ts` from the routine suite.
The routine suite excludes boundary tests.
The full suite includes boundary tests.
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
Add evidence only when an approved Verification Claim remains unsupported.
Use search, diff review, type checking, or a one-time script instead of a durable test when the claim concerns retired text, symbols, files, or implementation structure.
Use test-double evidence only when the Verification Claim does not require integration with the real dependency.

Present the reconciled target for operator approval before creating implementation Tasks.

This phase is complete when every retained check owns a distinct claim, every approved claim has sufficient planned evidence, and the planned portfolio meets its approved budgets.

## Phase 4: Plan and implement migration slices

Split the approved reconciliation into independently useful vertical Tasks.
Do not create one Task per test file, module, mechanism, or cleanup category.
Each Task must produce an observable improvement in confidence, cost, stability, or evidence ownership.
Each Task Context must contain a Task Verification Contract.

Implement one approved Task at a time.
Collect the evidence required by its Task Verification Contract.
Run every mandatory repository gate.
Dogfood the resulting portfolio before refining the next Task.
Create the next Task only when current implementation evidence supports its boundary.

This phase is complete when every approved portfolio claim has sufficient maintained evidence, every retained check has distinct ownership, and the accepted budgets pass their measurement procedures.

## Planning-gate handoff

Do not start Slice 3 of the Task Submission planning gate before this plan is complete.
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

BY-83 currently belongs to Slice 2 of the Task Submission planning-gate sequence.
Its placement relative to this portfolio redesign remains unresolved.
Do not implement or revise BY-83 until the operator decides whether it is deferred with the planning gate or included in the foundational verification work.

## Open decisions for grilling

The grilling session must resolve these decisions in order:

1. Whether the two-group capability map covers the supported current system without gaps.
2. Which durable failures are cross-cutting Material Risks.
3. Which additional Material Risks belong to each capability area.
4. Which Verification Claims are sufficient for each approved Material Risk.
5. Which mechanism owns each approved Verification Claim.
6. Which complete workflows require system sentinels.
7. Which runtime and stability budgets the project accepts and how it measures them.
8. Which current checks duplicate ownership, use an unnecessarily expensive seam, or protect no approved claim.
9. Which migration slices provide independently useful outcomes.
10. Whether BY-83 belongs before or after the portfolio redesign.

## Approval

This plan remains provisional until the operator explicitly approves it.
After approval, evaluate each architectural decision against the repository ADR qualification rules.
Record accepted project verification strategy in `VERIFICATION.md`.
Record implementation requirements and Task Verification Contracts in SQLite Tasks.
Remove this working plan after those authoritative artifacts contain every accepted decision and the approved migration is complete.
