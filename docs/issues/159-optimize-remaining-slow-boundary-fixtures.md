# Optimize remaining slow boundary fixtures

## Specification

- [Test Suite Feedback Loop Redesign](../specs/test-suite-feedback-loop-redesign.md)

## Behaviors owned

- Each remaining slow boundary hotspot has recorded setup and runtime evidence before optimization, as required by the Test Suite Feedback Loop Redesign.
- Tests reuse initialized Git and SQLite prerequisite state when initialization is not observable behavior.
- Tests use the in-process CLI seam when executable-process behavior is not part of the tested contract.
- Repeated setup is consolidated while each distinct supported scenario, assertion, and prior regression class remains verified.
- Focused tests retain real process concurrency, Git provenance, Candidate capture, publication, SQLite, and Managed Worktree behavior when that external integration is part of the contract.
- Optimization stops when the next passing stage improves the three-run `just full-quality` median by less than five percent.

## What to build

Profile the remaining slow boundary fixtures under the accepted three-worker execution model.
Start with Candidate Validation inspection because its repeated repository initialization and executable startup are prerequisites rather than tested behavior.
Use the resulting evidence to optimize Acceptance Review and publication setup when those changes preserve their consequential external contracts.
Reuse immutable initialized repository templates and isolate each mutable Git repository and SQLite state.
Replace executable startup only through an existing supported in-process CLI seam.
Keep the cross-process Task concurrency scenario process-backed.
After each stage, run the focused hotspot suite and the complete quality command.
Record the first passing candidate stage that improves the three-run complete-quality median by less than five percent, then stop.

## Primary verification seam

Focused hotspot suites plus three consecutive uncontended locked-Nix runs of `just full-quality`.

## Acceptance criteria

- [ ] Each changed hotspot records its setup profile and before-and-after runtime evidence.
- [ ] Candidate Validation inspection reuses initialized prerequisite state without bypassing its public inspection and persistence behavior.
- [ ] Acceptance Review and publication fixtures remove only setup work that is not part of their observable contracts.
- [ ] Every distinct process concurrency, Git provenance, Candidate capture, publication, SQLite, and Managed Worktree contract remains covered through a real applicable boundary.
- [ ] Mutable Git repositories and SQLite state remain isolated between tests.
- [ ] Every migration stage passes its focused hotspot suite and `just full-quality`.
- [ ] Optimization stops after the first passing candidate stage with less than five percent median complete-quality improvement.
- [ ] Three final locked-Nix `just full-quality` runs pass within the approved operating and completion budgets.

## Scoped implementation record

- Baseline: `264b8594d96f067161cfce1271e02c82b1f72dd2`.
- Spec review source: this task document.
- Normative traceability: `docs/specs/test-suite-feedback-loop-redesign.md`, `CONTEXT.md`, and `docs/adr/0014-use-module-owned-storage-and-change-transactions.md`.
- Primary public verification seam: focused hotspot boundary suites plus three consecutive locked-Nix `just full-quality` runs after each passing migration stage.

| Acceptance criterion | Implementation target | Public test seam | Verification target |
| --- | --- | --- | --- |
| Record setup and before/after runtime evidence | This task's scoped implementation record and final verification | Focused hotspot suites and `just full-quality` | Per-hotspot timing table and stage medians |
| Reuse Candidate Validation prerequisite state | `test/validation/candidate-validation-inspection.boundary.test.ts` and initialized-repository support | Candidate Validation inspection boundary suite through `runByInProcessEffect` | All inspection and persistence assertions pass with isolated cloned repositories |
| Remove only non-observable Acceptance Review and publication setup | Existing `beforeAll` templates and isolated clone helpers in the Acceptance Review and publication suites | Acceptance Review and publication boundary suites | Existing observable review, publication, SQLite, and Git assertions pass |
| Preserve consequential real boundaries | Existing process, Git, Candidate, publication, SQLite, and Managed Worktree boundary suites | Applicable boundary suites selected by `BY_TEST_SUITE=boundary` | Complete boundary suite passes without removing required external coverage |
| Isolate mutable Git and SQLite state | `cloneInitializedTestRepository` and per-test repository state | Candidate, Acceptance Review, publication, and remaining boundary suites | No cross-test state leakage; complete boundary suite passes |
| Pass every migration stage | Existing repository Just interface | Focused hotspot suite followed by `nix develop -c just full-quality` | Both commands exit successfully after each stage |
| Stop below five percent improvement | This task's timing evidence | Three-run complete-quality medians | Stop after first passing stage with less than 5% improvement |
| Pass final quality budgets | Existing `full-quality` recipe | Three consecutive locked-Nix `just full-quality` runs | Median remains within 30-second operating and 60-second completion budgets |

## Required validation

- Focused Candidate Validation, Acceptance Review, and publication boundary suites before and after their respective stages.
- `nix develop -c just full-quality` after every passing migration stage.
- Three consecutive uncontended locked-Nix `just full-quality` runs for the final stage.
- The repository quality checks required by `just full-quality`: build, documentation, formatting, AST-grep, typecheck, Fallow routine checks, and the complete selected test suite.

## Decision ledger

- Local: reuse immutable initialized repository templates and clone one mutable Git repository with a distinct SQLite state per test because initialization is setup, while Candidate capture, validation inspection, persistence, Git provenance, and publication remain observable behavior.
- Local: keep Candidate Validation inspection on the existing `runByInProcessEffect` seam because executable startup is not part of its contract.
- Local: retain the existing Acceptance Review and publication template strategy unless measured evidence shows setup work that is not part of their external contracts.
- Local: use Task 158's passing three-worker `just full-quality` median of `18.053 s` as the predecessor stage comparison until this task records a newer passing stage median.

## Migration evidence

The changed hotspot was Candidate-owned Validation Run inspection.
Before optimization, each of its two tests initialized a fresh Git repository and SQLite state with `createInitializedRepo()`.
After optimization, the suite initializes one immutable template in `beforeAll`, then clones an isolated repository and SQLite state for each fixture.
The inspection remains on `runByInProcessEffect`, and its Candidate capture, persistence, artifact, and public inspection behavior is unchanged.

| Hotspot | Before setup | Before runtime | After setup | After runtime |
| --- | --- | ---: | --- | ---: |
| Candidate Validation inspection | Initialize one repository per fixture | 2.575 s Vitest tests; 4.012 s wall | Initialize one template, then clone per fixture | 1.148 s Vitest tests; 2.602 s wall |
| Acceptance Review | Existing shared initialized template and isolated clone per fixture | 4.011 s Vitest tests; 5.423 s wall | Unchanged | Unchanged |
| Publication | Existing shared initialized template and isolated clone per fixture | 1.947 s Vitest tests; 3.355 s wall | Unchanged | Unchanged |

The Candidate Validation stage passed its focused suite and all complete-quality checks.
Its three-run `just full-quality` medians were measured after the stage.

| Command | Run 1 | Run 2 | Run 3 | Median | Predecessor median | Improvement | Operating budget | Completion gate |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `nix develop -c just full-quality` | 17.657 s | 17.640 s | 17.714 s | 17.657 s | 18.053 s | 2.2% faster | 30 s | 60 s |

Because the first passing stage improved the complete-quality median by less than five percent, optimization stopped as required.
All three runs passed with 321 tests and one intentional skip.

## Blocked by

None - can start immediately.
