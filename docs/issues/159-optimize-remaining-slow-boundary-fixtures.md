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

## Blocked by

None - can start immediately.
