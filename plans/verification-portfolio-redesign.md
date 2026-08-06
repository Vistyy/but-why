---
status: recorded-first-task-graph-in-progress
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

## Concurrency measurement

### Hypothesis

One mixed `just quality` and `just full-quality` pair in isolated linked worktrees can run without the shared capacity lock without failures or a material workflow-cost increase.

### Baseline

The measurement used detached linked worktrees at `7a15da7`, shared locked dependencies, and wall-clock time from process start to exit.
A single `just quality` run completed in 22.529 seconds.
A single `just full-quality` run completed in 76.152 seconds.
Both exceed the current 10-second and 30-second operating budgets.

### Experiment

One linked worktree ran `just quality` while another ran `just full-quality`.
The first pair used the existing shared Git-common-directory capacity lock.
The second pair bypassed only that lock with `BY_CAPACITY_LOCK_HELD=1`.
No source or product files changed, and both temporary linked worktrees were removed after the measurement.

### Evidence

With the lock, `full-quality` completed in 75.835 seconds and `quality` waited for capacity, then completed in 22.399 seconds.
The pair took 98.334 seconds in total.
Without the lock, both runs passed, but `quality` took 42.177 seconds, `full-quality` took 91.950 seconds, and the pair took 91.969 seconds.
Each process reported approximately 1.1 GB maximum resident memory.

### Conclusion

The result is inconclusive for the intended parallel-work throughput goal.
Removing the lock saved about 6 seconds for one mixed pair but made both individual commands slower and doubled concurrent memory demand.
One successful unlocked pair does not establish that three concurrent Change Submit workloads are safe or more productive.

### Effect on plan

Retain the current capacity lock until a throughput measurement compares three concurrent Change Submit workloads at different per-run worker limits.
Do not choose routine versus complete evidence scheduling from filename suffixes.
Treat the current operating budgets as measurement signals, not as criteria for retaining or removing individual evidence.

### Limitations

This measured one mixed pair on one machine and one checkout revision.
It did not compare three concurrent `just quality` workloads at different Vitest worker limits.
It did not measure two simultaneous complete workloads, coverage workloads, interruption, or a workload that mutates the repository's own Shared Repository State.
It does not establish the cause of the current baseline cost.

## Worker-limit measurement

### Hypothesis

A lower Vitest worker limit improves one `quality` or `full-quality` workload enough to replace the current limit of three workers.

### Baseline

The measurement used one detached linked worktree at `7a15da7`, shared locked dependencies, and wall-clock time from process start to exit.
Each worker limit ran the same `just quality` and `just full-quality` workloads sequentially.

### Experiment

The temporary worktree changed only `vitest.config.ts` `maxWorkers` from three to one, two, and three in turn.
No source or product files changed, and the temporary linked worktree was removed after the measurement.

### Evidence

One worker completed `quality` in 40.128 seconds and `full-quality` in 140.888 seconds, with approximately 591 MB and 599 MB maximum resident memory.
Two workers completed `quality` in 28.293 seconds and `full-quality` in 92.743 seconds, with approximately 963 MB and 976 MB maximum resident memory.
Three workers completed `quality` in 22.331 seconds and `full-quality` in 73.335 seconds, with approximately 1.21 GB and 1.03 GB maximum resident memory.
All six workloads passed.
All runs exceeded the current 10-second and 30-second operating budgets.

### Conclusion

Three workers are the fastest measured limit for one workload on this machine.
Lower limits reduce memory demand but materially increase single-workload time.
The result does not answer the parallel-work throughput goal.

### Effect on plan

The throughput measurement below shows that no unlocked one-, two-, or three-worker configuration is currently valid for concurrent Change Submit workloads.
Retain the three-worker limit only while the capacity lock remains because it is the fastest valid measured configuration.
Treat this as host-specific single-workload evidence, not a universal worker policy or a reason to retain any individual test.

### Limitations

This measured one machine, one revision, and sequential workloads only.
It did not measure more than three workers, coverage, interruption, or other host sizes.
It does not establish why the workloads exceed their current operating budgets.

## Concurrent Change Submit throughput measurement

### Hypothesis

Three isolated Change Submit workloads can complete safely and with better total throughput when the shared capacity lock is removed and each workload uses one, two, or three Vitest workers.

### Baseline

The measurement used three detached linked worktrees at `7a15da7`, shared locked dependencies, and wall-clock time from process start to exit.
Each worktree ran `just quality`, the current Change Submit gate.
The locked baseline used three Vitest workers per workload.

### Experiment

Three `just quality` workloads started at the same time.
The baseline retained the capacity lock with three workers per workload.
The remaining scenarios bypassed only that lock with `BY_CAPACITY_LOCK_HELD=1` and used one, two, or three Vitest workers per workload.
No source or product files changed, and all temporary linked worktrees were removed after the measurement.

### Evidence

With the lock, all three workloads passed in 68.187 seconds total.
Without the lock and with shared temporary storage, one worker completed one workload but two workloads failed in 62.459 seconds total.
Without the lock and with shared temporary storage, two workers completed two workloads but one failed in 59.283 seconds total.
Without the lock and with shared temporary storage, three workers caused all three workloads to fail in 63.046 seconds total.
The one- and two-worker failures included `test/agent/reviewer-agent-runtime.test.ts` observing inconsistent Reviewer Session working directories.
After giving each one-worker workload an isolated temporary directory, all three workloads passed in 68.864 seconds total.
With isolated temporary directories, two-worker workloads still all failed because `test/change/change-reconcile-discard.cli.test.ts` exceeded its five-second timeout.
With isolated temporary directories, three-worker workloads all failed with multiple timeouts and took 98.359 seconds total.
The main checkout status was unchanged after every scenario.

### Conclusion

The hypothesis is refuted for the current test portfolio.
One-worker unlocked workloads can become valid after temporary-storage isolation, but they do not improve total throughput over the locked baseline.
Two- and three-worker unlocked workloads remain invalid because their retained process-heavy evidence exceeds its test timeouts under contention.

### Effect on plan

Retain the current capacity lock and the current three-worker limit.
Do not replace the lock with a lower per-workload worker limit.
The portfolio redesign must reduce or isolate expensive retained evidence before it can justify another concurrency-policy experiment.

### Limitations

This measured only the `just quality` gate on one machine and one revision.
It did not run actual Change Submit operations, full-quality, coverage, interruption, more than three workloads, or more than three workers per workload.
It does not establish a safe future concurrency limit.

## Concurrent-workload diagnosis

### Cause

`test/agent/reviewer-agent-runtime.test.ts` has a confirmed test-isolation defect.
Its fixed Reviewer Session ID is searched under the parent of its session directory, which is the shared process temporary directory.
Concurrent test processes can therefore select another process's fixture session file.
This does not establish that production Reviewer Sessions collide because production session IDs and roots are different.

### Supporting experiments

Three concurrent direct runs of that test with the ordinary shared temporary directory produced one failure with the inconsistent working-directory symptom.
The same three direct runs with one isolated temporary directory per process all passed.
Three one-worker `just quality` workloads likewise all passed after temporary-directory isolation.

### Diagnostic loop

Run three detached linked worktrees concurrently with `just test test/agent/reviewer-agent-runtime.test.ts`.
Use the normal shared temporary directory to reproduce the failure.
Then set distinct `TMPDIR`, `TEMP`, and `TMP` paths for each workload to test the isolation hypothesis.

### Final verification

The isolated direct-test loop passed three of three runs.
The isolated one-worker `just quality` loop passed three of three runs in 68.864 seconds total.
The original three-workload shared-temporary-directory loop still reproduces the failure.

### Remaining uncertainty

The confirmed temporary-storage defect explains the Reviewer Session failure but not the explicit-discard and other timeouts under two or three workers per workload.
Those timeouts remain resource-contention symptoms with an unconfirmed exact cause.

## Routine evidence cost measurement

### Question

Which routine-gate evidence files have enough measured cost to need first review during portfolio redesign?

### Method

One current-checkout run used `BY_TEST_SUITE=routine just test` with Vitest JSON output.
The result sums test-body duration by file.
It excludes static checks, build time, worker startup, and boundary-only evidence.

### Results

The slowest routine files were `test/repository/package-contents.test.ts` at 34.177 seconds, `test/cli/change-submit-errors.test.ts` at 11.169 seconds, `test/task/task-cli.test.ts` at 8.404 seconds, `test/change/change-reconcile-discard.cli.test.ts` at 8.156 seconds, and `test/change/change-cancellation.test.ts` at 8.093 seconds.
The next files were `test/change/change-implement-main-checkout-failure.test.ts` at 4.995 seconds, `test/cli/cli.test.ts` at 3.501 seconds, `test/repository/portable-implementer-session.test.ts` at 3.373 seconds, `test/change/change-reconciliation.test.ts` at 2.251 seconds, and `test/agent/reviewer-agent-runtime.test.ts` at 1.668 seconds.
The run followed BY-134 removing duplicate Task-backed completion, Task-backed cancellation, and taskless completion evidence from `repository-storage.boundary.test.ts`.
One `change-submit-errors.test.ts` case exceeded the default five-second Vitest timeout under the three-worker routine run and passed in isolation, so its measured cost includes that timeout.
The `herdr-smoke.test.ts` case remained skipped in this environment.

### Use in the portfolio

Cost alone does not justify removing evidence.
Review these files first for duplicate full-process setup, duplicate end-to-end wiring, or assertions that can move to a cheaper owner without losing a distinct Verification Claim.
`change-reconcile-discard.cli.test.ts` is the first concrete consolidation candidate because it is both costly and the confirmed two-worker timeout source.

### Limitations

This is one run on one machine and ranks test-body time rather than complete file wall-clock time.
It is a targeting measurement, not a performance budget or a retention decision.

## Final scheduling measurement

### Question

Does the corrected and reduced portfolio after `BY-129` through `BY-135` prove a faster valid three-concurrent `just quality` result without the capacity lock?

### Hypothesis

Three isolated `just quality` workloads can complete without the capacity lock faster than the locked baseline and without timeouts or fixture collisions.

### Baseline

The measurement used three detached linked worktrees at `fa7a98d`, the reduced portfolio after `BY-134` and `BY-135`, and wall-clock time from process start to exit.
Each worktree installed dependencies from the shared pnpm store.
Each workload ran `just quality`, the current Change Submit gate, with `maxWorkers: 3` and the capacity lock active.
All three workloads passed in 99.007 seconds total.
Per-workload quality time was 35.061s, 33.135s, and 30.574s.
The second workload waited about 35.2 seconds for capacity, and the third waited about 68.3 seconds.
Peak process-tree resident memory was about 2.1 GB, 2.0 GB, and 2.1 GB.

### Experiment

Three `just quality` workloads started at the same time in the same detached linked worktrees.
Each unlocked scenario bypassed only the capacity lock with `BY_CAPACITY_LOCK_HELD=1` and gave each workload a distinct `TMPDIR`, `TEMP`, and `TMP`.
The temporary worktrees changed only `vitest.config.ts` `maxWorkers` to one, two, or three in turn.
No source or product files changed, and all temporary linked worktrees were removed after the measurement.

### Evidence

Unlocked one worker with isolated temporary directories: all three workloads passed in 74.960 seconds total.
Per-workload quality time was 74.559s, 74.128s, and 74.720s.
Peak process-tree resident memory was about 1.4 GB, 1.5 GB, and 1.4 GB.

Unlocked two workers with isolated temporary directories: two workloads passed and one failed in 65.034 seconds total.
Per-workload quality time was 64.826s, 63.759s, and 64.628s.
The failing workload timed out in `test/change/change-implement-main-checkout-failure.test.ts` at the five-second default Vitest timeout.
Peak process-tree resident memory was about 1.5 GB, 1.5 GB, and 1.6 GB.

Unlocked three workers with isolated temporary directories: all three workloads failed in 103.066 seconds total.
Per-workload quality time was 102.897s, 92.228s, and 90.654s.
The failing workloads timed out in `test/change/change-implement-main-checkout-failure.test.ts`, `test/cli/change-submit-errors.test.ts`, and `test/change/change-reconcile-discard.cli.test.ts` at the five-second default Vitest timeout.
Peak process-tree resident memory was about 1.9 GB, 1.8 GB, and 1.9 GB.
No fixture-collision or working-directory symptom appeared in any unlocked run.

The main checkout ran `just quality` once after the measurement and passed in 21.830 seconds with no new intermittent failure.

### Conclusion

The hypothesis is refuted for lock removal.
The one-worker unlocked limit is the only valid unlocked limit, and it is faster than the locked baseline in total wall-clock (74.960s versus 99.007s).
It makes every individual workload materially slower (about 74.5s versus about 33s average quality time).
The two- and three-worker unlocked limits remain invalid because retained process-heavy evidence still exceeds its test timeouts under contention.

### Effect on plan

Keep the current capacity lock and the current three-worker Vitest limit.
The only passing unlocked limit does not satisfy the removal criterion because it makes individual workloads materially slower, even though its total wall-clock is faster.
Do not update `VERIFICATION.md` temporary controls because no valid faster result is proven.
The portfolio must further reduce or isolate expensive process-heavy evidence before it can justify another concurrency-policy experiment.

### Limitations

This measured only the `just quality` gate on one machine and one revision (`fa7a98d`).
It did not run actual Change Submit operations, full-quality, coverage, interruption, more than three workloads, or more than three workers per workload.
Peak resident memory is the summed RSS of the workload process tree, sampled every 0.2 seconds, not a single-process measurement.
It does not establish a safe future concurrency limit.

## Protected product outcomes

The refreshed portfolio must begin from these accepted outcomes:

1. Approved human intent remains identifiable.
2. Validation applies to the exact Candidate reported as passed.
3. External mutations target the expected repository, branch, pull request, and commit.
4. Concurrent operations cannot corrupt durable state.
5. Destructive cleanup cannot silently lose unique work.
6. Only authoritative terminal facts complete or cancel work.

The review must not derive additional product constraints only to make testing easier.

## Approved interim portfolio baseline

The operator approved this interim baseline for the later complete portfolio proposal.
It does not approve broad evidence migration, portfolio Task creation, or a `VERIFICATION.md` update.

### Material Risks

1. Approved-intent identity loss.
2. Candidate or validation-identity loss.
3. External-target identity loss.
4. Durable-state inconsistency.
5. Destructive cleanup loss.
6. False terminal result.

Trusted But Why Executable selection remains a temporary source-repository evidence constraint in `VERIFICATION.md`.
It is not a durable product Material Risk because first-release executable selection will replace the Source Checkout Guard.

### Verification Claims

- Change Start links only an approved Task whose dependencies are satisfied, and captures that exact Task Context as Acceptance Context.
- Review uses captured Acceptance Context, not later mutable Task text.
- Candidate capture identifies the exact fetched Change Base and Repository Branch head, and rejects unsafe workspace or ancestry facts.
- Change Start and recovery provision or reattach only the exact recorded Repository Branch in a safe Managed Worktree, without overwriting, guessing, or attaching another Change's work.
- A passed Validation Run represents completion of every required Validation Gate producer under the resolved Validation Policy.
- Validation Policy resolves the Change Base configuration, Candidate reviewer configuration, Global Config, Acceptance Context, and Implementation Decisions from their accepted authorities.
- Reuse and publication require the same Candidate, current Acceptance Context, Validation Policy Snapshot, Implementation Decisions, and resolved Implementation Blocker identity.
- A reviewer judges the exact Candidate, and a resumed Reviewer Session has a compatible fingerprint.
- An Implementer handoff starts only for the exact recorded Change and Managed Worktree, and missing or mismatched bindings stop without starting another Change's work.
- An unresolved Implementation Blocker prevents authoritative Validation, and a Resolution makes earlier Validation evidence historical when accepted authority requires fresh Validation.
- Publication and reconciliation accept an owned pull request only when repository, base branch, head branch, state, and head commit match recorded facts.
- Remote Change Branch cleanup acts only on the expected branch commit or reports an uncertain or changed fact without deleting it.
- SQLite admits at most one Active Validation Run and performs Change-linked Task terminal updates atomically.
- Forward migrations preserve supported current facts and reject persisted transient Task states or malformed consequential data truthfully.
- The explicit SQLite snapshot operation creates one independently readable, coherent Shared Repository State copy without overwriting an earlier snapshot or mutating source state.
- Malformed consequential persisted data produces `persisted_data_invalid`, not an unavailable-storage result or a valid-looking domain record.
- Ordinary recovery and cleanup preserve dirty work, unique local commits, advanced recorded Repository Branches, and changed Remote Change Branch heads.
- Terminal Cleanup removes all and only the exact Closed Change's Validation Artifact Content, keeps Artifact metadata and another Change's active content, and remains pending for retry after removal failure.
- Terminal Cleanup retains and indexes every exact Reviewer Transcript, including restarted sessions, removes active Reviewer Session records only after indexing succeeds, and retry does not duplicate references or delete transcripts.
- Explicit discard applies only to one exact Change and does not bypass repository, branch, or Remote Change Branch head identity checks.
- Only exact merged-Candidate observation completes a Task-backed Change, and `nothing_to_submit` does not complete or cancel work.
- Cancellation requires explicit operator authority and updates only the Change and any Task that the Change owns.
- A successful CLI mutation returns its committed supported facts, and an invalid, unavailable, or uncertain operation returns a distinct actionable result rather than a successful or terminal-looking domain record.
- Repository initialization creates or repairs required Local Repository artifacts at the Git root and Git Common Directory without replacing valid configured policy.
- Repository initialization rejects invalid existing Repository Runtime facts with a truthful actionable result.

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

## Draft evidence-owner map

This is a proposal from the full current-suite map.
It requires operator approval before evidence migration or Task creation.
Each primary owner is the lowest supported seam that can prove the claim.
Other tests may supply focused variations, but must not duplicate the primary proof without a distinct regression failure.

| Claim group | Primary evidence owner | Required real integration |
| --- | --- | --- |
| Approved Task, captured Acceptance Context, and Managed Worktree identity | Change Start and recovery evidence, led by `change-start-managed-worktree.boundary.test.ts` | SQLite and Git |
| Review uses the captured Acceptance Context, Candidate identity, and Reviewer Session continuity | Candidate capture plus Acceptance Review evidence, led by `change-candidate-capture.boundary.test.ts` and `candidate-acceptance-review.boundary.test.ts` | Git, SQLite, one real Check command, filesystem |
| Validation Gate completion and policy resolution | Candidate validation and policy-resolver evidence, led by `candidate-validation.boundary.test.ts` and `candidate-validation-policy.test.ts` | Git, SQLite, real Check command, filesystem |
| Reuse, Blocker, and Resolution decisions | Submit orchestration evidence | Captured domain Adapters, with SQLite only where stored equality matters |
| Exact Implementer handoff | Portable Implementer Session evidence, supported by Change Implement prompt evidence | Filesystem and one portable process sentinel |
| Owned pull request, publication, and remote branch cleanup | Publication policy, pull-request gateway, and cleanup-Git evidence | Git, SQLite, captured GitHub command facts |
| Active Validation Run, atomic terminal writes, migration preservation, and persisted-data truthfulness | Repository Storage evidence | Real SQLite |
| Explicit immutable snapshot | Shared-state snapshot evidence | Real SQLite, Git worktree, filesystem |
| Ordinary cleanup, Artifact Content cleanup, Reviewer Transcript retention, and targeted discard | Cleanup-Git, Artifact Lifecycle, Reviewer Transcript, and Reconcile Discard evidence | Git, SQLite, filesystem |
| Exact merged completion and cancellation | Change Reconciliation and Change Cancellation evidence | SQLite, Git where the observed fact requires it, captured GitHub facts |
| Truthful CLI results | The command evidence owned by the capability that mutates or reports the fact | In-process CLI, with a real process only for output, stdin, or executable behavior that cannot be observed in-process |

The truthful-CLI-result claim is a rule carried by each capability owner, not a new generic CLI test suite.
A command test may stay only when it proves command parsing, structured output, stdin, or process behavior that the capability's lower seam cannot prove.

### Temporary operational checks

Some checks protect the development and portable-product workflow rather than a product Material Risk.
They must remain separately named and justified instead of being misclassified as product-claim evidence.

- The Source Checkout Guard requires its linked-worktree real-process sentinel while `VERIFICATION.md` requires it.
- Package contents, release CLI loading, and public documentation checks own portable product interfaces under `docs/tooling.md`.
- Capacity-lock and process-isolation checks protect temporary test operation while those controls remain.
- Fallow, ast-grep, type, format, and documentation checks own their named structural or reader-visible contracts under `docs/tooling.md`.

No temporary operational check becomes permanent merely because it exists today.
Each must have a current owner and a removal or retention decision when the related control changes.

## Approved first Task graph

The first graph covers only the approved concrete evidence changes.
It does not complete the whole verification-portfolio strategy.

1. Isolate Reviewer Session test fixtures from concurrent workloads.
2. Give targeted discard one primary evidence owner per rule.
3. Give Candidate capture one primary evidence owner per rule.
4. Keep Task-dependency rejection persistence under the SQLite owner.
5. Consolidate duplicate CLI help, terminal-input, and internal-error evidence.

The five Tasks have no dependencies.
Each can be implemented and verified without another Task being Done.
Repository Storage allocation, portable-package evidence, and the final scheduling measurement remain plan-only work.

The operator authorized recording, and the complete Task Contexts are recorded as New unlinked Tasks:

1. `BY-129` Isolate concurrent Reviewer Session test fixtures.
2. `BY-130` Consolidate targeted-discard evidence.
3. `BY-131` Consolidate Candidate-capture evidence.
4. `BY-132` Separate Task-dependency CLI and SQLite evidence.
5. `BY-133` Consolidate small CLI-output evidence.

Task Approval and Implementation Authorization remain separate operator actions.

## Draft migration approach

This is a migration order proposal, not an approved Task graph.
No source change begins from it until the operator approves the complete strategy.

1. Correct the Reviewer Session test fixture so it does not search a shared temporary directory.
   Keep its real-process reviewer sentinel.
   Repeat the direct parallel test and three-workload measurement to prove the false collision is gone.
2. Reduce `change-reconcile-discard.cli.test.ts` to its two distinct command proofs: missing exact Change ID and actionable retry output.
   Let the existing real-Git cleanup evidence own terminal-worktree deletion and open-Change rejection.
   Add a pure `reconcileResult` test that owns `discard_open_change` structured-result serialization before removing the real-Git CLI case.
   Recheck focused behavior and concurrent Change Submit throughput.
3. Keep Repository Storage allocation as plan-only work outside the first Task graph.
   Before changing the file, make a case-by-case claim-owner map.
   Keep real-SQLite atomicity, migration, snapshot, and persisted-data proofs.
   Remove duplicate lifecycle and publication matrices only after their approved primary owners prove the same current fact.
4. Consolidate small pure command, input, and configuration cases only when the destination file already owns the same claim.
   For Candidate capture, remove only the orchestration tracked-tree-equality case.
   Keep its supplied-interface sequencing case and unsafe-base, rebind, and provenance matrix.
   For Task-dependency rejections, use in-process CLI tests with fake Task Use Cases for structured-result mapping.
   Keep the real SQLite graph-unchanged proof in `task-dependency-persistence.test.ts`.
   Keep `internal_error` output in `cli.test.ts` and prove both TOON and JSON there.
   Remove only the literal duplicate JSON-help case and the duplicate terminal-stdin case in `recording-text.test.ts`.
   Keep byte-limit and other input behavior.
   Do not merge tests merely to reduce file count.
5. Review portable package and source-workflow sentinels as one portable-interface group.
   Retain their real-process proof where required, but remove repeated package setup only when one retained sentinel proves the same installed-package fact.
6. Make the final scheduling decision only after every retained claim has a named owner and the costly evidence has been measured again.
   Do not remove the capacity lock, lower the worker limit, or remove the `boundary` execution category before that result.
7. Rename or move tests only after evidence ownership and scheduling are settled.
   Filenames must describe their capability, not an old test category.

Each migration slice must first state its affected Material Risk, Verification Claim, primary evidence owner, evidence it replaces, and focused verification command.
The slice must remove only the evidence that its retained owner makes redundant.

## Draft retained integration sentinels

This is the smallest current set proposed for evidence that cannot reliably use a cheaper seam.
It requires operator approval.

| Integration | What it must prove | Proposed owner |
| --- | --- | --- |
| SQLite | Atomic Change-linked Task writes, migration preservation, snapshots, and malformed-data truthfulness | Shared Repository State evidence |
| Git | Exact Candidate capture, Managed Worktree identity, and work-preserving cleanup | Candidate, Managed Worktree, and Cleanup evidence |
| Check command | A Validation Gate Check runs against a fresh exact Candidate workspace | Candidate Validation evidence |
| Pi reviewer process | The reviewer process receives only its intended runtime resources | Reviewer Agent Runtime evidence |
| Installed package | The packaged CLI, extensions, and public skill work from an installed layout | Package contents evidence |
| Portable Implementer Session | The portable handoff script rejects mismatched Change and worktree facts before launch | Portable Implementer Session evidence |
| Source Checkout Guard | A linked Candidate worktree delegates to the Trusted But Why Executable | Source-workflow isolation evidence, only while `VERIFICATION.md` requires it |
| Command process | Piped stdin, terminal input, output envelope, and descendant interruption work through the OS process boundary | Focused CLI and host-command evidence |

GitHub behavior does not need a live GitHub repository.
Captured GitHub command and response facts are sufficient because the claim is But Why's classification and retry behavior, not GitHub service availability.

## Draft cost controls

A retained test must protect a distinct current claim at a seam that the lower-cost evidence cannot reliably observe.
Its execution and maintenance cost must be justified by that distinct failure.

- Prefer pure or captured evidence for decision variations.
- Use real SQLite, Git, filesystem, or process behavior only for the facts that require it.
- Share expensive setup only when doing so preserves independent test cleanup and failure diagnosis.
- Treat any intermittent retained blocking evidence as a defect to correct, isolate, replace, or remove.
- Measure the modified focused evidence and `just quality` after every costly migration slice.
- Repeat the three-concurrent-workload measurement before changing the capacity lock or worker limit.
- Do not adopt fixed time limits as a reason to keep or remove evidence.

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

The immutable `0001` through `0023` chain remains, and focused forward migrations should produce the simplified supported schema without discarding Shared Repository State.
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

The operator approved the verification principles, the early-design and later-migration split, the interim Material Risk and Verification Claim baseline, and the refreshed strategy in this plan.
The approved strategy includes the evidence-owner map, retained integration sentinels, cost controls, and temporary capacity-lock decision.
The operator agreed to retain the capacity lock and three-worker limit, correct the temporary-storage test isolation defect, and remeasure only after costly retained evidence is reduced or isolated.
The operator approved a bottom-up evidence allocation before a migration Task graph is proposed.
The operator approved the first five-Task graph for the concrete evidence changes.
The operator approved a pure `reconcileResult` owner for `discard_open_change` structured-result serialization before the real-Git CLI case is removed.
The operator approved removing only the Candidate-capture orchestration tracked-tree-equality case and retaining its sequencing and unsafe-fact evidence.
The operator approved fake Task Use Cases for Task-dependency CLI rejection mapping and retained real SQLite persistence evidence for the unchanged graph.
The operator approved `cli.test.ts` as the sole `internal_error` owner, with TOON and JSON proof, plus the narrow help and terminal-stdin duplicate removals.
The operator approved keeping Repository Storage allocation as plan-only work outside the first Task graph until a case-by-case claim-owner map exists.
The operator approved the complete Task Contexts and authorized recording the first five-Task graph.
`BY-129` through `BY-133` are recorded without dependencies.
The operator approved `BY-129` and authorized its Task-backed implementation.
Change `8920442d-e011-4abb-970e-a25ce2b7a3a5` started in a fresh Implementer Interactive Session with `changeVerified: true`.
The operator approved `BY-130` and authorized its Task-backed implementation.
Change `3226d86a-0f1e-4e52-8a54-78bf7a05db35` started in a fresh Implementer Interactive Session with `changeVerified: true`.
`BY-131` through `BY-133` remain New and unlinked.
