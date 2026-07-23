# Optimize remaining slow boundary fixtures

## Status

Done.

## Specification

- [Test Suite Feedback Loop Redesign](../specs/test-suite-feedback-loop-redesign.md)

## Behaviors owned

- Each remaining slow boundary hotspot has recorded setup and runtime evidence before optimization, as required by the Test Suite Feedback Loop Redesign.
- Tests reuse initialized Git and SQLite prerequisite state when initialization is not observable behavior.
- Tests use the in-process CLI seam when executable-process behavior is not part of the tested contract.
- Repeated setup is consolidated while each distinct supported scenario, assertion, and prior regression class remains verified.
- Focused tests retain real process concurrency, Git provenance, Candidate capture, publication, SQLite, and Managed Worktree behavior when that external integration is part of the contract.
- Optimization stops when the next passing stage improves the three-run `just full-quality` median by less than five percent, unless the user explicitly approves continuation.

## What to build

Profile the remaining slow boundary fixtures under the accepted three-worker execution model.
Start with Candidate Validation inspection because its repeated repository initialization and executable startup are prerequisites rather than tested behavior.
Use the resulting evidence to optimize Acceptance Review and publication setup when those changes preserve their consequential external contracts.
Reuse immutable initialized repository templates and isolate each mutable Git repository and SQLite state.
Replace executable startup only through an existing supported in-process CLI seam.
Keep the cross-process Task concurrency scenario process-backed.
After each stage, run the focused hotspot suite and the complete quality command.
Record the first passing candidate stage that improves the three-run complete-quality median by less than five percent, then stop unless the user explicitly approves continuation.

## Primary verification seam

Focused hotspot suites plus three consecutive uncontended locked-Nix runs of `just full-quality`.

## Acceptance criteria

- [x] Each changed hotspot records its setup profile and before-and-after runtime evidence.
- [x] Candidate Validation inspection reuses initialized prerequisite state without bypassing its public inspection and persistence behavior.
- [x] Acceptance Review and publication fixtures remove only setup work that is not part of their observable contracts.
- [x] Every distinct process concurrency, Git provenance, Candidate capture, publication, SQLite, and Managed Worktree contract remains covered through a real applicable boundary.
- [x] Mutable Git repositories and SQLite state remain isolated between tests.
- [x] Every migration stage passes its focused hotspot suite and `just full-quality`.
- [x] The first passing candidate stage with less than five percent median complete-quality improvement is recorded, and any continuation has explicit user approval.
- [x] Three final locked-Nix `just full-quality` runs pass within the approved operating and completion budgets.

## Scoped implementation record

- Baseline: `264b8594d96f067161cfce1271e02c82b1f72dd2`.
- Spec review source: this task document.
- Normative traceability: `docs/specs/test-suite-feedback-loop-redesign.md`, `CONTEXT.md`, and `docs/adr/0014-use-module-owned-storage-and-change-transactions.md`.
- Primary public verification seam: focused hotspot boundary suites plus three consecutive locked-Nix `just full-quality` runs after each passing migration stage.

| Acceptance criterion | Implementation target | Public test seam | Verification target |
| --- | --- | --- | --- |
| Record setup and before/after runtime evidence | This task's scoped implementation record and final verification | Focused hotspot suites and `just full-quality` | Per-hotspot timing table and stage medians |
| Reuse Candidate Validation prerequisite state | `test/validation/candidate-validation-inspection.boundary.test.ts` and initialized-repository support | Candidate Validation inspection boundary suite through `runByInProcessEffect` | All inspection and persistence assertions pass with isolated cloned repositories |
| Remove only non-observable Acceptance Review and publication setup | Shared Effect Vitest template layers, isolated clone helpers, and SQLite path rebinding in the Acceptance Review and publication suites | Acceptance Review and publication boundary suites | Existing observable review, publication, SQLite, and Git assertions pass |
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
- Local: seed one captured Candidate in a shared Effect Vitest template layer for Acceptance Review, then clone an isolated repository for each test because Candidate capture is setup while review execution and persistence remain observable behavior.
- Local: seed one captured Candidate and completed Validation Run in a shared Effect Vitest template layer for publication, then clone an isolated repository for each test because publication consumes persisted evidence while its Git and SQLite adapters remain real.
- Local: rebind cloned `changes.repository_common_directory` and `changes.worktree_path` in `cloneInitializedTestRepository` so seeded mutable state remains isolated to each clone.
- Local: use Task 158's passing three-worker `just full-quality` median of `18.053 s` as the predecessor stage comparison for the first stage.
- User-approved: continue optimizing Acceptance Review and publication after the first Candidate Validation stage improved the median by less than five percent, overriding the default stop condition for this implementation session.

## Migration evidence

Candidate-owned Validation Run inspection now initializes one immutable repository template in `beforeAll`, then clones an isolated Git repository and SQLite state for each fixture.
Its public in-process inspection, Candidate capture, persistence, and artifact behavior remains covered.

Acceptance Review now captures one Candidate in a shared Effect Vitest template layer, then clones an isolated repository for each test.
Each test still constructs its own validation service and preserves successor Candidate capture, reviewer execution, SQLite persistence, and Finding assertions.

Publication now captures one Candidate and completes one Validation Run in a shared Effect Vitest template layer, then clones an isolated repository for each test.
The clone helper rebinds persisted repository and worktree paths before publication uses the real SQLite and Git facts.

| Hotspot | Before setup | Before runtime | After setup | After runtime |
| --- | --- | ---: | --- | ---: |
| Candidate Validation inspection | Initialize one repository per fixture | 2.575 s Vitest tests; 4.012 s wall | Initialize one template, then clone per fixture | 1.148 s Vitest tests; 2.602 s wall |
| Acceptance Review | Clone initialized template and capture one Candidate per fixture | 4.011 s Vitest tests; 5.423 s wall | Capture one Candidate in a shared template layer, then clone per fixture | 3.321 s Vitest tests; 4.802 s wall |
| Publication | Clone initialized template, capture a Candidate, and complete a Validation Run per fixture | 1.947 s Vitest tests; 3.355 s wall | Seed Candidate and Validation Run once, then clone and rebind state per fixture | 1.426 s Vitest tests; 2.842 s wall |

The first Candidate Validation stage passed its focused suite and complete-quality checks.
Its three-run median improved from 18.053 s to 17.657 s, or 2.2 percent, so the user explicitly approved continuing with the next measured hotspots.

The Acceptance Review and publication stage passed its focused suites, the complete boundary suite, and complete-quality checks.
Its three-run `just full-quality` medians were measured after both stages.

| Command | Run 1 | Run 2 | Run 3 | Median | Preceding stage median | Improvement | Operating budget | Completion gate |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `nix develop -c just full-quality` | 16.320 s | 16.516 s | 16.436 s | 16.436 s | 17.657 s | 6.9% faster | 30 s | 60 s |

All three runs passed with 321 tests and one intentional skip.
The remaining process concurrency, Candidate capture, and Managed Worktree suites remain process-backed or isolated because their external state is the behavior under test.

## Completion

Implementation commits:

- `e4443eb042ee717a749b92aa79c857e1e81fb7fa` - reuse initialized Candidate Validation repositories.
- `09740ea2a2c2438ab57dd030d5e45e42437edf61` - update the issue graph and unblock the final quality gate.
- `25d5104ce559256ba6e46f27011c33047104f5f3` - reuse captured Candidate and Validation Run fixture state for Acceptance Review and publication.

Verification:

- The Candidate Validation, Acceptance Review, and publication focused suites passed with 16 tests.
- The complete boundary suite passed with 60 tests.
- Three consecutive locked-Nix `just full-quality` runs passed with 321 tests and one intentional skip per run.
- The final `just full-quality` runs were 16.320 s, 16.516 s, and 16.436 s, with a 16.436 s median within the 30-second operating budget and 60-second completion gate.
- Typecheck, formatting, AST-grep, documentation checks, build, and Fallow routine checks passed through `just full-quality`.

Review status:

- Spec: `APPROVED` and latched.
- Standards: `APPROVED WITH REQUIRED COMMENTS` and latched.

## Blocked by

None - can start immediately.
