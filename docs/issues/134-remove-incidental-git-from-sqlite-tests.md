# Refactor expensive test boundaries

## Status

Completed.

The reopened migration exhausted worthwhile performance improvements and met both operating budgets.
The approved implementation plan and final evidence are recorded below.

## Specification

- [Test Suite Feedback Loop Redesign](../specs/test-suite-feedback-loop-redesign.md)
- [Taskless Changes and Worktree Handoff](../specs/taskless-changes-and-worktree-handoff.md)

## Behaviors owned

- Routine behavior tests use the cheapest public seam that proves each behavior reliably.
- Focused tests retain real Git, Managed Worktree, SQLite concurrency, filesystem, package-install, and process coverage only where they prove an externally consequential adapter contract or reproduce a concrete prior regression.
- Storage-only tests do not initialize Git repositories.
- Package-install checks reuse one immutable packed tarball.
- Each migrated hotspot records before-and-after runtime evidence.
- `just quality` and `just full-quality` provide the real routine and complete suite memberships used to enforce the approved performance budgets.

## What to build

Refactor the expensive test boundaries as one measured wide migration.
Start from the preserved Task CLI experiment at commit `6779f17` on branch `prototype/fast-task-cli-suite`.
Migrate each remaining hotspot while the complete suite stays passing.
Remove duplicate expensive setup only after a cheaper public-seam test or a focused real-boundary test preserves the behavior.

## Primary verification seam

Focused hotspot suites plus the complete non-coverage Vitest suite in the locked Nix environment.

## Acceptance criteria

- [x] The accepted Task CLI experiment is promoted without losing its 46 behavior checks.
- [x] Storage-only tests do not initialize Git repositories.
- [x] Routine CLI, Change, Candidate, and Validation behavior uses existing in-process or injected public seams where an external boundary is not observable behavior.
- [x] Focused tests retain real Git, Managed Worktree, SQLite concurrency, filesystem, package-install, and process coverage only for externally consequential adapter contracts and concrete prior regressions.
- [x] Fresh package-install checks share one packed tarball.
- [x] Duplicate end-to-end permutations are removed only when another test proves the same behavior and defect class.
- [x] Every material hotspot has been optimized until further runtime reduction would cost disproportionate behavioral or boundary-defect coverage.
- [x] `just quality` runs routine tests without coverage and has a median runtime at or below the 10-second operating budget and 15-second completion gate.
- [x] `just full-quality` runs the complete selected test suite once without coverage and has a median runtime at or below the 20-second operating budget and 30-second completion gate.
- [x] Each hotspot and both quality commands have recorded before-and-after timings for the completed migration.
- [x] All selected tests pass after every migration stage.

## Scoped implementation record

- First-pass baseline: `02d61b7a363cacc90fdfef367fab28972228a5dc`.
- Reopened implementation baseline: `cefa590913823d72b45b96d074b34ba80957ae22`.
- Spec review source: this task document.
- Normative traceability: `docs/specs/test-suite-feedback-loop-redesign.md` and `docs/specs/taskless-changes-and-worktree-handoff.md`.
- Primary public test seam: focused hotspot suites and the complete non-coverage Vitest suite through Just.

| Acceptance criterion | Implementation target | Public test seam | Verification target |
| --- | --- | --- | --- |
| Promote the Task CLI experiment and preserve 46 behavior checks | `test/task-cli.test.ts`, `test/task-cli-process.test.ts`, and `docs/spikes/test-performance-audit.md` | 42 in-process Task CLI checks plus one cross-process concurrency scenario that proves four process-backed behaviors | Focused Task CLI tests and complete suite |
| Keep storage-only tests free of Git setup | `test/support/repository.ts` and SQLite persistence tests | Effect-native persistence interfaces with temporary SQLite state | Focused persistence and repository storage tests |
| Use the cheapest routine CLI, Change, Candidate, and Validation seams | Task CLI, Change Implement, reconciliation ownership, and existing orchestration seams | In-process CLI, injected hosts, injected GitHub gateways, and module ports | Focused hotspot tests and complete suite |
| Retain distinct real external defect classes | Existing real Git, Managed Worktree, validation workspace, package, filesystem, and process suites | Focused integration and adapter tests | Complete non-coverage suite |
| Reuse one immutable package tarball | `test/installable-cli.test.ts` suite fixture | Shared packed tarball for manifest and both installation checks | Installable CLI test |
| Remove duplicate expensive permutations only with preserved coverage | Change Implement input validation and reconciliation ownership tests | Public CLI and reconciliation service seams | Focused Change Implement and reconciliation tests |
| Establish real routine and complete quality memberships | `justfile`, Vitest configuration, and suite membership | `just quality` and `just full-quality` | Three-run median wall times and command guarantees |
| Record hotspot and quality-command timings | This task's timing evidence | Vitest hotspot output and quality command output | Timing table below |
| Keep selected tests green after each stage | All migrated test fixtures | Focused stage commands and both quality commands | Required validation commands |

### Timing evidence

Baseline values are Vitest aggregate test time from the reopened audit.
Final hotspot values are wall time for one isolated locked-Nix Just invocation and include command startup.
The complete-suite final value is Vitest wall time from the final full-quality validation run.

| Hotspot | Reopened baseline | Final | Boundary decision |
| --- | ---: | ---: | --- |
| Task CLI and process checks | 39.96 s | 4.65 s | Routine checks use the in-process CLI; one cross-process scenario preserves concurrent persistence and atomicity coverage |
| Change Start Managed Worktree | 30.71 s | 3.34 s | One creation scenario and one safety scenario retain real Git, worktree, and preparation coverage |
| Change Candidate Capture | 26.90 s | 2.77 s | Focused adapter checks retain real Git identity, history, and provenance coverage |
| Candidate Acceptance Review | 22.14 s | 4.56 s | One immutable repository template supports focused phase sequencing, Finding, Specialist, and tooling-failure contracts |
| Change inspection | Not isolated | 2.81 s | One immutable repository template supports public inspection routes, Task projection, and submit guidance |
| Change Implement | 19.15 s | 2.60 s | Handoff permutations use the in-process CLI; launch behavior retains Managed Worktree coverage |
| Change Reconciliation | 17.83 s | 1.44 s | Ownership permutations use SQLite and injected gateways without duplicate Git setup |
| Installable CLI | 16.45 s | 6.67 s | Manifest and both documented installation workflows share one packed tarball |
| Change Submit | 13.85 s | 1.23 s | In-process orchestration proves submission outcomes without a duplicate publication composition |
| Candidate Validation and inspection | 9.89 s | 3.00 s | Focused tests retain validation file copying and persisted evidence inspection |
| Complete non-coverage suite | 258.51 s aggregate / 113.15 s wall | 15.92 s wall | The selected suite passes with retained external boundaries explicit |

## Decision ledger

- Local: promote the accepted Task CLI experiment as the source for 42 routine checks and consolidate four process-backed behavior checks into one cross-process concurrency scenario.
- Local: extract the temporary SQLite state fixture into shared test support so storage-only persistence tests do not need a Git repository or `by init`.
- Local: validate Change Implement handoff input before loading Change state in the invalid-input matrix because the external Change boundary is not observable for those usage errors.
- Local: construct reconciliation ownership permutations through SQLite persistence and an injected GitHub gateway while retaining real Git for completion and unsafe-cleanup behavior.
- Local: pack the package once in a suite-scoped immutable fixture and remove it after the suite because each consumer installation has independent mutable state.
- Local: disable Vitest module isolation so workers reuse the immutable module graph while every Git repository, SQLite database, filesystem workspace, and process fixture remains isolated.
- Local: clone immutable initialized-repository templates and rebind copied SQLite identity before each focused boundary scenario.
- Settled during the reopened planning session: measured `just quality` runtime at or below 15 seconds and measured `just full-quality` runtime at or below 30 seconds are hard completion gates, although runtime warnings do not change command exit status.
- Settled during the reopened planning session: maintain 10-second routine-quality and 20-second full-quality operating budgets, verify each through the median wall time of three consecutive runs in a clean locked-Nix checkout with dependencies installed and no competing heavy workload, and restore headroom in any change that exceeds a budget.
- Settled during the reopened planning session: retain a real-boundary test only when it proves an externally consequential adapter contract or reproduces a concrete prior regression; move policy and result permutations in-process and remove speculative, impossible-state, duplicate, and low-value boundary permutations.
- Settled during the reopened planning session: do not require a representative end-to-end test for every workflow; retain one only when workflow composition creates a distinct failure mode that focused adapter and in-process orchestration tests cannot prove.
- Settled during the reopened planning session: use existing injected module and phase seams first; add a production seam only when it expresses a real module boundary and replaces substantial repeated integration setup, without test-only hooks or fake abstractions around inherently external behavior.
- User-approved: Task 134 owns routine and full-quality command composition, suite membership, timing output, and performance-budget verification so optimization is measured through the real command interface.
- User-approved: coverage remains diagnostic rather than a preservation target; coverage-based Fallow health is advisory while dead-code and structural checks remain blocking.
- Deferred to Task 156: shared capacity coordination, final concise diagnostics, and locked clean-checkout verification.

## First implementation checkpoint

The following record describes the incomplete first pass and remains as baseline evidence for the reopened work.

Implementation commits:

- `3335e2f` - promote the Task CLI experiment, share SQLite-only fixtures, reuse one package tarball, and remove incidental Git setup from routine Change and reconciliation tests.
- `cf55fda` - add explicit timeouts for process-backed checks and remove Task 134 from the dependency graph.
- `7e0e293` - preserve package setup failures and synchronize the quality-task name in the dependency graph.

Verification:

- Focused hotspot suites passed after each migration stage.
- The final non-coverage suite passed with 378 tests and 1 intentional skip.
- `just quality` passed with coverage, static checks, Fallow checks, and the production build.
- `just typecheck`, `just format-check`, and `just docs-check` passed after the final correction batch.
- The complete non-coverage suite improved from 258.51 to 224.94 aggregate Vitest seconds and from 113.15 to 84.43 wall-clock seconds in the measured runs.

Historical review status:

- The first pass received Spec `APPROVED` and Standards `APPROVED WITH REQUIRED COMMENTS`.
- Reopening the task invalidates those completion reviews for the new implementation diff.

## Required validation

- `just test test/task-cli.test.ts test/task-cli-process.test.ts`
- `just test test/task-dependency-persistence.test.ts test/task-persistence-policy.test.ts test/repository-storage.test.ts`
- `just test test/change-implement.test.ts`
- `just test test/change-reconciliation.test.ts`
- `just test test/installable-cli.test.ts`
- `just test`
- Three consecutive uncontended locked-Nix runs of `just quality`
- Three consecutive uncontended locked-Nix runs of `just full-quality`
- `just typecheck`
- `just format-check`

## Final verification

All required focused commands passed in the locked Nix environment.
The complete selected suite passed with 314 tests and one intentional skip.
`just health` produced machine-readable coverage and completed with advisory coverage-based Fallow health at `78 B`.

Three consecutive locked-Nix wall-time measurements produced these results:

| Command | Run 1 | Run 2 | Run 3 | Median | Operating budget | Completion gate |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `just quality` | 6.690 s | 6.852 s | 6.495 s | 6.690 s | 10 s | 15 s |
| `just full-quality` | 19.413 s | 19.720 s | 19.219 s | 19.413 s | 20 s | 30 s |

## Blocked by

None - can start immediately.
