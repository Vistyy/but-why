# Refactor expensive test boundaries

## Status

Done.

## Specification

- [Test Suite Feedback Loop Redesign](../specs/test-suite-feedback-loop-redesign.md)
- [Taskless Changes and Worktree Handoff](../specs/taskless-changes-and-worktree-handoff.md)

## Behaviors owned

- Routine behavior tests use the cheapest public seam that proves each behavior reliably.
- Focused tests retain real Git, Managed Worktree, SQLite concurrency, filesystem, package-install, and process coverage where those boundaries prove a distinct defect class.
- Storage-only tests do not initialize Git repositories.
- Package-install checks reuse one immutable packed tarball.
- Each migrated hotspot records before-and-after runtime evidence.

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
- [x] Focused tests retain each distinct real Git, Managed Worktree, SQLite concurrency, filesystem, package-install, and process defect class.
- [x] Fresh package-install checks share one packed tarball.
- [x] Duplicate end-to-end permutations are removed only when another test proves the same behavior and defect class.
- [x] Each hotspot and the complete non-coverage suite have recorded before-and-after timings.
- [x] All selected tests pass after every migration stage.

## Scoped implementation record

- Baseline: `02d61b7a363cacc90fdfef367fab28972228a5dc`.
- Spec review source: this task document.
- Normative traceability: `docs/specs/test-suite-feedback-loop-redesign.md` and `docs/specs/taskless-changes-and-worktree-handoff.md`.
- Primary public test seam: focused hotspot suites and the complete non-coverage Vitest suite through Just.

| Acceptance criterion | Implementation target | Public test seam | Verification target |
| --- | --- | --- | --- |
| Promote the Task CLI experiment and preserve 46 checks | `test/task-cli.test.ts`, `test/task-cli-process.test.ts`, and `docs/spikes/test-performance-audit.md` | In-process Task CLI tests plus four process-backed tests | Focused Task CLI tests and complete suite |
| Keep storage-only tests free of Git setup | `test/support/repository.ts` and SQLite persistence tests | Effect-native persistence interfaces with temporary SQLite state | Focused persistence and repository storage tests |
| Use the cheapest routine CLI, Change, Candidate, and Validation seams | Task CLI, Change Implement, reconciliation ownership, and existing orchestration seams | In-process CLI, injected hosts, injected GitHub gateways, and module ports | Focused hotspot tests and complete suite |
| Retain distinct real external defect classes | Existing real Git, Managed Worktree, validation workspace, package, filesystem, and process suites | Focused integration and adapter tests | Complete non-coverage suite |
| Reuse one immutable package tarball | `test/installable-cli.test.ts` suite fixture | Shared packed tarball for manifest and both installation checks | Installable CLI test |
| Remove duplicate expensive permutations only with preserved coverage | Change Implement input validation and reconciliation ownership tests | Public CLI and reconciliation service seams | Focused Change Implement and reconciliation tests |
| Record hotspot and complete-suite timings | This task's timing evidence | Vitest hotspot output and complete suite output | Timing table below |
| Keep selected tests green after each stage | All migrated test fixtures | Focused stage commands and complete suite | Required validation commands |

### Timing evidence

Timings are Vitest test-aggregate seconds from the baseline and final non-coverage suite runs.
Wall time is included for the complete suite because parallel workers make aggregate test time and user-visible time different measures.

| Hotspot | Baseline | After migration | Boundary decision |
| --- | ---: | ---: | --- |
| Task CLI and process checks | 39.96 s | 24.97 s | Routine checks use the in-process CLI; four concurrency checks retain processes |
| Change Start Managed Worktree | 30.71 s | 32.11 s | Retain real Git, worktree, and preparation coverage |
| Change Candidate Capture | 26.90 s | 26.94 s | Retain real Git identity, history, and provenance coverage |
| Candidate Acceptance Review | 22.14 s | 21.94 s | Retain real Candidate workspace and reviewer evidence coverage |
| Change Implement | 19.15 s | 11.08 s | Handoff input permutations use the in-process CLI; launch behavior retains Managed Worktree coverage |
| Change Reconciliation | 17.83 s | 13.43 s | Ownership permutations use SQLite and injected gateways; completion and cleanup retain Git coverage |
| Installable CLI | 16.45 s | 8.80 s | Manifest and both installation checks share one packed tarball |
| Change Submit | 13.85 s | 17.63 s | Retain end-to-end Candidate, validation, and publication coverage |
| Candidate Validation | 9.89 s | 11.83 s | Retain real validation workspace, filesystem, and process coverage |
| Complete non-coverage suite | 258.51 s aggregate / 113.15 s wall | 224.94 s aggregate / 84.43 s wall | All selected tests pass; retained boundaries remain explicit |

## Decision ledger

- Local: promote the accepted Task CLI experiment as the source for the 42 routine checks and four process-backed checks because it preserves all 46 behavior checks while keeping the process defect class explicit.
- Local: extract the temporary SQLite state fixture into shared test support so storage-only persistence tests do not need a Git repository or `by init`.
- Local: validate Change Implement handoff input before loading Change state in the invalid-input matrix because the external Change boundary is not observable for those usage errors.
- Local: construct reconciliation ownership permutations through SQLite persistence and an injected GitHub gateway while retaining real Git for completion and unsafe-cleanup behavior.
- Local: pack the package once in a suite-scoped immutable fixture and remove it after the suite because each consumer installation has independent mutable state.
- Deferred to Task 156: final routine and full-quality command membership, capacity coordination, and locked clean-checkout verification.

## Completion

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

Review status:

- Spec: `APPROVED` and latched.
- Standards: `APPROVED WITH REQUIRED COMMENTS` and latched after guarding package-fixture cleanup and synchronizing the quality-task name.

## Required validation

- `just test test/task-cli.test.ts test/task-cli-process.test.ts`
- `just test test/task-dependency-persistence.test.ts test/task-persistence-policy.test.ts test/repository-storage.test.ts`
- `just test test/change-implement.test.ts`
- `just test test/change-reconciliation.test.ts`
- `just test test/installable-cli.test.ts`
- `just test`
- `just quality`
- `just typecheck`
- `just format-check`

## Blocked by

None - can start immediately.
