# Test suite consolidation plan

## Status and purpose

Status: Removal-first audit reconciled across all 103 test files; the four vague consolidation Tasks BY-85 through BY-88 were cancelled, and exact replacement Tasks have not yet been recorded.

This temporary planning artifact records the evidence, decisions, and unresolved questions for consolidating the But Why test suite.
It is planning context rather than product documentation, implementation authority, an approved specification, or authorization to change tests.
The investigation will keep this artifact current across long sessions and derive Tasks only after the affected test portfolios and overlapping work are understood.

Remove this plan after the Operator accepts the resulting work split and every accepted requirement is represented in an authoritative Task, current documentation source, or ADR.

## Required outcome

Make the maintained test suite smaller, faster, and easier to change while preserving the distinct protection required by accepted behavior and material risks.
Reduce total test cases, files, test and support lines, fixture concepts, setup paths, subprocesses, Git operations, SQLite initialization, repeated assertions, and incidental test logic where they do not protect a distinct fact.
Consolidate repeated setup and evidence into simpler owner-specific portfolios that require fewer concepts and less coordination to understand or change.
Organize retained evidence around the responsibility that owns the behavior rather than around the historical sequence in which features and defects were added.

A proposed consolidation is better only when it preserves the same required confidence at a cheaper reliable seam and reduces the complete maintenance or execution cost of the affected portfolio.
Line reduction, helper reuse, fewer files, lower conceptual complexity, and faster execution are measurements rather than independent goals, but the investigation must evaluate all of them rather than treating runtime as the primary outcome.

The broad audit must be evidence-led rather than reflexively conservative or deletion-driven.
It must challenge whole integration layers, repeated owner coverage, local and shared setup, suite boundaries, support-module survival, and production seams retained for tests.
It must produce an aggregate suite-level reduction model instead of presenting isolated local wins as sufficient.
A retained expensive or lengthy test group needs affirmative evidence that its boundary and distinct facts remain necessary after cheaper owner evidence is allocated.

## Authorities and constraints

`VERIFICATION.md` defines the material risks and project-specific evidence constraints.
`docs/tooling.md` defines check ownership and the supported contributor workflows.
`docs/architecture.md` and the context documents define domain and module ownership.
`plans/system-simplification-plan.md` supplies overlapping implementation-simplification context but does not authorize test changes.

Retain real SQLite evidence for distinct atomicity, supported migration, and persisted Shared Repository State contracts.
Retain real Git evidence for distinct identity and work-preservation contracts.
Use a real process only when package, executable, stdin, process-tree, or agent-runtime behavior is at issue.
Retain the shared capacity lock and three-worker Vitest limit unless a future Candidate supplies the evidence required by `VERIFICATION.md`.
Do not weaken exact Acceptance Context, Candidate, Validation Run, external-target, cleanup, or terminal-result identity protection.
Do not make private implementation seams public or replaceable only to simplify a test.

## Scope

The investigation covers all of the following connected structures.

- Test portfolio ownership and the allocation of behavior, contract, boundary, and failure evidence across files.
- Suite and file boundaries, including fragmented suites that protect one responsibility and oversized suites that combine materially different responsibilities.
- Shared harnesses for disposable repositories, Git, SQLite, CLI execution, Agent Sessions, reviewer workflows, validation, publication, cleanup, and external-system fakes.
- Repeated setup, lifecycle construction, persisted-state fixtures, corruption operations, clocks, policies, identifiers, and expected records.
- Scenario tables and assertion helpers where cases differ only by inputs and expected classification.
- Execution topology, including repeated subprocess startup, repeated scans, avoidable repository initialization, and setup that can be safely shared within one isolation boundary.
- Production seams and dependency injection retained only for tests, where the system simplification initiative may remove the source of test setup cost.

The investigation does not assume that every repeated block should become a helper.
A shared harness must concentrate stable mechanics or invariants without hiding the policy and assertions that make a test understandable.
A universal configurable fixture is not the target.

## Decision rules

Evaluate a group of tests as one responsibility portfolio before deleting or extracting individual cases.
Name the owner, supported interface, protected facts, required boundary, and failure class for every retained evidence group.
When checks overlap, retain the cheapest reliable owner seam plus every distinct material boundary fact.
Keep an expensive boundary test only when replacing that boundary would stop the test from establishing its protected fact.
Consolidate setup only when the consumers share its lifecycle, invariants, and cleanup semantics.
Keep policy choices and consequential assertions visible at the test site even when mechanics move into a harness.
Prefer a small owner-specific fixture vocabulary over option bags that can construct invalid or irrelevant states.
Treat a second fixture or decoder for the same durable meaning as a trigger to inspect ownership rather than automatic evidence for a generic abstraction.
Remove the replaced setup path after all current consumers migrate.
Measure the affected portfolio before and after each proposed change.

## Current investigation sequence

This sequence was read-only except for updating this planning artifact, operating authorized Task state, and creating disposable local probes whose state was removed after use.
It first produced four overly broad Tasks, which the Operator cancelled after Task Review exposed missing exact removal boundaries.
A subsequent removal-first audit examined every test file and independently challenged the replacement task boundaries.

1. Capture a per-file runtime baseline and counts of expensive process, Git, SQLite, repository, and package boundaries.
2. Map each major responsibility portfolio from current tests to the supported facts and material failures it protects.
3. Map helper consumers and identify which setup, lifecycle, cleanup, and assertion semantics are genuinely shared.
4. Identify duplicate evidence separately from duplicate mechanics, incidental fixture logic, and production seams retained only for tests.
5. Run bounded disposable experiments for consequential consolidation or deletion hypotheses that cannot be resolved by inspection.
6. Design the smallest retained portfolio structure and narrow owner-specific harness boundaries for each mature area.
7. Reconcile the portfolio proposals across the complete suite so that they do not create overlapping helpers, preserve obsolete seams, or move complexity between portfolios.

Record current and expected file, test, line, helper-concept, subprocess, Git, SQLite, repository-initialization, and duration changes when they can be measured reliably.
Do not derive another broad cleanup Task.
Record immediate work only for exact deletions or one owner-specific simplification, and assign architecture-coupled deletion to the operation-first Task that removes its production seam.

## Baseline inventory

The current checkout contains 103 `*.test.ts` files and approximately 37,561 lines in those files.
All TypeScript under `test/`, including support code, contains approximately 39,968 lines, while production TypeScript under `src/` contains approximately 35,446 lines.
An AST-based inventory finds 722 lexical registrations, including aliased and chained Effect/Vitest forms that the earlier direct-pattern count of 671 missed.
Parameterized cases expand beyond those registrations.
The first full Vitest JSON-profile run completed successfully in 88.766 wall-clock seconds with 950 tests across 103 files, including 949 passed tests and one pending test.
A second successful three-worker audit run retained the same files and executed-case count while completing in 80.450 seconds with 206.047 seconds of summed concurrent file span, compared with 219.4 seconds in the first profile.
The stable counts and variable timings confirm that one-run spans are prioritization evidence rather than acceptance thresholds.

The suite has 21 files under `test/change`, 19 under `test/repository`, 13 under `test/agent`, 12 under each of `test/validation`, `test/task`, and `test/cli`, and smaller publication, configuration, command, support, and submission groups.
The ten largest test files contain approximately 13,166 lines, led by publication policy, Change Submit orchestration, GitHub pull-request behavior, Task Review submission, and Candidate Validation inspection.

The fresh profile's per-file execution spans sum to approximately 219.4 seconds because Vitest runs three workers concurrently.
The ten largest spans account for approximately 68.6 percent of that sum.
The leading spans were Change inspection at 56.81 seconds, Task Review submission at 17.14 seconds, Candidate Validation at 15.89 seconds, tooling diagnostics at 14.10 seconds, Change Start Managed Worktree behavior at 12.64 seconds, Candidate Specialist Review at 10.79 seconds, Change Cleanup Git behavior at 6.47 seconds, Candidate Acceptance Review at 6.15 seconds, publication policy at 5.73 seconds, and Change Reconcile discard CLI behavior at 4.78 seconds.
The spans came from one concurrent run and identify investigation priorities rather than stable isolated benchmarks.

The current support directory contains focused helpers for process execution, workspaces, Git cleanup, CLI execution, initialized repositories, Candidate-ready repositories, SQLite state, Change ports, validation ports, Candidate capture, Change implementation, Change inspection, Task use cases, Terminal Cleanup, and Herdr fakes.
At least 42 test files import `testWorkspace`, 30 import `by-cli`, 29 import `testProcess`, and 19 import the repository SQLite support module.
At least 24 test files use temporary-repository concepts, 32 mention SQLite capabilities or Adapters, and 41 contain Git-related setup or assertions.
These counts identify investigation areas but do not establish that the current uses are redundant.

The broad quantitative audit found that `test/change`, `test/validation`, and `test/task` contain 45 of 103 files and 35.6 percent of executed cases but account for 50.8 percent of test lines, 76.8 percent of summed profile span, 78.8 percent of static subprocess cost, 81.5 percent of static Git cost, 60.7 percent of SQLite setup or open sites, 67.7 percent of repository initialization sites, and 64.7 percent of named local helper lines.
Across the complete suite, the audit found 660 static subprocess cost units, 520 Git cost units, 140 SQLite setup or open sites, 155 repository initialization sites, 2,492 named local helper lines, 160 hook lines, and 2,201 non-test support lines.
These are locator metrics rather than invocation counts because loops, opaque support wrappers, and production-internal operations expand differently at runtime.
Focused `strace` runs confirmed much larger dynamic fanout: Task Review submission executed 1,271 processes including 958 Git commands, direct Candidate Validation executed 733 including 522 Git commands, Change Start executed 713 including 525 Git commands, and Change Cleanup executed 598 including 497 Git commands.
The cost concentration is therefore dominated by repeated repository construction, real-Git workflows, source CLI launches, and broad fixture topology rather than exact duplicate assertions.

## Shared setup topology

`createTestWorkspace` is the base disposable-filesystem owner and appears in 37 test files with approximately 156 references.
Its cleanup removes both the workspace and sibling paths created by Managed Worktree behavior, so replacing it with a generic temporary-directory helper would lose a current safety responsibility.

`createGitRepo` adds only `git init` over that workspace, while `createInitializedRepo` invokes the source CLI to create Repo Config and Shared Repository State.
`candidateReadyRepo` builds on initialized state, creates a branch and remote shape, and directly inserts a Change into SQLite.
These helpers represent materially different repository states and should not be collapsed merely because they form a setup chain.
The investigation should instead test whether their names and returned facts make those states explicit and whether suites reconstruct any of the same states locally.

`runByInProcessEffect` appears in 18 test files with approximately 241 references.
Its options type exposes ten optional global-config, stdin, Task, Task/Change coordination, cancellation, reviewer-runtime, Underengineer-runtime, Interactive Session, and stderr fields in addition to the separate clock argument.
This broad test seam is an important source of flexible setup, but accepted ADR 0013 and `plans/system-simplification-plan.md` establish removal of broad CLI use-case injection objects as supported operations migrate.
Do not create a more elaborate fixture around an obsolete injection interface; coordinate its consumers with the applicable operation-first migration.

`withTemporaryRepositoryState` appears in 13 files with approximately 62 references and owns a focused real-SQLite lifecycle without requiring a Git repository.
`createInitializedRepo` and `candidateReadyRepo` serve different contracts because they include actual CLI initialization and Git identity.
Portfolio work should preserve that distinction while consolidating repeated owner record construction within the SQLite-only suites.

`runTestProcess` creates an isolated HOME, temporary directory, and XDG directory tree for every invocation in addition to launching the child process.
Batching repeated tool invocations therefore removes filesystem setup and cleanup as well as process startup.
At least 15 test files call `runTestProcess` and at least 15 call `runTestProcessOrThrow`, while real subprocess use must remain limited to the boundaries named by `VERIFICATION.md`.

Several suites define a local generic `git` wrapper over `runTestProcessOrThrow`, and `candidateReadyRepo` exports another generic wrapper used by three Candidate Validation test files.
This repetition is small and does not by itself justify a shared generic Git helper because named repository-state operations may provide a more truthful and smaller test interface.

Six suites define local `initializedRepository` builders for Agent Session, Change Implement, Change Cleanup, Change Start, Snapshot Workspace, and Disposable Workspace behavior.
They repeat Git initialization, identity, branch, and commit mechanics but differ in Repo Config, remotes, `.gitignore`, worktrees, and persisted state.
Compare a small base committed-repository builder plus owner-specific named states with retaining the local builders; do not introduce one option-driven repository factory.

`test/support/testGit.ts` is used only by Task Review, Candidate Acceptance, and Candidate Specialist suites for registered worktree lifecycle and cleanup.
It should remain a narrow registered-resource teardown scope rather than become a product restoration harness.
Task Review and Validation workspace identities remain distinct, while `restoreDisposableWorkspace` and its Adapter suite own actual restoration mechanics.

The publication policy suite already separates a cloned captured-Git fixture from a real-Git sentinel and keeps publication-specific state helpers local.
Preserve that boundary split while reducing any repeated publication scenario data; combining the two fixtures would weaken evidence or make ordinary scenarios more expensive.

The Change Submit orchestration suite correctly uses captured Adapters rather than repository setup, but its dependency builder accepts approximately 20 optional scenario fields and returns broad default authority, persistence, publication, GitHub, Git, capture, target, and lock behavior.
Its simplification question is whether named scenario deltas and smaller operation inputs can remove fixture branching and unused defaults, not whether to add real Git or a broader shared harness.

Several fixture parameters carry retired or incidental setup data without affecting behavior.
Examples include `_repositoryRoot` and `_updatedAt` in `test/support/repository.ts`, six timestamp parameters in `test/support/changeInspectionFixture.ts`, `_at` in the publication completion helper, and `_reviewer` in the Specialist output failure helper.
Remove these parameters with their caller arguments when the owning portfolio is migrated rather than preserving them in consolidated interfaces.

## Existing work and overlap

Change `BY-C61` and Task `BY-68`, "Stop and await long-running test processes," were cancelled because the remaining fixture-local risks did not justify continuing the broad process-lifecycle Change.
Retain its evidence when evaluating process helpers, but it no longer blocks consolidation work.

`plans/system-simplification-plan.md` already identifies verification setup caused by broad use-case objects, callback loaders, fixed-storage ports, construction-only Effect services, Layer topology, and test-only production flexibility.
This plan must distinguish consolidation possible within the current production structure from setup that should disappear only when an accepted production simplification removes the seam.

Tasks BY-85 through BY-88 were cancelled because their broad scopes did not identify exact retained evidence and removal boundaries.
No replacement consolidation Task is currently recorded.

## Responsibility portfolio ledger

SQLite, Git, process, fixture, duplicate, and table-shaped inventories are analysis lenses rather than owners of retained evidence.
Each retained check must be allocated to an owner operation or genuine shared capability.

| Responsibility portfolio | Protected boundary | Consolidation state |
| --- | --- | --- |
| Repository Runtime and Shared Repository State | Real SQLite transactions, migration baseline, persisted decoding, identity, locks, and resource lifecycle. | The release baseline is complete; retained migration evidence owns the baseline plus immutable ordered post-baseline migrations without duplicating operation behavior. |
| CLI routing and output, executable, and installed package | Direct result mapping and in-process routing at cheap seams; real process for executable and stdin; packed installation for installed assets and behavior. | Boundary map complete; global lookup and release Tasks BY-14, BY-15, and BY-17 remain unresolved. |
| Task core operations | Identity, lifecycle, Context, dependencies, revision, reads, lists, command presentation, and approved-Task state. | Owner map complete; broad `TaskUseCases` and passed-Review setup depend on operation-first migration. |
| Task Review | Policy, proposal identity, reusable judgment, admission, Review outcome, workspace sequence, and durable result. | Reviewer mechanics allocated; the configuration-table probe supports a 52-line reduction, but permanent retention of the current broad supported-operation sentinel is not established. |
| Shared Agent Session and agent execution | Dispatch, continuation, transcript, Invocation settlement, token evidence, Pi transport, Herdr protocol, profiles, and runtime contracts. | Owner map complete; transcript, process, socket, SDK, and host-policy layers remain distinct. |
| Task/Change coordination | Linked start, cancellation, reconciliation, exact merge observation, linked completion, and coordinated atomicity. | Reconciled across cancellation and Reconciliation; exact-ID Discard is established, and cancellation uses lock-protected remote observation plus idempotent retry without a new recovery state. |
| Change Start and Candidate capture | Managed Worktree creation and recovery, frozen starting policy, exact Base and Candidate provenance, dirty state, and branch identity. | Real-Git and SQLite boundaries mapped; full-operation versus direct Adapter cases remain to be reduced. |
| Candidate Validation | Exact-Candidate fixed-gate sequencing, Repository Preparation, Checks, Acceptance, Specialists, Validation state, and Snapshot Workspace lifecycle. | A provisional 39-case, 11-file, approximately 3,800-line retained design is reconciled; its final entry point depends on operation-first migration. |
| Publication and GitHub delivery | Eligibility, metadata, durable markers, target identity, uncertain mutation recovery, PR classification, local publication Git, and destination binding. | Boundary map complete; marker scenarios and minimum real-Git operation sentinel remain. |
| Terminal Cleanup and Discard Work | Exact destructive authority, work and evidence preservation, cleanup delegation, retry, idempotence, and non-persistence. | Owner design is reconciled: Discard requires one exact ID for one attempt, while cleanup persistence failure leaves the existing pending state for complete idempotent retry without another recovery representation. |
| Contributor test infrastructure and repository-authored tooling | Capacity lock, three-worker scheduling, disposable workspace cleanup, process isolation, package-safe execution, and repository diagnostics. | Owner and harness allocation is reconciled; the Vitest ast-grep matrix contracts to at most one configured-scan sentinel, two unused process routes are exact deletions, and no direct `maxWorkers: 3` assertion currently exists. |

## Cross-cutting analysis lenses

| Lens | Current finding | Constraint |
| --- | --- | --- |
| SQLite and durable-state setup | At least 31 files and approximately 15,400 lines use SQLite-related capabilities; broad ports, Layers, and generic durable graphs are obsolete under ADR 0013. | Keep one isolated SQLite state scope and owner-local scenarios, not shared mutable state or universal graph builders. |
| Git and repository setup | Workspace, registered worktree, initialized repository, Candidate-ready, publication, and cleanup states share syntax but not owner lifecycle. | Retain workspace scope and registered test worktree teardown; do not retain `candidateReadyRepo` or source-process initialization as universal vocabulary. |
| Process and package execution | Source, built, process-helper, agent-runtime, SDK, and installed-package boundaries are currently mixed in `by-cli.ts` and related helpers. | Use real processes only for the boundaries in `VERIFICATION.md`; cancelled BY-C61/BY-68 no longer blocks deletion of unused routes, while installed-package and release work still constrain retained sentinels. |
| Duplicate evidence and table-shaped mechanics | Native ast-grep tests own per-rule matcher behavior, while 20 Vitest rows repeat that behavior and configured-scan setup; exact duplicate Change command cases and duplicated Agent reviewer evidence are also confirmed. | Delete proven duplicate rule evidence, retain at most one configured-scan sentinel for distinct path and language partitions, and apply mechanics-only reductions inside the owning portfolio rather than create a cross-cutting cleanup unit. |

## First exact reduction: duplicate ast-grep verification

The Vitest ast-grep sensitivity table creates 20 temporary repositories and launches `pnpm exec ast-grep scan` once per row.
The authoritative native rule portfolio in `ast-grep/tests/structural-bans-test.yml` already exercises every unique rule ID represented by the Vitest table with broader valid and invalid examples.
The `ast-grep-check` package script runs `ast-grep test --skip-snapshot-tests && ast-grep scan`, and the Just workflow owns that check.

The reviewer experiment consistently found one potentially distinct integration fact: configured scan discovery across the `src`, `test`, `extensions`, and `scripts` paths and TypeScript or JavaScript language partitions.
Replace the 20-row per-rule Vitest matrix with at most one combined configured-scan sentinel covering only those distinct partitions, and remove per-rule matcher expectations already owned by native ast-grep tests.
Retain the native ast-grep rule tests and repository scan.
Retain the separate Effect diagnostic, Biome plugin, health-report, recipe, and shell-script cases because the removal-first audit did not establish another owner for those checks.
The existing disposable probe already established that one combined scan preserves all current expected matches while reducing 20 process launches to one.

## Reviewer execution and judgment mechanics

The first mapped group contains `test/validation/acceptance-review-phase.test.ts`, `test/validation/candidate-acceptance-review.test.ts`, `test/validation/candidate-specialist-review.test.ts`, and `test/task/task-review-submit.test.ts`.
Together they contain 37 tests and approximately 3,574 lines, with approximately 35.57 seconds of summed per-file span in the fresh concurrent profile.
The files do not form one portfolio because Task Review, Acceptance Review, and Specialist Review retain separate policy, prompts, output decoding, Findings, lifecycle, and persistence ownership.

The shared mechanics under inspection are Agent Invocation execution and settlement, structured-output correction, disposable workspace restoration, Candidate or Review Base identity verification, Artifact recording failure, reviewer runtime failure, and fresh or continued Agent Session handling.
Candidate Acceptance and Specialist suites both construct the full Candidate Validation Layer through the 99-line `candidateValidationForTest` helper, which reproduces construction-only Effect service and Layer topology that accepted ADR 0013 requires Candidate Validation to remove.
Do not deepen or generalize that helper; coordinate its deletion with the operation-first Candidate Validation migration.

The phase-level Acceptance harness exposes approximately 23 optional override fields, including persistence, session, workspace, policy, authority, Artifact, and command concerns.
The Specialist harness similarly accepts a partial copy of its complete production input.
Both files contain near-parallel default Agent Invocation persistence and captured Git workspace command behavior.
These broad option bags make many locally invalid combinations constructible and require each test reader to determine which defaults are material.
The preferred replacement is not one larger cross-reviewer option bag, but smaller named scenario builders after shared production mechanics and owner-specific inputs are established.

Acceptance, Specialist, and Task Review suites each retain real workspace restoration scenarios around retries or interruption.
Each owning workflow needs evidence that it requests restoration at the required sequence point, but current evidence has not established that every workflow needs multiple real-Git mutation scenarios after the shared disposable-workspace owner proves restoration mechanics.
The review must separate workflow sequencing assertions with captured Adapters from the smallest real-Git integration sentinels.

The Acceptance phase oversized-context process test overlaps the Pi process executor's existing test that preserves prompts larger than 128 KiB.
The Acceptance suite may still need one normal producer integration sentinel, but prompt transport size belongs to the process executor unless the complete Acceptance path introduces a distinct size limit.

Acceptance phase tests classify Findings, runtime failures, output-contract exhaustion, Artifact failures, Invocation settlement, Candidate identity, and post-review integrity.
Candidate Acceptance tests then repeat Finding and Tooling Failure outcomes at the durable Validation boundary, while Specialist tests exercise similar outcomes plus ordered stopping, prior Findings, successor Candidates, and multi-reviewer restoration.
This layering may protect distinct phase and persistence facts, but the repeated setup and end-to-end scenarios must be reduced to one cheapest owner seam for each classification plus distinct integration facts.

Task Review submission combines reviewer mechanics with Task-specific judgment reuse, policy capture, dependency and proposal identity, Review Base preparation, Task Agent Session continuation, and New-to-Todo settlement.
Only the shared Agent Session and workspace mechanics belong in the cross-reviewer consolidation analysis.
Task proposal identity, reusable judgment, Task policy, and lifecycle behavior remain a Task Intent portfolio.

Four adjacent Task Review configuration failures each rebuild a Git repository, initialize Shared Repository State, commit Repo Config, write a proposal, create a Task, submit it, and verify that no Review was admitted.
The cases vary primarily by missing default Agent Profile, missing guidance, directory guidance, or missing Agent Profile resource.
A bounded disposable prototype replaced the four blocks with one four-row table and a narrow `setupTaskReviewConfigurationFailure` helper without production changes.
All four classifications and `task.review: null` assertions passed, while the section fell from 175 to 123 lines and the file from 1,447 to 1,395 lines, a net 52-line reduction.
The focused baseline reported 3.23 seconds and the prototype 2.40 seconds, but differing cache and temporary-directory conditions make that timing non-comparative.
The table centralizes expected-message assembly and genericizes fixture commit messages, so the final design must keep each classification legible rather than optimize only for line count.
The larger effective-policy scenario also combines policy selection, progress presentation, passed Review inspection, blocked Finding persistence, and Task lifecycle settlement, so its protected facts must be allocated before its setup becomes a shared helper.

The existing `test/validation/disposable-workspace-git.test.ts` suite already owns the real-Git restoration mechanics: restoring tracked and staged state, removing non-ignored untracked files, preserving ignored files, and resetting a changed detached HEAD to the exact expected commit.
Reviewer workflow suites therefore need to prove when restoration is requested and how restoration failure affects their owner result, not repeat every Git mutation that the Adapter suite already establishes.

The smallest currently supported owner allocation is as follows.

- Agent Session persistence owns continuation usability, Invocation ordering and settlement, interruption transcript discovery, frozen configuration, token evidence, and retry journals without any Git restoration concern.
- The disposable-workspace Git Adapter owns real worktree restoration mechanics and exact-commit cleanup.
- Task Review owns restoration before an output-correction retry, final restoration before durable completion, interruption classification, and restoration-failure settlement.
- Acceptance Review owns restoration before correcting invalid Acceptance output and the resulting durable Validation outcome.
- Specialist Review owns restoration between retries and before the next ordered Specialist, stopping after restoration failure, and interruption settlement.

Most Task, Acceptance, and Specialist sequence facts can use a captured restoration Adapter that records calls and returns success or failure.
At most one real-Git sentinel per distinct workspace identity is justified unless a workflow adds a different mutation or cleanup mechanism.
The current Task Review retry and three-scenario final-restoration tests, Candidate Acceptance retry test, and Specialist interruption and multi-reviewer tests occupy approximately 566 lines across five lexical tests and seven executed scenarios.
They repeat the Adapter's tracked, staged, and untracked cleanup assertions while also checking distinct sequencing, so they are candidates to retain the sequencing with captured Adapters and delete repeated mechanics.

A bounded Specialist Review prototype retained the interrupted-reviewer real-Git integration sentinel and replaced the multi-reviewer case's repeated Git checks with captured restoration events.
All nine Specialist tests and all six unchanged disposable-workspace Git tests passed.
The Specialist file fell from 947 to 915 lines, top-level Git executions fell from 309 to 177, successful process executions fell from 483 to 303, and the median of three untraced focused runs fell from 11.587 to 9.745 seconds.
The prototype retained restoration after interruption, two correction retries, restoration before the next Specialist, ordered result settlement, and stop-on-restoration-failure behavior.
It deliberately stopped proving real Git cleanliness before every multi-reviewer invocation because the Adapter suite owns staged, tracked, untracked, ignored-file, exact-commit, and detached-HEAD mechanics.
This supports the allocation for Specialist Review but does not establish full-suite impact under three concurrent workers.

`test/agent/agent-session-supported-operation.test.ts` remains the one Task Review real-workspace wiring sentinel because it joins the supported Task Review operation, Agent Session, disposable workspace operations, Pi process, persistence, and projection.
The disposable-workspace Adapter suite owns real-Git restoration mechanics, while Task Review owner tests record restoration sequencing and settlement.
No additional Task Review real-mutation sentinel remains, because it would repeat the Adapter's mechanics without protecting another supported boundary.

## SQLite persisted-state portfolio

At least 31 test files directly use SQLite capabilities, `RepositorySql`, `DatabaseSync`, SQLite Adapters, or `withTemporaryRepositoryState`, totaling approximately 15,400 test lines.
The current files cover Repository Runtime transactions, Shared Repository State identity and migrations, execution locks, Task and Task Review persistence, Agent Sessions, Candidate and Validation Run state, Change authority and coordination, publication, and Artifact lifecycle.
These responsibilities require separate owner portfolios rather than one SQLite test suite.

Real SQLite is materially required for SQL binding and failure behavior, transaction commit and rollback, atomic owner transitions, persisted identity and relationships, migration application and contention, schema constraints, and operation-specific decoding of stored representation.
`test/repository/sqlite-json-string-array.test.ts` and `test/repository/sqlite-stored-json-contracts.test.ts` call codecs directly and protect representation semantics without exercising SQLite.
`test/repository/repository-sql.test.ts` separately proves that a malformed encoded string array crosses the Repository Runtime boundary as `RepositoryPersistedDataInvalid`.
The direct codec and typed boundary tests therefore share malformed examples but protect different facts.

`withTemporaryRepositoryState` appears in 13 files and already owns an isolated real-SQLite lifecycle without Git.
Sharing one mutable database across tests would couple identities, lifecycle state, ordering, and cleanup, so the consolidation target is repeated state construction within isolated scopes rather than cross-test database reuse.

Direct `INSERT INTO changes` setup appears in at least 13 test or support files.
Candidate, Validation Run, phase-result, Task Review, and Agent Invocation graphs are also rebuilt in several owner suites through both public persistence operations and raw SQL.
The repeated syntax is not enough to justify a generic graph builder because the tests require different authority, lifecycle, relationship, and malformed-state semantics.
Named owner-state scenarios should concentrate only the durable facts genuinely shared by their consumers.

`test/support/changePorts.ts` and `test/support/changeValidationPorts.ts` contain approximately 154 lines that reconstruct broad collections of SQLite persistence ports for tests.
Accepted ADR 0013 removes the architectural entitlement for these broad fixed-storage port collections.
Their consumers should migrate with operation-first application boundaries rather than receive a consolidated replacement dependency bag.
The 99-line `candidateValidationForTest` Layer graph has the same constraint.

`test/repository/sqlite-candidate-validation-decoding.test.ts` deliberately sends malformed Validation Run authority through Run reads, validation start, passing-evidence selection, and publication reservation.
Accepted requested-projection rules no longer justify rejecting unrelated malformed history through every consumer.
Each corruption case must be assigned only to operations that consume that exact representation or relationship, which may remove the current all-consumer assertion helper after operation-first migration.

Agent settlement kind, harness, thinking, linkage, ownership, and rollback corruption appear across Agent Session, Task Review, and Change Validation suites.
Shared Agent Invocation representation decoding belongs to Agent Session, while Task Review and Change Validation retain owner-specific linkage, journal, phase, and atomic settlement semantics.
This split supports one shared representation portfolio plus the smallest distinct owner-journal cases rather than repeating all malformed Agent fields through each consumer.

`test/repository/sqlite-validation-ownership.test.ts` contains approximately 1,089 lines in eight tests that combine many invalid phase, producer, Finding, Artifact, Tooling Failure, Invocation, and completion variants with repeated unchanged-state assertions.
Real SQLite remains required, but visible scenario tables and named state readers may reduce incidental setup after each failure is assigned to its exact owner rule.
Task Review atomic settlement and Change Validation atomic settlement both need owner-specific journal evidence, so their similar rollback shape is not by itself duplicate evidence.

The migration owner suite owns the exact supported baseline, ordered post-baseline migrations, resulting schema, constraints, indexes, and ledger contract.
It must not become a second behavior suite for every operation, and operation tests must not repeat schema shape assertions unless an observable owner contract depends on that shape.
The exact division between baseline constraints and operation-specific malformed-state behavior remains to be reconciled.

## Change and linked-Task inspection findings

`test/change/change-inspection.test.ts` contains ten tests and 839 lines, while `test/support/changeInspectionFixture.ts` contains 497 lines of raw-SQL state construction and command setup used only by this portfolio.
The test file calls `runInspectionCommand` 30 times, and that helper launches the source CLI in a new process with a new isolated process environment for every call.
The file separately calls `runByInProcessEffect` 14 times for scenarios that use a fully initialized repository.

The ten tests do not form one responsibility portfolio.
They currently cover Submission lock exclusion for Decisions and Blockers, Task Context independence, invalid Change ID presentation across four commands, Managed Worktree inference, Change list and show projections, current passing Validation judgment and history ordering, frozen Change policy authority during Submission, Decision persistence and presentation, Decision and Blocker command usage, and linked-Task Change Activity transitions.
The final linked-Task scenario also covers Blocker history, Acceptance Context derivation, Validation state, Change closure, Task completion, and omission of Change Activity after closure in one approximately 160-line test.

The support module deliberately writes only rows consumed by inspection, which avoids executing unrelated production workflows.
However, it exposes eleven state mutation helpers, repeatedly opens the SQLite runtime for individual fixture operations, carries several timestamp parameters that are no longer used, and reproduces Change, Candidate, Validation Run, Finding, Tooling Failure, Decision, Blocker, Acceptance Context, and Task completion semantics.
The fixture's size is therefore evidence of both useful narrow state setup and substantial durable-domain knowledge outside the owning implementation.
The correct simplification depends on the operation-first and private state-kernel decisions rather than on extracting a larger generic fixture.

A bounded disposable probe replaced the fake-Git source-process command helper with a real disposable Git repository and `runByInProcessEffect`.
All ten tests passed.
The focused baseline completed in 48.294 wall-clock seconds, while the probe completed in 8.463 wall-clock seconds, an observed reduction of approximately 82 percent.
The helper change also removed 28 net lines by deleting the generated fake-Git shell script and process-environment wrapper.
This single-run probe establishes that source-process execution is unnecessary for these command assertions, but it does not establish which tests or fixture operations should remain after portfolio ownership is reconciled.

The next mapping must compare each protected fact with Change Start, Change locking, Task/Change coordination, validation inspection, CLI result-contract, and persistence tests.
Retain only a small end-to-end CLI projection sentinel after the owner portfolios establish which routing and serialization failures remain plausible and material.

## Change workflow portfolios

The mapped Change Start Managed Worktree, Submit orchestration, Cleanup Git, Reconciliation, and Terminal Cleanup files contain 96 lexical test declarations across 4,928 lines.
They form five owner portfolios with different required boundaries rather than one reusable Change workflow fixture.

`test/change/change-start-managed-worktree.test.ts` contains 27 declarations across 900 lines.
It combines full Change Start behavior for policy and remote resolution, linked Task capture, fresh-base selection, Managed Worktree creation and recovery, branch preservation, stale registration, path conflict, symlink safety, and Git tooling failure with ten direct `provisionChangeWorktree` Adapter cases near the end of the file.
The full-operation evidence requires real SQLite and Git, while the direct cases own lower-level Git and path behavior.
Compare those layers with the captured orchestration in `test/change/change-start.test.ts`, but do not replace the distinct initialized-repository states with one option-driven factory.

`test/change/change-submit-orchestration.test.ts` contains 25 lexical declarations across 1,699 lines and requires captured collaborators rather than real Git, SQLite, or a child process.
It owns Submission ordering, locking, exact Candidate and Base identity, no-change and dirty outcomes, validation routing, frozen policy and resources, publication and pull-request identity, Findings, Tooling Failures, and Blocker handling.
Its `dependencies` helper accepts approximately 20 optional scenario fields across authority, persistence, publication, GitHub, Git, Candidate capture, target selection, refresh, and locking, while `readyChange` permits arbitrary `Partial<ChangeRecord>` overrides.
This is the clearest Change-side candidate for smaller named scenario deltas and visible event assertions, but the operation-first migration may delete part of the broad dependency surface rather than justify a replacement fixture.

`test/change/change-cleanup-git.test.ts` contains 28 declarations across 1,093 lines and correctly requires isolated real Git for worktree and path cleanup, sibling and Shared Repository State preservation, dirty-work protection, branch reachability and races, branch configuration, stale registrations, ordering, remote identity, and one-attempt discard behavior.
A focused committed-repository builder and named remote-result states can reduce repeated initialization and input records without sharing mutable repositories between tests.
Three child-process race arrangements are test mechanisms rather than executable contracts.
Their retained process boundaries are justified by current-cwd and `PATH`-injected Git race behavior, while the two unused historical process routes can be deleted immediately.

`test/change/change-reconciliation.test.ts` contains six declarations across 748 lines and requires isolated real SQLite for merged Change and linked Task atomicity.
Five cases repeat Change preparation, broad SQLite Change test dependencies, Candidate and Validation records, publication identity, and the complete reconciliation dependency object.
A narrow persisted published-Change setup is credible, but linked Task completion, unlinked completion, Blocker preservation, cleanup retry, exact pull-request observation, and closed-unmerged handling remain distinct owner facts.
The current `openSqliteChangeTestDependencies` aggregation is migration work under ADR 0013 and must not become the foundation of the new scenario vocabulary.

`test/change/terminal-cleanup.test.ts` contains ten declarations across 488 lines and ordinarily needs only captured Change, Artifact, persistence, and Git-cleanup Adapters.
It owns exact resource delegation, absent or present Remote Change Branch behavior, pending cleanup, Artifact failure and retry, idempotence, open-Change rejection, persistence failure, and cancellation handoff.
Its complete `changeRecord` and broad cancellation dependencies carry many publication, policy, GitHub, and validation facts irrelevant to narrow cases; owner-specific minimal records can remove that incidental setup without moving real Git behavior out of Cleanup Git.

The controlling overlap allocations are these.

- Change Start owns Managed Worktree creation and recovery, while Candidate Capture owns exact Candidate provenance and dirty or branch identity.
- Submit owns validation and publication ordering, short-circuiting, and observation of an exact merged owned pull request during Submission, while Reconciliation owns independent later observation; Task/Change coordination owns the shared atomic completion transition.
- Cleanup Git owns actual resource mutation, while Terminal Cleanup owns exact delegation, Artifact lifecycle, persistence, retry, and idempotence.
- Cancellation owns leaving cleanup pending without executing it, while Terminal Cleanup owns the later retryable operation.
- Reconciliation locking and discard suites retain lock acquisition, reread, interruption, discard authority, and no-persistence facts outside the core merge-observation portfolio.

A focused deep audit measured the adjacent Change Start, Candidate Capture, Change Implement, and Implementer Prompt scope at nine files, 2,935 test lines, 59 lexical registrations, and 66 expanded cases.
Its 48 real-Git-backed and 40 SQLite-backed scenario executions, 67 in-process source CLI calls, and 126 explicit Git-helper call sites concentrate primarily in Change Start.
The existing Change Start trace executed 713 processes including 525 Git commands.
The four related support modules add 234 lines, although the 43-line Candidate Capture helper also serves Validation and Publication and must be counted only once.

Change Start should contract from three files, 1,437 lines, and 36 cases to one file, approximately 600 to 700 lines, and about 15 expanded cases.
Approximately five complete-operation cases retain exact-base policy failure, persisted provisioning failure, retry identity, linked Acceptance Context capture, and branch-preserving recovery.
A small direct real-Git safety matrix retains sibling placement, stale registration, missing or elsewhere-attached branches, conflict and symlink refusal, recorded-branch commit preservation, and tooling-error classification required by ADR 0007.
The captured `ChangeStartGitOperations` and `ChangeStartPersistence` orchestration file and its replacement Layers are not retained under ADR 0013.
Reviewer-configuration facts move to Change Start for frozen exact-base policy and linked Acceptance Context, to config owners for validation, and to one consumed-corruption or invalid-write SQLite case rather than remaining a mixed Git, config, codec, and persistence suite.

Candidate Capture's current two files, 461 lines, and eight cases include Change discovery, reflog rename discovery, rebinding, caller-selected bases, and remote-default discovery rejected by ADR 0013.
A retained exact-Candidate operation must instead verify the exact Change, Managed Worktree, Repository Branch, Change Base ref, freshly fetched Change Base commit, dirty and branch state, Git Common Directory, ancestry, reuse, and atomic persisted-identity recheck.
Candidate Capture remains one focused owner suite because exact capture is a distinct supported operation consumed by complete Submit, while Submit owns only its ordering with validation and publication.
That suite should retain approximately five real-Git and real-SQLite cases for exact provenance, reuse, and atomic identity recheck; preserving the current discovery and rebinding suite is not an option.
The 43-line `candidateCapture.ts` test helper disappears after its Validation and Publication consumers migrate and must not be double-counted.

Change Implement and Implementer Prompt currently occupy four files, 1,037 lines, 15 lexical registrations, and 22 expanded cases.
The ordinary operation should retain one complete real-SQLite launch, one no-launch invalid-profile integration, preparation-failure and optional-text prompt assembly, the exact 256-KiB boundary, Implementer-specific empty-byte, BOM, and NUL policy, and cheap semantic result mapping.
The Operator accepted the public configuration contract: Change Implement must load Interactive Session selection and Repo Agent Profiles from the Change Managed Worktree Repo Config, then apply Global Config fallback.
Current production instead uses the invoking checkout's Repo Config and validates its selected resources relative to the Managed Worktree, so that path and the test asserting that Managed Worktree Repo Config is not decoded are defects to replace.
Agent Profile owns general precedence and resource validation, text input owns generic file and stdin mechanics, and Herdr host and socket suites own lifecycle and uncertain transport outcomes.
The optional real-Herdr sentinel remains separate.
The current compiled stdin-to-Herdr sentinel should not survive as a second executable boundary if the installed-package representative operation absorbs real stdin and socket transmission; until that installed replacement is established, its distinct joined evidence remains protected.
This reconciles the focused audit's concern about deleting the only joined stdin path with the package audit's stronger proposal to prove the path through the shipped artifact.
`implementer-prompt-file.test.ts` and the 98-line broad Implement fixture then disappear, while the separate fake Herdr API process remains necessary for a synchronous executable caller.

The focused audit's standalone smallest shape is five files, approximately 1,550 test lines, 24 lexical registrations, and 30 expanded cases, with about 21 real-Git and 16 SQLite-backed scenarios.
That standalone number overlaps the broader Change redesign through both Candidate Capture files and overlaps the continuation and Herdr redesign through Change Implement sentinels, so it must not be added directly to the aggregate model.
Its proportional estimate of 300 to 350 Change Start processes and 220 to 270 Git commands is a planning estimate that requires a focused trace after migration.

A broader redesign audit measured 22 Change delivery, Publication, GitHub, inspection, Reconciliation, cancellation, cleanup, and CLI result files at 11,914 test lines, 198 declared blocks, 275 expanded cases, and 817 related support lines.
It found that the current suite substantially protects fixed ports, broad factories, composition loaders, mutable target discovery, optional Candidate discovery and rebinding, and duplicate merge interpretation that ADR 0013 removes.

The smallest coherent redesign is approximately nine files, 70 to 80 expanded cases, 3,200 to 3,600 test lines, and 150 to 220 related helper lines.
That is an estimated 59 percent reduction in files, 71 to 75 percent in cases, 70 to 73 percent in test lines, and 73 to 82 percent in related helper lines within this measured portfolio.
Estimated process and Git reductions are approximately 65 to 75 percent, while SQLite statement reduction is approximately 55 to 70 percent.
These are design estimates anchored by the measured file and helper inventory, direct Git and CLI sites, and focused dynamic traces, not an implemented prototype.

The proposed retained shape is one complete-operation Submit suite, one Reconciliation suite that absorbs locking and Discard, one cancellation suite, one focused real-Git cleanup suite, one real-SQLite inspection projection suite, one cheap owned-pull-request classifier table, one consolidated GitHub command and recovery suite, one semantic CLI result suite, and the Artifact lifecycle owner suite.
Separate Candidate capture orchestration, Candidate capture integration, Discard CLI and operation, Reconciliation locking, Terminal Cleanup orchestration, mutable GitHub target, local publication Git, publication policy, push destination, current Candidate selection, and separate Change result files disappear after their distinct facts move to those owners.
The retained semantic result suite is conditional on simplifying the production result surface; exhaustive result variants must not be deleted while the supported contract still exposes them.

Candidate capture should accept only the exact Change, Repository Branch, Managed Worktree, and freshly fetched Change Base selected by Submission.
Current optional Change discovery, branch rebinding, reflog recovery, caller-selected bases, and mutable remote-default discovery protect flexibility rejected by ADR 0013 and ADR 0007.
Submission and Publication currently repeat validation eligibility, pending marker, revised Candidate, reuse, and uncertain recovery behavior through fake orchestration and internal ports.
The complete Submit operation should own ordering while a private publication state kernel owns durable uncertain-mutation meaning.
ADR 0008 requires both Submit and Reconciliation to recognize exact merged owned pull requests through the shared classifier.
They retain distinct observation triggers while Task/Change coordination owns one atomic completion transition; consolidation must remove duplicated interpretation without deleting either supported trigger.

Change inspection should use projection-specific bounded queries for list, detail and current judgment, Validation history, and joined Task activity.
Its current per-Candidate Run loading, 497-line raw-SQL helper, fake Git executable, and 30 child CLI calls should disappear rather than migrate into another fixture.
Real Git remains mandatory for exact capture, push safety, and destructive cleanup, while captured command Adapters remain sufficient for GitHub response decoding and uncertain recovery.
The local cleanup suite can contract from 28 cases to approximately nine consequential safety classes without moving dirty-work, unique-commit, discard, path, symlink, compare-and-delete, or remote-target risks to mocks.

The redesign removes approximately 567 measured production lines of structural port, store, and composition shells in addition to test reductions, but private owner SQL and durable tables remain.
It also removes `changeInspectionFixture.ts`, broad Change and Validation test-port registries, Terminal Cleanup test composition, and eventually Candidate capture and Candidate-ready helpers after all Validation consumers migrate.
No obsolete persistence representation is retained merely to preserve these source seams.
The completed release baseline and immutable post-baseline migrations remain governed by ADR 0009 and repository migration policy.

## CLI and installed-package portfolios

The CLI evidence has three materially different boundaries.
Generated command routing, parser failures, help, version result construction, text policy, result serialization, and ordinary application orchestration can use direct command or in-process application seams.
The executable boundary requires a child process for `argv`, cwd, environment, stdin, stdout, stderr, exit state, and process-tree behavior.
The package boundary requires a built and packed artifact, with installation required for bin resolution, installed resources, runtime loading, migrations, and installed Shared Repository State behavior.

`test/repository/process-isolation.test.ts` and `test/support/testProcess.ts` own HOME and XDG isolation, cwd rejection, timeout, output-buffer, missing-executable, process-group termination, and subprocess cleanup mechanics.
Those facts cannot move to `runCli`.
The cancelled BY-85 through BY-88 work does not block deleting the two unused historical routes, while the retained process-isolation helpers remain owned by this boundary.
`test/change/change-implement-process.test.ts` currently retains a distinct compiled-executable stdin-to-Herdr sentinel through `runBuiltByWithInput`.
The preferred retained allocation moves that joined stdin and socket fact into the installed-package representative operation, after which the source-built sentinel becomes duplicate process evidence and can disappear.
Ordinary classification, routing, orchestration, and retry assertions do not require either process boundary.

`test/repository/package-contents.test.ts` is already consolidated around one shared build, `npm pack`, and isolated prefix installation.
Its six tests allocate packed allowlist and lazy module-graph facts, installed executable guidance, installed initialization and migration state, linked-worktree invocation, and packaged continuation assets.
Prior commits `5d1614ce` and `347598d9` already removed separate CLI-loading and broad Task CLI process suites while retaining smaller package and executable sentinels, so further consolidation must not recreate those deleted boundaries.

The current package test invokes the explicit installed `node_modules/.bin/by` path under an isolated `--prefix` installation.
It does not establish global `PATH` lookup, while `plans/release-readiness.md` calls for an isolated global-install procedure and leaves the public `by --version` contract and version source unresolved.
Release Tasks BY-14, BY-15, and BY-17 must supply their exact accepted boundaries before this investigation selects final package sentinels.

`runBuiltByWithEnv` and `runJustBy` are exported by `test/support/by-cli.ts` but have no current test consumers.
They are deletion candidates, with `runJustBy` additionally representing a historical source-Just route that release planning no longer supports.
The broad `runByInProcessEffect` injection surface should contract through ADR 0013 operation migration rather than through a new universal CLI fixture.

The deep Repository Runtime, CLI, config, package, command, tooling, and infrastructure audit measured a standalone scope of 35 test files, 7,057 lines, and approximately 300 expanded cases after excluding five files substantively assigned to Task and Validation.
Its standalone retained estimate is approximately 27 files, 4,600 to 5,000 lines, and 185 to 200 cases, with modeled top-level child launches falling from approximately 123 to 79 to 82.
The remaining list still contains five Change result or storage-output files, four config files shared with Task or Validation, two config or submission files shared by both broader redesigns, and `cli-task-id.test.ts`.
Therefore neither its current nor retained totals are non-overlapping, and they must be reconciled path by path before entering the suite-wide aggregate.

The retained design uses dedicated release-baseline, shared-state, initialization-contention, execution-lock, and Repository Runtime suites but consolidates initialization edge cases and CLI initialization at the complete operation boundary.
It folds direct persisted codecs into one owner file, merges SQLite adapter and facade evidence where they protect one contract, and reduces nine Repository Runtime and initialization files from 1,929 lines and 48 cases to approximately seven files, 1,200 to 1,300 lines, and 30 to 35 cases.
Package and portable Pi skill evidence becomes one packed-artifact suite rather than testing a copied source layout.
Core CLI and output evidence contracts from five files and 484 lines to approximately three files and 280 lines, while Change result codecs contract from four files and 935 lines to approximately two files and 500 lines only after their supported result surface is simplified.
Text and recording inputs merge into one owner file, while host command and interruption remain separate real-process boundaries.

Config contracts retain five owner files but contract from 1,058 to approximately 600 lines by replacing fragmented success examples with complete canonical Global and Repo Config examples plus custom refinements and resolver precedence or failure rules.
The canonical examples must visibly include the supported `review.underengineer` contract, which current positive examples omit.
The current Specialist instructions failure expectation incorrectly says `Acceptance instructions file`; that wording is a product defect to correct, not an expected string to preserve through consolidation.

High-confidence whole-file folds include portable skill into package contents, recording text into text input, direct SQLite codecs into one file, contract diagnostics and storage mapping into one output suite, and initialization edge cases plus CLI initialization into one Repository Runtime suite.
Unique Change Submit error cases move into the retained result owner before the separate file disappears.
Unused support exports `byExecutable`, `testProcessEnvironment`, `builtByExecutable`, and `testRepositoryConfig` should stop being exported when direct consumers are removed.
The installed representative operation should exercise real stdin from the packed executable rather than preserve an unrelated dependency-guidance sentinel.

## High-confidence duplicate and table-shaped scenarios

Two exact duplicate assertions are currently established.
`test/change/change-inspection.test.ts` invokes the identical `task show BY-1` command twice without intervening mutation and repeats the same implementing Change Activity and omitted-field assertions, so the second read supplies no distinct protection and adds one current source-CLI launch.
`test/cli/change-submit-errors.test.ts` repeats the complete `nothing_to_submit` serialization already enforced by the exhaustive discriminant table in `test/cli/change-submit-result-contract.test.ts`; the other focused error cases retain additional evidence normalization and recovery-guidance facts.

Two Acceptance Artifact-recording failure tests in `test/validation/acceptance-review-phase.test.ts` strongly overlap across approximately 100 lines.
One additionally proves returned Invocation settlement and the failed-result input, while the other uses a different nested filesystem obstruction and the default phase fixture.
These are not established as exact duplicates, but one combined owner case may preserve both the settlement and durable phase-result facts without retaining two filesystem arrangements.

The following groups protect distinct rows but repeat mechanics suitable for visible tables or named scenario setup.

- Four Task Review configuration failures repeat complete repository initialization, Task creation, submission, and no-admission assertions for a missing default profile, missing guidance file, guidance directory, and missing profile resource.
- Two direct Acceptance configuration tests repeat fallback-prohibition and error classification for a missing instructions file and a directory at the configured file path.
- Three GitHub publication safety cases repeat captured gateway setup and no-mutation assertions for unexpected head, unavailable recovery observation, and unsafe destination facts.
- One SQLite Validation ownership test expresses approximately eight malformed phase-result inputs across approximately 195 lines before one unchanged-database assertion; real SQLite and every distinct owner rule remain required, but the rejection mechanics can become a visible scenario table.

Unused fixture parameters and fields should be removed with their callers rather than propagated into new helpers.
The confirmed examples already recorded in this plan are part of a broader set in `changeInspectionFixture.ts`; each broader removal still requires direct caller verification because some fields may document a future temporal distinction without affecting current behavior.

## Task Intent and coordination portfolios

The Task map separates pure identity and lifecycle rules, real-SQLite persistence, CLI presentation, real-filesystem Context Draft sequencing, Task Review durable results, and Task/Change coordination.
These seams should not be combined merely because they share Task records.

Task ID and lifecycle vocabulary need only pure unit evidence.
Task creation, reads, actionable ordering, filters, limits, dependency graphs, revision, rename, and Review history require real SQLite only when persisted identity, graph atomicity, lifecycle locks, or immutable history are the protected facts.
Command parsing, option forwarding, structured errors, help, dashboards, and ordinary result mapping can remain at direct command or in-process application seams without a child process.
Context Draft replacement requires a real filesystem to establish decoding, retention, deletion, and cleanup behavior, while its persistence transition is separately owned by SQLite tests.

Task/Change coordination owns linked-start eligibility, Task Context snapshotting, cancellation, and atomic completion.
Ordinary eligibility and completion facts require real SQLite, while only Managed Worktree creation and recovery require real Git.
Captured GitHub behavior is sufficient for cancellation and reconciliation classification.
The Task owner lifecycle lock and coordination's linked-Task rejection protect different authority boundaries even when their failure shape is similar.

`TaskUseCases` currently exposes ten operations plus `getTaskForInspection`, which aliases `getTaskById`, and `test/support/taskUseCases.ts` mirrors the whole interface with fallback behavior.
Accepted operation-first migration should remove this broad vocabulary and its CLI injection rather than produce a larger Task fake.
Likewise, the passed-Review helper in `test/support/repository.ts` creates a complete Review, Agent Session, Invocation, settlement, and completion to establish one approved Task.
A narrower approved-Task scenario may remove substantial setup, but it must preserve the durable passed-Review contract and remain owned by Task Review rather than become a universal repository fixture.

The strongest local table candidates are dependency rejection and CLI mapping matrices, Context Draft failure sequencing, revision target states, and the already-recorded four Task Review configuration failures.
Repeated create-versus-replace dependency command classifications remain distinct routing evidence, and Draft persistence failures retain file-preservation facts absent from ordinary Task persistence policy tests.
The mixed `test/cli/task-commands.test.ts` defaults should shrink by command responsibility rather than carry complete Review and cancellation records into every case.

The deep redesign measured Task owner evidence at 30 lexical cases, seven files, and 1,189 lines and proposes approximately 16 cases, three files, and 700 lines.
It merges tiny identity and lifecycle files into one domain suite and consolidates persistence policy, dependencies, revision, and only consumed-projection corruption into one real-SQLite state suite while retaining Context Draft filesystem sequencing.
CLI Task evidence measured 23 cases, three files, and 1,322 lines and contracts to approximately 12 cases, one file, and 600 lines by absorbing Task ID and dependency presentation into one command suite without re-proving persistence.
Task Review and Underengineer evidence measured 29 cases, four files, and 2,497 lines and contracts to approximately 17 cases, three files, and 1,500 lines through one persistence suite, one submission suite, and one small output and simplification contract suite.
Only one Task Review real workspace mutation sentinel remains; other cases record restoration sequencing while the Adapter owner proves Git mechanics.

Together with Agent Session, reviewer, and Candidate Validation redesign, the scoped Task and Validation audit moves from 213 lexical cases, 35 files, and 14,009 test lines to approximately 113 cases, 24 files, and 8,100 lines.
That is an estimated 47 percent case, 31 percent file, and 42 percent line reduction, plus 253 lines from deleting dedicated obsolete support modules.
The estimate is not an executed consolidated suite, but its current counts are measured and its retained owner facts are explicit.

Whole-file consolidation removes `task-dependencies.test.ts` after moving CLI rows to Task commands and durable rows to Task state, removes `task-persisted-data-decoding.test.ts` after retaining only corruption consumed by owner projections, and absorbs `cli-task-id.test.ts`, `task-id.test.ts`, `task-lifecycle.test.ts`, and `task-reviewer-output.test.ts` into their owner suites.
These are structural file removals rather than deletion of material ID, lifecycle, decoding, or output policy.
The broad `test/support/taskUseCases.ts`, `candidateValidation.ts`, and `changeValidationPorts.ts` modules then delete 253 measured support lines instead of receiving replacement dependency bags.
Estimated expensive-scenario counts across this scope fall from approximately 98 to 100 real-SQLite scenarios to 43 to 46, from approximately 51 to 54 real-Git-backed scenarios to 17 to 19, and from approximately 27 non-Git child-process scenarios to 16 to 18.
These are boundary-crossing scenario estimates rather than measured command counts; focused traces show that each removed Git scenario can eliminate many process executions.

## Publication and GitHub delivery portfolios

The five primary publication files contain approximately 3,641 lines and 67 lexical test declarations.
They divide into Publication operation policy and persistence, GitHub pull-request mutation and recovery, GitHub cleanup remote, target detection, local publication Git, and push-destination binding.

`test/publication/publication-policy.test.ts` uses real SQLite with captured Git and GitHub collaborators for publication metadata, Candidate eligibility, target consistency, pending and published markers, uncertain mutation recovery, reuse, reopening, and Validation evidence.
Its ordinary policy scenarios do not require a child process or real Git.
One complete publication sentinel uses real Git, while direct `local-candidate-publication-git.test.ts` and `push-destination-git.test.ts` own branch ancestry, upstream association, destination binding, and configuration-change mechanics.
The operation sentinel and local Adapter suite currently repeat upstream-association setup and assertions, so the minimum retained real-Git operation sentinel must be selected by the distinct integration fact rather than by duplicating every Adapter mechanic.

`test/publication/github-pull-request-gateway.test.ts` uses captured `runGit` and `runGh` to establish local-head preflight, repository and destination identity, response decoding, uncertain push and PR mutation recovery, secret redaction, and remote-branch cleanup safety.
A substantial cleanup-remote block exercises GraphQL `updateRefs`, deletion readback, and protected-branch behavior that belongs to Change Cleanup rather than PR creation and update.
This is a clear responsibility boundary even if the final file split remains open.
Target detection and owned-pull-request classification remain separate mapping layers.

Publication update uncertainty, creation recovery, malformed branch responses, unsafe destinations, uncertain cleanup responses, and missing or moved cleanup branches are scenario matrices rather than duplicate evidence.
Named publication marker states and small gateway-local request defaults can reduce repeated syntax while keeping target identity, mutation request, expected classification, and durable marker assertions visible in each row.
Do not combine the intentionally different SQLite-only and full-Git clone paths used by the Publication fixture.
Broad Change and Validation port collections used by the current fixture are operation-first migration work under ADR 0013.

The tests establish owner, repository, base branch, remote name, head, and publication marker relationships, but they do not establish whether remote URL is part of the durable publication target identity.
That is a domain decision outside this consolidation investigation and must not be inferred from fixture shape.

## Agent runtime and continuation portfolios

The 13 files under `test/agent` contain approximately 5,147 lines, dominated by the 1,198-line continuation extension harness, 970-line Herdr host suite, 714-line Pi executor suite, and 673-line Agent Session persistence suite.
These files do not form one generic agent-test portfolio.

Agent Session owns durable continuation identity, Invocation ordering and settlement, transcript usability and discovery, token evidence, frozen configuration, retry journals, and interruption recovery.
Its persistence evidence requires real SQLite and some real transcript filesystem behavior, but not Git workspace restoration.
The supported-operation test remains the one integration sentinel joining a real Task Review operation, Agent Session execution, transcript and token persistence, and the Review projection.
The deep redesign contracts the broader Agent Session and reviewer runtime scope from 48 cases, seven files, and 2,384 lines to approximately 29 cases, six files, and 1,500 lines.
Agent Profile becomes a visible precedence and resource matrix, Agent Session persistence retains approximately seven real-SQLite transaction and continuation cases without Git initialization, reviewer runtime retains approximately three captured-executor cases, and reviewer output retains only distinct shared contract classes.

Reviewer runtime owns prompt construction, executor invocation, output decoding, and usage translation.
Captured executors are sufficient for ordinary runtime classification.
The deep redesign removes `reviewer-agent-runtime-process.test.ts` because the supported Task Review operation and Pi executor already establish normal process integration, rather than retaining a third process sentinel.
The Pi process executor separately owns command shape, staged and oversized prompt transport, JSONL and stdin behavior, transcript discovery, usage parsing, uncertain process failure, and interruption cleanup through real child processes.
Its 16 cases contract to approximately ten consequential transport and transcript classes.
Its oversized-prompt case remains the transport owner; the Acceptance phase process case should remain only if a distinct Acceptance integration result is identified.

The shared reviewer output contract and Task Reviewer output contract overlap in schema-test mechanics but are not exact duplicates.
Task Reviewer intentionally rejects Artifact references and returns Task-specific error identity, while Candidate reviewers accept and resolve Validation Run Artifact references.
A shared core Finding scenario table is possible only if it keeps those owner-specific policies and error contracts explicit.

The Herdr host suite owns workspace and agent identity, native start, readiness, profile arguments, trusted-extension preflight, and recovery after uncertain mutations through injected command and prompt executors.
The Herdr socket suite separately requires a real Unix socket to distinguish no transmission, definite rejection, post-write timeout, mismatched response, and unknown result.
Host malformed-envelope and recovery matrices can shrink locally, but socket protocol evidence must not become host mocks.
Compiled-Candidate and optional real-Herdr tests remain separate integration sentinels.

Pure continuation policy tests own Change identity, Blocker state, visible Change Submit recognition, and retry fingerprints without a process.
The continuation extension harness owns Pi events, polling, pause and resume, durable custom entries, gates, and UI behavior.
The SDK test requires a real child process and actual Pi SDK loading.
Repeated extension event setup should be consolidated within its owner harness, not by replacing policy, extension, and SDK layers with one end-to-end suite.

Profile precedence, resource validation, schema decoding, and runtime-document synchronization remain separate responsibilities.
Precedence and missing-resource combinations are table-shaped, but Task, Acceptance, and Specialist policy resolution retain different owner semantics.
Package installation separately owns installed assets and extension availability.
The currently mapped package, SDK, and optional real-Herdr sentinels do not together establish the full globally installed package plus real Pi plus real Herdr path required by release planning.

The continuation, Herdr, Change Implement, and reviewer-process deep audit examined 34 artifacts: 16 production files and 18 test-side files comprising 13 test files and five helpers.
Its 9,572-line current total, 26-to-29-artifact retained estimate, 4,900-to-5,900-line estimate, and approximately 202-to-65-or-86 scenario reduction mix production, tests, and helpers and therefore are not suite test-file or test-line metrics.
The 13 tests include four Change Implement files already in the focused Change Start and Implement audit, three reviewer or Pi executor files assigned to Task and Validation, and `host-command.test.ts` assigned to the Repository and CLI audit.
The five continuation and Herdr tests are the only test-file group not obviously counted through those adjacent standalone scopes, although responsibility overlap still requires retained-fact reconciliation.
This audit's standalone totals must not enter the suite-wide aggregate directly.

The accepted continuation design adds bounded general `by change status <change-id>` inspection owned by Change Delivery.
Change Status supplies authoritative Change activity, relevant Blocker and Resolution identities, publication relation, actionable Tooling Failure identity, terminal state, and compact Managed Worktree revision without Acceptance Context, Findings, decisions, histories, or another growing collection.
The packaged extension then owns only Pi events, pause and explicit continuation, restart budget, delivered-Resolution cursor, polling, one exact Resolution-content read when needed, widget and messaging behavior, abort, and shutdown cancellation.
The current 1,623-line extension reconstructs domain state from multiple CLI and Git commands, while several synthetic active-Validation and Tooling Failure states in its 1,198-line test suite are not producible by the current `change show` projection.
Those decoder tables should disappear rather than become fixture vocabulary.

The extension's initial Change Submit interception drives a required first-submission reassessment against the complete Acceptance Context.
A read-only audit found 133 distinct reassessment episodes across 315 available Implementer transcripts and three historical mechanism variants.
Fifty-seven episodes, 42.9 percent, produced a corrective commit before the first real post-reassessment Submission; 75 produced no commit and one was indeterminate.

The most deeply audited 43-episode separate-run cohort contained 20 material implementation or configuration corrections, five verification-only corrections, and 18 no-change outcomes.
No specific correction was visibly planned before the trigger except one broad conceptual case and one partial accepted-design case, and no harmful reassessment correction was identified.
No-change episodes took a median 37 seconds, while correction-bearing episodes took a median 106 seconds.
Concrete material corrections included restoring Pi message fallback behavior, preserving newer non-passing Task Review authority, retrying Validation after a later failed Run, normalizing Herdr worktree paths, and verifying publication recovery metadata before confirmation.

The additional 90 in-run episodes produced 32 correction-bearing outcomes.
Manual transcript review identified at least 14 committed material corrections after genuine actual-Submission guards, plus verification-only corrections, uncommitted material attempts, and corrections triggered by historical false recognition of `change submit --help`.
The current concise cohort produced 16 correction-bearing outcomes across 63 episodes, required no reminder prompts, and had a median duration of approximately 20 seconds.
This operational evidence makes removal of first-submission reassessment indefensible for consolidation purposes.
Later Validation Findings do not negate that value because reassessment is an additional pre-Submission check rather than a replacement for Candidate Validation.

Historical variants falsely intercepted some `change submit --help` calls, and the current shell-text recognizer cannot reliably recognize every wrapper, alias, function, script, or alternate executable path.
Those are reliability risks to the accepted behavior, not reasons to delete it.
A future mechanism may replace the parser only if it preserves or strengthens the reassessment guarantee at a truthful execution boundary.
The compact retained extension harness covers startup, first-submission reassessment and retry, nonexecuting `--help` exclusion, pause and continuation, blocker abort, non-overlapping polling and one Resolution delivery, transient versus durable inspection failure, unchanged restart limit, terminal and published states, and shutdown.
One real Pi SDK blocked-turn sentinel retains the actual extension boundary.

Herdr host evidence should use one scripted command ledger for new launch, active or Done reuse, workspace provenance, uncertain create recovery and ambiguity, pane-busy rotation, definite and uncertain start, and definite versus unknown prompt outcomes.
The socket owner retains real Unix transport for compatible protocol, incompatible handshake, definite rejection, and unknown post-write failure.
The host's current `Promise.race` timeout does not abort or await the underlying Herdr command, so a timed-out workspace creation or agent start can continue mutating after recovery begins.
That is a product process-safety gap, not test setup to preserve.
Protocol version and compatibility authority also remain unpinned outside copied fixtures and an opt-in real-Herdr test.

Change Implement should become one operation with one normal path, one preparation-failure prompt, closed and not-found preconditions, direct profile and resource validation, and direct prompt and result tables.
The separate compiled Change Implement process test is fully overlapped by input ownership, socket prompt transport, and installed-package execution and should be deleted; the optional real-Herdr integration remains.
The redesign also proposes folding `reviewerAgentRuntime` into shared Agent Session execution, moving its remaining Pi resource isolation to the Pi owner, and deleting duplicated reviewer-runtime and process-tree suites.
Generic process-tree termination remains owned once by `host-command.test.ts`.

When the latest Validation Run has a Tooling Failure, automatic continuation remains idle and waits for explicit continuation, which presents recovery guidance before another Submission.
Older passing evidence remains eligible under the Change Delivery domain contract, but a later Submission for the unchanged Current Candidate must start Validation again rather than reuse that older pass.
Change Status therefore represents the latest Tooling Failure as actionable recovery state separately from eligible passing evidence.
The bounded general status boundary is accepted, but its exact schema and test reductions remain design estimates until implementation establishes the smallest demonstrated contract.
The estimate must also retain first-submission reassessment coverage and may not count deletion of its current parser unless an accepted replacement provides the same guarantee.

## Exact-Candidate Validation portfolio

The mapped Candidate Validation portfolio currently contains 83 lexical cases across 14 files and 6,617 physical lines, excluding broader Agent Session, migration, package, and Publication evidence.
Its owner must directly exercise the exact Candidate implementation because callback-only sequencing cannot satisfy `VERIFICATION.md`.
The fixed order remains Repository Preparation, Checks, linked Acceptance Review, and configured Specialist Reviews, followed by required Snapshot Workspace restoration and cleanup.

A provisional retained design contains 39 cases across 11 files and approximately 3,800 lines.
It allocates three direct production-operation cases to exact linked sequencing, unlinked or Check-blocked short-circuiting, and tracked-mutation Tooling Failure with Candidate preservation.
Real-SQLite suites retain active-run atomicity, phase and Producer ownership, Invocation and reviewer roster ownership, malformed-evidence rollback, Validation Input Snapshot separation, and invalid durable authority.
Inspection retains abandonment and cleanup retry, reuse, public tokens, ordered projection and Artifact presentation, and joined Change reviewer policy.
Prepare and Check phases retain command classification, continuation, marker handling, and one real-process timeout sentinel.
Acceptance and Specialist phases retain their owner prompts, Findings, prior evidence, failure classification, order, stopping, continuation, and restoration sequence.
Snapshot Workspace lifecycle retains real-Git creation, reuse, unowned-path refusal, process-tree termination, restoration, and exact cleanup mechanics.

The design proposes deleting `candidate-validation-gate.test.ts` without replacement after direct-operation cases absorb its four weaker callback sequencing cases, and deleting `validation-run-abandonment.test.ts` after real-SQLite inspection and real cleanup retain its two supported facts.
It also proposes deleting `candidate-acceptance-review.test.ts` after moving its unique prior-Finding selection to the Acceptance phase owner, because its hand-built `runReviewPhases` duplicates workspace, persistence, phase, and completion mechanics.
Those complete-file candidates account for ten cases and 687 lines.
Operation-first caller migration would additionally remove the 143 lines in `test/support/candidateValidation.ts` and `test/support/changeValidationPorts.ts`.
The broader planning target is approximately 44 fewer cases and 2,800 fewer test lines, but it is a design estimate rather than an executed prototype.

Direct persistence cases currently embedded in inspection should move to or collapse into SQLite owner suites, normal compact decoding should not duplicate complete public projection evidence, and Task Review admission evidence must leave `sqlite-validation-ownership.test.ts` for the Task Review portfolio.
Acceptance and Specialist phase owner facts should replace phase-scope Tooling Failure repetition in the direct Candidate Validation suite.
The exact retained cases must preserve one direct integrated fixed-gate path rather than distributing every stage into isolated phase tests.

The construction-only Candidate Validation Layer, broad execution and workspace interfaces, callback gate, fixed-storage execution port, duplicate caller choice, and test wiring helpers have no entitlement under ADR 0013.
Private SQL behavior remains, but the Layer, broad port facade, and caller-selected replacement seams should disappear.
The final direct operation entry point cannot be named until that migration lands.
An owner-local exact-Candidate scenario may replace current `candidateReadyRepo` use, but the shared cross-portfolio helper itself must not survive as durable vocabulary.

Required sentinels are real SQLite for durable authority and atomicity, real Git for exact Candidate and Snapshot Workspace identity, a real process for process-tree termination and one Check timeout, and one normal Pi reviewer process boundary.
The direct linked exact-Candidate sentinel should absorb the normal Specialist Pi integration, while the Pi executor owns oversized prompt transport and permits deletion of the oversized Acceptance Context process case.
Compact persisted decoding remains only where the consuming projection actually reads the corrupted representation, not repeated through unrelated inspection, reuse, Publication, and completion consumers.
Installed package and current-worktree behavior remain owned by the package portfolio.
No Candidate Validation timing comparison has been run.

## Destructive terminal lifecycle portfolios

Destructive behavior divides into Discard Work authority, Terminal Cleanup orchestration, local Git cleanup, remote Change Branch cleanup, Reconciliation, coordinated cancellation, and Artifact lifecycle.
A single terminal-lifecycle harness would have no truthful common owner.

Discard Work authority belongs at the complete Reconciliation operation boundary.
It requires one exact Closed Change ID, applies for one invocation only, and is never persisted.
The CLI already rejects omitted-ID discard, while the complete Reconciliation operation must make bulk discard unrepresentable rather than rely on caller validation.
A same-Change pending discard followed by an ordinary retry should prove non-persistence semantically; schema-column absence does not prove one-attempt authority.

Terminal Cleanup privately loads one authoritative Closed Change and sequences exact resource cleanup, Artifact Content removal, and cleanup-state persistence.
It owns pending reasons, retries, persistence-after-effect uncertainty, complete no-op behavior, and Open Change rejection.
Local Git cleanup owns dirty and unique-work preservation, discard expansion, stale registration, symlink and path replacement safety, compare-and-delete races, and current-Managed-Worktree cwd behavior through real Git.
Remote cleanup owns canonical repository and branch identity, target and default-branch exclusion, observed head, conditional deletion, and one readback after uncertain mutation through captured GitHub behavior.
Artifact lifecycle owns removal of only one Change's Artifact Content while preserving metadata, other Changes' content, and Agent Transcripts.

Reconciliation owns one exact pull-request observation, mismatch no-mutation, atomic linked Change and Task completion, cleanup-after-completion ordering, and lock reread.
Its full mismatch matrix belongs to the owned-pull-request classifier, and the linked completion case can absorb the separate one-observation test.
Submit and inspection should not repeat the completion transition.
Cancellation owns Active Validation rejection, exact open or merged pull-request classification, uncertain close recovery, atomic linked cancellation, and leaving cleanup pending.
Direct unlinked Task cancellation belongs to Task Intent, while reason parsing and repository-local ID behavior belong to CLI routing.

High-confidence reductions include removing discard-specific lock-contention repetition, replacing discard CLI unsafe-path duplication with one exact-ID sentinel, removing cancellation handoff from Terminal Cleanup tests, table-shaping uncertain close and remote cleanup outcomes, and combining related sibling-container and broad-deletion Git cleanup mechanics.
The retained local Git suite must keep each distinct destructive safety sentinel, and the remote protocol matrix remains in the GitHub gateway owner.

The accepted Terminal Cleanup contract returns persistence failure, leaves the existing cleanup state pending, and retries the complete idempotent cleanup operation without an intermediate recovery state.
Already-removed resources and Artifact Content are successful on retry, and cleanup becomes complete only when durable settlement succeeds.

The accepted cancellation contract acquires the Change execution lock before remote or durable effects.
If pull-request closure succeeds but SQLite cancellation fails, cancellation returns the storage failure and a later retry re-observes the exact owned pull request, skips duplicate closure when it is closed-unmerged, completes instead if it merged, and atomically persists the applicable terminal transition.
Lock contention performs no GitHub or SQLite mutation.
No cancellation attempt or remote-closure recovery state is persisted.

No retained test directly proves that the authoritative persisted publication projection supplies the exact Remote Change Branch identity to Terminal Cleanup.
That remains a product verification gap rather than evidence that current duplicate tests should remain.

ADR 0013 migration should remove broad Reconciliation, Terminal Cleanup, and Cancellation objects, fixed SQLite ports, construction loaders, callback bundles, caller-supplied destructive records, and CLI test replacement paths.
Genuine Execution Lock, GitHub reader or closer, remote cleanup, and Artifact lifecycle boundaries remain because they represent external variation or resource lifecycle.
Real processes remain justified only for current-cwd and PATH-injected Git race cases; CLI selection and JSON mapping need no child `by` process.

## Contributor infrastructure and release-state portfolio

Contributor workload capacity, disposable workspace lifecycle, registered Git resources, product workspace restoration, process isolation, Repository Runtime migration, installed package behavior, and repository-authored tooling are separate responsibilities.
Their shared use of processes or temporary paths does not justify one infrastructure fixture.

The capacity scripts and `quality-interface.test.ts` own shared lock waiting, focused-selection bypass, interruption, descendant cleanup, nested lock handling, and status propagation through real child processes.
`vitest.config.ts` fixes `maxWorkers: 3`, and `VERIFICATION.md` requires retaining that limit, but no direct test currently asserts it.
The limit is therefore authoritative configuration plus review evidence rather than an executed contract check.
Process-helper restructuring is no longer blocked by the cancelled BY-85 through BY-88 work.
Delete the two unused historical routes now and retain only helpers justified by process-isolation and real race boundaries.

The workspace scope owns only the test directory and prefix-owned siblings, including Managed Worktree paths and symlink targets, across success, failure, interruption, and cross-fixture isolation.
The registered test worktree scope owns real-Git registration and verified teardown.
Product restoration remains in `restoreDisposableWorkspace` and its real-Git Adapter suite.
These three lifecycle responsibilities must not collapse into a generic temporary-directory or restoration helper.

The migration owner suite owns exact schema, constraints, indexes, foreign keys, and the ordered migration ledger.
Shared-state tests own missing state, identity, malformed-ledger handling, migration recovery, and initialization contention.
The installed-package suite owns the packed artifact, isolated installation, executable, packaged resources, and representative installed operation, not a second exact schema ledger.
The existing `0001_baseline`, `0002_task_simplification_advice`, and `0003_remove_legacy_task_simplification_advice` migrations are already on `main` and must remain immutable ordered history.
Tests may consolidate repeated assertions, but one owner must retain the supported resulting schema and ordered-ledger contract.

Repository tooling retains separate Effect, Biome plugin, health-report, Just or script, and shell diagnostic boundaries.
Replace the duplicate 20-row Vitest ast-grep matrix with at most one combined configured-scan sentinel for distinct path and language partitions because native ast-grep tests already own per-rule matcher evidence.
Global `PATH` lookup, public version behavior, and installed package plus real Pi plus real Herdr coverage remain release gaps governed by BY-14, BY-15, BY-17, and release readiness.

## Aggregate broad-audit reduction model

The original broad audits reconciled to a 103-file, 37,513-line baseline.
The current recount found 37,561 lines; the correction belongs to the incremental Repository, CLI, and config allocation and does not change file counts.

| Allocated scope | Current files | Current test lines |
| --- | ---: | ---: |
| Change redesign | 22 | 11,914 |
| Task and Validation redesign | 35 | 14,009 |
| Repository, CLI, and config files not already allocated | 31 | 6,312 |
| Change Implement plus unique continuation and Herdr tests | 9 | 3,781 |
| Change Start | 3 | 1,437 |
| Uncovered and unchanged | 3 | 118 |
| **Total** | **103** | **37,561** |

The three uncovered files are `runtime-adapter-docs.test.ts`, `blocker-input.test.ts`, and `validation-artifact-files.test.ts`.
The exact pairwise overlaps removed to produce the partition are three Change result files shared by the Change and Repository or CLI scopes, two Candidate Capture files shared by the Change and focused Start or Implement scopes, `cli-task-id.test.ts` shared by Task and Repository or CLI, three reviewer or Pi executor files shared by Task and continuation, `host-command.test.ts` shared by Repository or CLI and continuation, and four Change Implement files shared by continuation and the focused Start or Implement audit.
There are no triple file overlaps.
`current-candidate-selection.test.ts` belongs to the measured 22-file Change total, while `change-lifecycle-results.test.ts` belongs to the incremental Repository or CLI scope.

The deduplicated retained allocation retains one focused Candidate Capture owner file because complete Submit consumes exact capture without absorbing its provenance and atomicity responsibility.
The retained line estimate must include that file once the exact migration shape is measured.

| Retained allocation | Files | Retained test lines |
| --- | ---: | ---: |
| Change redesign | 9 | 3,200 to 3,600 |
| Task and Validation redesign | 24 | approximately 8,100 |
| Incremental Repository, CLI, and config | 24 to 25 | approximately 4,158 to 4,558 |
| Change Start | 1 | approximately 600 to 700 |
| Change Implement | 2 to 3 | Not independently estimated |
| Unique continuation and Herdr | 5 | Not independently estimated |
| Uncovered and unchanged | 3 | 118 |
| **Total** | **68 to 70** | **16,176 to 17,076 plus retained Implement and continuation lines** |

The nine currently allocated Implement, continuation, and Herdr files contain 3,781 lines.
Charging all those lines unchanged gives a conservative suite ceiling of approximately 19,958 to 20,858 test lines even though the retained file model consolidates one or two Implement files.
This supports approximately 33 to 35 fewer files, a 32 to 34 percent reduction, and at least approximately 16,703 to 17,603 fewer test lines, a 44 to 47 percent reduction, under the audited redesign assumptions.
The eventual line target should be lower after a test-only estimate is established for the five unique continuation and Herdr files.
Support and production deletion remain separate metrics and are excluded from these test-line totals.

Executed-case reduction cannot be aggregated honestly because different audits measured lexical registrations, expanded parameterized cases, or mixed scenarios.
The earlier 22,890-to-23,290-line floor is superseded by this file-level reconciliation.

Runtime impact also remains a range rather than one suite target.
The established probes reduce Change inspection by approximately 82 percent and focused Specialist Review median time by 15.9 percent.
The ast-grep probe exposed the cost of the duplicate 20-row Vitest matrix and established that one combined scan preserves all current expected matches.
The reviewer experiment prevented an unsupported whole-boundary deletion claim: native tests own per-rule matching, while one configured-scan sentinel may retain distinct path and language discovery evidence.
Dynamic traces show that Task Review, Candidate Validation, Change Start, Change Cleanup, Candidate Acceptance, and Specialist Review account for thousands of repeated Git and shell executions, so retained real-boundary sentinel counts will materially affect the final wall-time model.

## Cross-portfolio reconciliation

The retained harness vocabulary should be limited to the following concepts.

- A workspace scope owns disposable filesystem cleanup, including sibling Managed Worktree paths.
- A SQLite state scope owns one isolated Repository Runtime resource without encoding owner records.
- A registered test worktree scope owns test-resource registration and verified teardown, not product restoration.
- An owner scenario constructs only authoritative state local to one operation or responsibility.
- A captured external Adapter represents genuine external variation or uncertain response classification.
- A boundary sentinel states whether it exercises a direct operation, in-process CLI, executable, installed package, real Git, child process, or socket.

`test/support/testGit.ts` is resource-lifecycle infrastructure rather than a product workspace-restoration harness.
`restoreDisposableWorkspace` and its Adapter suite already own restoration mechanics.
`createInitializedRepo` currently couples initialized state to a source-process launch, and `candidateReadyRepo` combines Git topology, product initialization, publication-shaped remotes, and a raw Change insert across multiple owners.
Neither should become universal retained vocabulary.
`test/support/by-cli.ts` similarly mixes package build, source and built processes, in-process CLI, Git setup, configuration commits, and passed Task Review setup; future migration should separate truthful boundaries rather than add options around the current module.

Owner-local approved Task, published Change, publication marker, and Validation graph scenarios must not converge into a shared durable graph builder.
ADR 0013 makes fixed SQLite interpretation private to the applicable owner and permits a shared kernel only for substantial shared durable meaning.
Broad use-case factories, fixed-storage ports, construction-only Layers, duplicate aliases, CLI injection seams, and raw durable interpretation in `changeInspectionFixture.ts` are migration work, not compatibility requirements for consolidated tests.
The measured Change inspection probe proves that a source process is unnecessary, but its use of `runByInProcessEffect` does not justify retaining that broad injection seam.

The current evidence allocation requires these corrections.

- Submit and Reconciliation retain their distinct ADR 0008 merge-observation triggers through one shared classifier, Task/Change coordination owns atomic Change plus linked Task completion, and Change inspection retains only projection of established closed state.
- The migration owner suite owns exact resulting schema and ordered ledger shape; the installed-package suite needs only installed migration availability and normal installed operation.
- The release baseline is complete, and migrations 0002 and 0003 are immutable post-baseline history on `main`; consolidation may remove duplicated assertions but must not rewrite that history.
- The local publication Git Adapter owns upstream-association mechanics; a complete Publication operation sentinel remains only if it identifies an integration failure absent from the Adapter suite.
- Candidate Validation owns direct exact-Candidate fixed-gate sequencing; phase, SQLite, reviewer, and workspace suites retain only their distinct owner boundaries.
- Terminal Cleanup and Discard Work allocate destructive Git behavior, CLI selection, authorization, non-persistence, exact target, work preservation, retry, and Artifact lifecycle across their truthful owners.
- Task/Change coordination owns cancellation's exact PR closure, uncertain recovery, active Validation rejection, pending-cleanup handoff, and Reconciliation atomicity.
- Contributor test infrastructure retains capacity-lock, three-worker scheduling, destructive workspace sibling cleanup, registered-resource teardown, and process-isolation evidence.

## Removal-first Task list

Do not replace cancelled BY-85 through BY-88 with broad portfolio cleanup Tasks.
The immediate replacement work must name exact deletions, while architecture-coupled deletion belongs to the operation-first Task that removes the production seam.

The reviewer-hardening Task is ready to record.
It delivers the Removal and Consolidation reviewer instruction changes, the Task Reviewer superseded-representation rule, and the bounded real-model experiment evidence without retaining experiment infrastructure as product verification.

The following immediate Tasks are task-ready but not yet recorded.

1. Replace the 20-row Vitest ast-grep matrix in `test/repository/tooling-diagnostics.test.ts` with at most one combined configured-scan sentinel for the distinct `src`, `test`, `extensions`, and `scripts` plus TypeScript and JavaScript partitions; remove per-rule matcher evidence already owned by native ast-grep tests and all setup made unused.
2. Remove unused historical test CLI process routes by deleting `runBuiltByWithEnv` and `runJustBy` from `test/support/by-cli.ts` and making their now-internal executable and environment helpers private where still consumed.
3. Remove duplicated Agent reviewer evidence by deleting the first valid-output case in `test/agent/reviewer-output-contract.test.ts` and the Pi executor process-tree termination case whose complete process behavior is owned by `test/command/host-command.test.ts`.
4. Remove exact duplicate Change command evidence by deleting the second unchanged `task show BY-1` read in `test/change/change-inspection.test.ts` and the focused `nothing_to_submit` serialization case in `test/cli/change-submit-errors.test.ts`.
5. Remove durable checks of retired or authored representation by deleting the Task Review `--rerun` absence assertion in `test/cli/cli.test.ts` and the exact changelog source-tag assertion in `test/repository/package-contents.test.ts`; retain exact-work inspection for retirement and package presence rather than permanent historical knowledge.
6. Consolidate Repository Runtime migration and initialization verification around the immutable `0001_baseline`, `0002_task_simplification_advice`, and `0003_remove_legacy_task_simplification_advice` history; retain one exact resulting-schema and ordered-ledger owner, retain distinct missing-state, malformed-ledger, recovery, and contention behavior, and remove repeated schema or migration assertions from package and operation suites without changing migration source.

The following deletion belongs inside existing operation-first or release work rather than later cleanup Tasks.

| Owner Task | Exact removal responsibility |
| --- | --- |
| BY-73 | Delete `AgentSessionSqlLink` and raw-SQL callback settlement paths after semantic journals retain dispatch, settlement, rollback, and concurrency evidence. |
| BY-74 | Delete broad Task use-case, persistence, loader, duplicate alias, CLI injection, and `test/support/taskUseCases.ts` paths after complete Task operations replace every consumer. |
| BY-75 | Delete Task Review loaders, broad use-case and persistence interfaces, Task-only admission fallback, and obsolete test injection; replace repeated Task Review configuration setup and real-Git restoration mechanics with visible owner cases while retaining sequencing and one justified integration boundary. |
| BY-76 | Delete Candidate discovery, rebinding, caller-selected base behavior, `change-candidate-capture-orchestration.test.ts`, reflog recovery evidence, and obsolete result variants after exact capture retains provenance, reuse, ancestry, workspace identity, and atomic recheck. |
| BY-77 | Delete Candidate Validation construction-only tags and Layers, callback gate, broad ports and loaders, `test/support/candidateValidation.ts`, and `test/support/changeValidationPorts.ts`; delete callback-gate tests only after the direct exact-Candidate operation retains ordering and short-circuit evidence. |
| BY-78 | Delete broad Change read and authority ports, duplicate projections, and inspection loaders after requested projection operations replace them; bounded general Change Status and continuation simplification remain separate accepted product work rather than inferred cleanup. |
| BY-79 | Delete Change Start, Prepare, and Implement forwarding loaders and dependency bags; replace the test that rejects Managed Worktree Repo Config authority, move the BOM fact before deleting `implementer-prompt-file.test.ts`, and retain the compiled stdin sentinel until installed-package evidence replaces it. |
| BY-80 | Delete `loadChangeSubmit`, the broad Submit dependency bag, callback loaders, aliases, and repeated Candidate Validation Layer construction after complete Submit owns only sequencing across exact capture, Validation, and Publication. |
| BY-81 | Delete Publication and Reconciliation forwarding composition and the duplicate private GitHub repository parser after complete operations retain uncertain-mutation recovery, exact-target and atomic completion evidence; make one-ID, one-attempt, non-persisted Discard authority unrepresentable as a bulk operation. |
| BY-82 | Delete Terminal Cleanup and recovery loaders, generic cleanup dependency bags, caller-supplied destructive records, and obsolete test seams after the complete operation retains exact delegation, Artifact lifecycle, real-Git safety, and the approved pending-state idempotent retry after settlement failure without another recovery representation. |
| BY-84 | Delete cancellation use cases, dependency bags, fixed-storage ports, and CLI injection; retain lock-before-effect behavior and remote-observation retry after post-close persistence failure without another recovery representation, and remove Terminal Cleanup's duplicate cancellation-handoff case. |

BY-83 is not authority for repository-wide cleanup.
Every replaced seam should leave with its owning migration.
A residual BY-83 deletion requires an exact remaining symbol or file and its present owner.

The release-baseline cutover is already complete and requires no Task.
Migrations 0002 and 0003 are post-baseline migrations already present on `main` and must not be squashed or replaced.
Migration-test simplification belongs to the migration owner portfolio and may remove only duplicated evidence while retaining one exact resulting-schema and ordered-ledger contract.
BY-14 retains installed package version and Pi setup ownership, BY-15 retains public release documentation ownership, and BY-17 retains exact artifact verification.

Whole-file disposition remains unresolved for `candidate-acceptance-review.test.ts`, `validation-run-abandonment.test.ts`, `changeInspectionFixture.ts`, and `reviewer-agent-runtime-process.test.ts` because each may still contain at least one distinct material protection or required consumer setup.
This does not require one-for-one replacement of useless tests: delete any check with no current obligation, and retain or relocate only a distinct supported fact at its cheapest reliable boundary.
Permanent retention of `agent-session-supported-operation.test.ts` remains unresolved.

BY-17 must establish the installed packed Change Implement stdin-to-socket fact and delete the replaced source-built sentinel in the same result.
Keeping replacement and deletion together prevents a completed Task from leaving duplicate executable-boundary evidence.

Bounded Change Status and continuation simplification remain product work rather than free test cleanup.
The work must preserve first-Submission reassessment, real socket uncertainty, Pi SDK loading, and explicit Tooling Failure recovery while removing extension-side Change-state reconstruction.
Detailed Change Show redesign remains outside this simplification and is tracked in `agent-cli-read-experience.md`.

## Required portfolio record

Every mature portfolio entry must contain the following evidence before it becomes a Task.

- The responsibility and authoritative owner.
- Every current file and helper in scope.
- The supported facts and material failures protected by the current tests.
- The distinct facts that require real SQLite, real Git, a real process, package installation, or another expensive boundary.
- Repeated evidence that can be deleted without replacement.
- Repeated mechanics that should move into an owner-specific fixture or harness.
- The proposed retained suite structure and representative readable test.
- The production seams or test-only flexibility that the proposal retains, removes, or leaves to another accepted simplification.
- Existing Tasks, Changes, plans, and release work that overlap.
- Baseline and expected test count, file count, line count, expensive-operation count, and duration.
- Focused verification that would establish the consolidated portfolio itself.

## Task extraction rules

Prefer one Task per coherent responsibility portfolio or independently verifiable shared harness migration.
Do not create a repository-wide "clean up tests" Task.
Do not split helper extraction from consumer migration when either half would leave parallel setup paths.
A Task must name the evidence retained, the setup or cases removed, the boundary costs reduced, and the focused verification required.
A Task that depends on a production simplification must follow or join that work rather than preserve the obsolete seam in a new test helper.

## Unresolved questions

- What final operation entry point replaces the Candidate Validation Layer, callback gate, and broad execution ports, and does the provisional 39-case, approximately 3,800-line design preserve every direct exact-Candidate fact after that migration?
- What test-only file and line target applies to the five unique continuation and Herdr tests?
- Which exact Submit, Reconciliation, and Change inspection assertions are subsumed once the shared classifier owns merge interpretation and Task/Change coordination owns the one atomic completion transition?
- Which direct CLI sentinels remain after operation-first operations replace broad use-case injection?
- Which owner-local durable scenarios are worthwhile before their broad ports and Layers disappear, and which should wait for the production migration?
- What exact installed-package and global lookup evidence will release Tasks BY-14, BY-15, and BY-17 require beyond the packed Change Implement stdin-to-Herdr sentinel?
- Which 24 or 25 incremental Repository, CLI, and config files survive after result ownership and Task command absorption are finalized?
- What truthful execution boundary can guarantee first-submission reassessment across wrappers, aliases, scripts, and alternate executable paths if the current shell parser is ever replaced?

## Investigation log

- Established the initial suite size, directory distribution, largest files, support-helper usage, and broad Git, SQLite, process, and temporary-repository footprints.
- Captured a successful full Vitest JSON profile with 103 files, 950 tests, 88.766 seconds of wall time, and per-file spans that concentrate approximately 68.6 percent of summed execution time in ten files.
- Mapped the main workspace, Git repository, initialized repository, Candidate-ready repository, SQLite-only, CLI, and subprocess support layers and recorded where their lifecycle responsibilities differ.
- Identified six overlapping local initialized-repository builders, separated registered test-worktree lifecycle from product restoration, and found several unused fixture parameters that should disappear with their callers.
- Confirmed that publication's captured-versus-real-Git split should remain and that Change Submit's approximately 20-field captured dependency option bag needs scenario simplification rather than a real-repository fixture.
- Confirmed that the tooling-diagnostics ast-grep table launches a fresh process and copies the same configuration for each row.
- Ran a disposable one-scan probe that preserved all 20 expected rule-and-file matches while reducing observed wall time from 10.376 seconds to 0.368 seconds and process launches from 20 to one.
- Confirmed that the installed ast-grep structured output supplies the rule identity, file, severity, and message needed for consolidated assertions.
- Found that `ast-grep/tests/structural-bans-test.yml` owns valid and invalid examples for every unique rule ID in the Vitest matrix, then used reviewer experiments to preserve at most one configured-scan sentinel for distinct path and language discovery rather than retain per-rule Vitest evidence.
- Mapped 37 reviewer-related tests across approximately 3,574 lines and separated shared Agent Session and workspace mechanics from Task Review, Acceptance Review, and Specialist Review policy and lifecycle ownership.
- Identified broad Acceptance and Specialist phase harness option bags, duplicated default Agent Invocation persistence and captured Git mechanics, and the risk of consolidating them into a larger generic fixture instead of smaller named owner scenarios.
- Identified four adjacent Task Review configuration-failure tests that repeat complete repository, configuration, Task, submission, and no-admission setup around one varying invalid resource condition.
- Identified the oversized Acceptance prompt as overlapping the Pi process executor's existing greater-than-128-KiB transport evidence and the construction-only Candidate Validation Layer helper as deletion work already established by accepted ADR 0013.
- Allocated reviewer restoration evidence between the disposable-workspace Git Adapter, Agent Session persistence, Task Review, Acceptance Review, and Specialist Review, identifying repeated real-Git cleanup assertions that can become captured sequencing evidence.
- Mapped the SQLite portfolio across approximately 15,400 lines, distinguished real-database contracts from direct codec tests, and identified repeated Change and validation graph builders without assuming one generic fixture.
- Identified approximately 154 lines of broad SQLite test port aggregation and the 99-line Candidate Validation Layer fixture as deletion work coupled to accepted ADR 0013 rather than new helper foundations.
- Identified shared Agent Invocation representation decoding versus distinct Task Review and Change Validation journal semantics as the controlling boundary for corruption and rollback consolidation.
- Mapped the mixed responsibilities and 1,336 combined test-and-fixture lines in the Change inspection portfolio.
- Ran a disposable Change inspection probe that preserved all ten tests while replacing 30 source-process CLI calls, reducing focused wall time from 48.294 seconds to 8.463 seconds and deleting 28 net helper lines.
- Mapped 96 lexical tests across 4,928 lines of Change Start Managed Worktree, Submit orchestration, Cleanup Git, Reconciliation, and Terminal Cleanup evidence to their distinct real-Git, real-SQLite, or captured-Adapter boundaries.
- Identified Submit's approximately 20-field dependency builder, repeated Reconciliation persisted setup, repeated Cleanup Git repository mechanics, and over-complete Terminal Cleanup records as owner-specific simplification targets rather than one Change workflow fixture.
- Mapped direct application, executable, process-helper, built-Candidate, and installed-package evidence and confirmed that the package suite already shares one build, pack, and prefix installation.
- Identified unused `runBuiltByWithEnv` and `runJustBy` helpers and a release coverage question because current package evidence invokes an explicit prefix-installed bin rather than proving global `PATH` lookup.
- Confirmed exact duplicate Change inspection and Change Submit serialization assertions, strong Acceptance Artifact-failure overlap, and four groups suited to visible scenario tables without deleting distinct owner rules.
- Mapped Task identity, lifecycle, persistence, dependency, Context Draft, revision, Review result, command, and Task/Change coordination evidence to pure, filesystem, SQLite, Git, and captured application seams.
- Identified the broad `TaskUseCases` fake and inspection alias, complete passed-Review setup, and mixed Task command defaults as operation-first or owner-specific reductions rather than a universal Task fixture.
- Mapped approximately 3,641 lines of Publication operation, GitHub PR and cleanup, target detection, local Git, and push-destination evidence and separated real SQLite, real Git, and captured GitHub ownership.
- Identified repeated upstream-association mechanics, publication marker scenario matrices, gateway request syntax, and the GitHub cleanup-remote responsibility boundary without treating uncertain outcomes as duplicate evidence.
- Mapped approximately 5,147 lines of Agent Session, reviewer runtime and output, Pi executor, Herdr host and socket, continuation policy, extension and SDK, profile, and runtime-document evidence.
- Preserved distinct real-SQLite Agent journals, real-process Pi and SDK transport, real-socket uncertainty, captured host recovery, and pure continuation policy boundaries while identifying owner-local scenario matrices.
- Ran a disposable Task Review configuration prototype that preserved four classifications and no-admission results while reducing the repeated section by 52 lines.
- Ran a disposable Specialist restoration prototype that retained all tests, reduced the file by 32 lines, reduced top-level Git executions by 42.7 percent, and reduced three-run median focused time by 15.9 percent.
- Replaced mechanism-led ledger entries with responsibility portfolios and explicit SQLite, Git, process, and duplicate-analysis lenses.
- Reconciled harness vocabulary around workspace, SQLite state, registered worktree, owner scenario, captured external Adapter, and qualified boundary sentinel concepts.
- Reconciled a provisional exact-Candidate Validation design from 83 cases and 6,617 lines to 39 cases and approximately 3,800 lines, dependent on operation-first construction and direct verification.
- Reconciled Discard Work, Terminal Cleanup, local and remote cleanup, Reconciliation, cancellation, and Artifact lifecycle around exact authority and truthful destructive boundaries.
- Identified missing exact-ID operation authority and persistence-after-external-effect recovery evidence in the terminal lifecycle as product verification gaps rather than reasons to retain duplicate mechanics.
- Reconciled capacity scheduling, workspace lifecycle, registered Git resources, product restoration, process isolation, release baseline, installed package, and repository tooling ownership.
- Corrected the migration audit after confirming the release baseline was already completed and migrations 0002 and 0003 are immutable post-baseline history on `main`; only duplicate migration-test evidence remains eligible for consolidation.
- Reconciled current work, cancelled the over-broad BY-85 through BY-88 Tasks, and retained release Tasks BY-14, BY-15, and BY-17 as constraints on package and CLI consolidation.
- Recorded the broader suite, helper, setup, and execution-topology scope requested by the Operator.
- Measured the adjacent Change Start, Candidate Capture, Change Implement, and Implementer Prompt scope at nine files, 2,935 lines, 66 expanded cases, approximately 48 real-Git and 40 SQLite-backed scenarios, and 234 related support lines.
- Reconciled Change Start around complete-operation policy and recovery plus the smallest ADR 0007 real-Git safety matrix, with a standalone reduction target from 36 to approximately 15 cases.
- Identified current Candidate discovery and rebinding evidence as behavior rejected by ADR 0013 while preserving exact provenance and atomic identity as required Candidate Capture or Submit owner facts.
- Reconciled the compiled Change Implement stdin sentinel as temporary protection that should disappear only when the installed-package representative operation absorbs its joined stdin-to-socket fact.
- Recorded a product-authority conflict between public Managed Worktree Repo Config selection and current Change Implement runtime behavior.
- The Operator resolved that conflict in favor of the public contract: Change Implement loads Interactive Session selection and Repo Agent Profiles from the Managed Worktree Repo Config, with Global Config fallback; current invoking-checkout behavior and its preserving test are defects.
- Reconciled every current test file into an exact disjoint partition totaling 103 files and corrected the current count to 37,561 lines, leaving only three tiny unchanged files outside measured redesign scopes.
- Removed pairwise double counting across Change results, Candidate Capture, Task CLI, reviewer runtime, host command, and Change Implement files and confirmed that no triple file overlap exists.
- Corrected the continuation audit's 34 mixed artifacts to 16 production files, 13 tests, and five test helpers, with only five test files unique after adjacent allocation.
- Established a deduplicated 68-to-70-file retained model with 16,176 to 17,076 estimated lines plus retained Implement and continuation lines, and a conservative 19,958-to-20,858-line ceiling when all nine current files in that unresolved line term are charged unchanged.
- Recorded the remaining Candidate Capture ownership, conditional Change Implement process-sentinel, continuation test-only target, and Candidate Validation retained-line contradictions.
- The Operator required an audit of real Implementer sessions before considering removal of first-submission reassessment.
- Audited 133 reassessment episodes across 315 available Implementer transcripts and three historical mechanism variants; 57 episodes produced corrective commits before the first real post-reassessment Submission.
- Semantically classified the 43-episode separate-run cohort as 20 material implementation or configuration corrections, five verification-only corrections, and 18 no-change outcomes, with no identified harmful correction.
- Audited the additional 90 in-run episodes, which contained 32 correction-bearing outcomes and at least 14 committed material corrections after strict genuine actual-Submission guards; historical `--help` false triggers and uncommitted attempts were not credited to that lower bound.
- Confirmed that the current concise variant produced corrections in 16 of 63 episodes with an approximately 20-second median and no reminder prompts, making feature removal unsupported while retaining parser reliability as a separate concern.
- Selected the supported-operation suite as Task Review's sole real-workspace wiring sentinel, leaving real restoration mechanics to the disposable-workspace Adapter and owner sequencing to captured tests.
- Retained Candidate Capture as one focused exact-provenance and atomicity owner suite consumed by complete Submit rather than absorbed into Submit orchestration.
- Defined latest Validation Tooling Failure as explicit continuation recovery state without invalidating older eligible passing evidence or allowing its reuse by a later Submission.
- Defined the replacement executable sentinel as an installed packed Change Implement operation that transmits real stdin through a fake Herdr Unix socket.
- Selected baseline and retained file count, test-line count, expanded case count, real Git, SQLite, and process invocation counts, and focused wall time as the temporary comparison metrics; no permanent metrics tooling is required.
- Added test-basis traceability, test subsumption, equivalence partitioning, boundary-value analysis, risk-based testing, and cross-runner comparison to the Removal and Consolidation reviewer instructions, plus superseded-representation removal to Task Review.
- Ran 22 real-model reviewer trials in disposable fixtures: the edited Specialist pair improved offender detection from 9 of 18 to 11 of 18 opportunities with no boundary-control false positives, while the Task Reviewer sentence tied its already-capable baseline in one target and control trial.
- Refuted the proposed complete ast-grep Vitest deletion in four focused trials because reviewers consistently retained one configured-scan integration fact; removed two ineffective follow-up prompt formulations and corrected the Task to one combined configured-scan sentinel rather than force the expected answer.
- Confirmed that exact-ID, one-attempt, non-persisted Discard Work is established behavior rather than an unresolved product decision.
- Accepted existing pending-state idempotent retry after Terminal Cleanup succeeds externally but durable settlement fails, without another recovery representation or command.
- Accepted lock-protected cancellation retry through exact remote re-observation after pull-request closure succeeds but durable cancellation fails, without another recovery representation.
- Accepted bounded general Change Status as the Change-owned inspection boundary that removes continuation-extension domain reconstruction; moved broader Change Show responsibility analysis to `agent-cli-read-experience.md`.
