# Test Suite Feedback Loop Redesign

## Problem Statement

Coding agents use the repository quality command repeatedly while implementing a Change.
The current command takes approximately 104 seconds, emits hundreds of successful-output lines, and can overlap with equivalent coverage workloads from other agents.
Repeated Git setup, SQLite setup, worktree setup, package installation, and operating-system process startup account for most of the cost.
This feedback loop makes ordinary implementation sessions substantially slower and can exhaust devbox resources.

The current suite also repeats expensive boundaries for behavior that a cheaper public interface can prove.
Moving every slow test into another command would hide inefficient test design instead of correcting it.

## Solution

The repository will provide three levels of test feedback.

Targeted tests provide immediate feedback for the behavior under active development.
`just quality` provides routine product feedback that agents can run repeatedly.
`just full-quality` adds the small set of checks that remain expensive because they require a distinct real boundary.

Both quality commands report runtime warnings without changing a successful command exit status.
`just quality` has a maintained 10-second operating budget and must complete within 15 seconds before the test-boundary migration and final quality interface are accepted.
`just full-quality` has a maintained 20-second operating budget and must complete within 30 seconds before that work is accepted.
The commands warn when they exceed their operating budgets during implementation.

The suite will be refactored before tests are assigned to either quality command.
Each behavior variation will use the cheapest public seam that proves the behavior reliably.
Implementation uses existing injected module and phase seams first.
A new production seam is justified only when it expresses a real module boundary and replaces substantial repeated integration setup; test-only hooks and fake abstractions around inherently external behavior are not introduced.
Focused real Git, SQLite, worktree, filesystem, package, and process tests remain only when they prove an externally consequential adapter contract or reproduce a concrete prior regression.
Policy and result permutations use in-process seams.
Duplicate, speculative, impossible-state, and low-value boundary permutations are removed.

Successful test output will be concise.
Failure output will preserve complete test names, errors, diffs, and stack traces.

## User Stories

1. As a coding agent, I want targeted tests to return feedback within a few seconds, so that I can correct one behavior without waiting for unrelated checks.
2. As a coding agent, I want `just quality` to complete within approximately 10 to 15 seconds, so that I can run the blocking product check repeatedly during implementation.
3. As a maintainer, I want `just full-quality` to retain focused expensive boundary checks, so that faster routine feedback does not remove meaningful final confidence.
4. As a maintainer, I want slow tests optimized before they enter the full suite, so that `just full-quality` does not become a dumping ground for inefficient fixtures.
5. As a devbox user, I want complete test and coverage workloads coordinated through one capacity limit, so that parallel agents do not multiply the same heavy workload.
6. As a command user, I want successful checks to print concise results and elapsed time, so that important feedback is visible without hundreds of routine lines.
7. As a command user, I want failures to retain complete diagnostics, so that concise success output does not make defects harder to fix.
8. As a project-quality skill user, I want the skill to support a fast routine gate and an optional project-defined slower gate, so that projects can choose feedback levels without forcing every check into one command.

## Implementation Decisions

### Feedback levels

Targeted test commands remain available for one file or behavior selection.
Targeted tests do not acquire the shared heavy-workload lock.

`just quality` is the routine blocking product command.
It includes routine tests, formatting, linting, type checking, documentation validation, structural checks, applicable non-coverage static checks, and the production build.
It does not generate coverage.

`just full-quality` includes every guarantee from `just quality` plus coverage, coverage-based analysis, and the focused slow boundary suite.
The implementation may share internal recipes so that `just full-quality` does not rerun the same routine tests unnecessarily.
The mechanism that invokes `just full-quality` is not decided by this specification.
Ordinary agent instructions do not tell agents to run `just full-quality`.

### Test placement

A test belongs in the routine suite when an existing public module or CLI interface can prove its behavior without an expensive external boundary.
A test belongs in the slow boundary suite only when a real process, concurrent writer, package installation, Git worktree, or similarly expensive integration proves an externally consequential adapter contract or reproduces a concrete prior regression.

Tests may share immutable fixture inputs.
Tests must not share mutable Git repositories or SQLite state unless isolation and reset behavior are proven.
A slow fixture must be optimized before its test is assigned to the slow boundary suite.
Test count and broad boundary-state coverage are not preservation goals.
The suite preserves supported observable behavior, externally consequential adapter contracts, and concrete prior regression classes.

The packed-file manifest check remains in the routine suite because it is cheap.
Fresh project-local and temporary-prefix global package-install checks belong in the slow boundary suite.
The package-install checks use one packed tarball instead of packing independently.
Testing a future npm-hosted `pnpx` workflow is deferred until npm publication exists.

### Coverage

Routine quality does not generate coverage.
Full quality generates coverage once for the routine product suite.
The slow boundary suite runs without coverage instrumentation.
Coverage retains the machine-readable artifact required by coverage-based analysis.
Routine successful output does not print the full text coverage table.
No coverage percentage threshold is introduced.

### Output and performance

Vitest uses a compact successful-run reporter.
Failed tests retain complete diagnostics.
Each quality command reports its elapsed time after completion.
`just quality` prints an advisory warning above its 10-second operating budget.
`just full-quality` prints an advisory warning above its 20-second operating budget.
Runtime limits do not determine command exit status, but the measured 15-second routine-quality and 30-second full-quality limits are hard completion gates for Tasks 134 and 156.
Acceptance uses the median wall time from three consecutive runs of each quality command in a clean locked-Nix checkout with dependencies installed and no competing heavy workload.
A change that exceeds an operating budget must restore headroom by optimizing, consolidating, or removing lower-value coverage in the same change.

### Heavy-workload coordination

All supported commands that start a complete test or coverage workload use one internal capacity runner.
The capacity runner acquires one shared fail-fast lock.
A second heavy workload exits with an actionable message that identifies the active workload class.
Nested internal recipes execute under the existing lock and do not reacquire it.

The lock is a repository workflow guardrail, not a security boundary.
Direct invocation of underlying tools is outside the supported repository command interface.

### Project-quality skill

The local `project-quality` skill will continue to require `just quality` as the maintained routine blocking interface.
The skill will permit an optional project-defined slower validation command when the project has approved a separate execution lifecycle.
The skill will require explicit ownership, scope, and enforcement for both commands.
The skill will not invent a slower gate or require ordinary agents to invoke one.
The skill will distinguish advisory runtime warnings from blocking correctness failures.

## Testing Decisions

The primary acceptance seam is the repository command interface in the locked Nix environment.
Acceptance verification runs `just quality` and `just full-quality` and observes their checks, exit status, concise output, elapsed-time output, warning behavior, and tracked working-tree cleanliness.

Routine behavior variations use existing in-process CLI and public module interfaces.
Tests use real Git, SQLite, filesystem, or process behavior only when that integration is part of the behavior under test.

Focused adapter and end-to-end tests support the primary seam.
A workflow retains an end-to-end test only when its composition creates a distinct failure mode that focused adapter and in-process orchestration tests cannot prove.
Retained tests cover consequential Git facts, Managed Worktree safety, SQLite persistence and atomicity, cross-process writer behavior, package installation, and other external contracts.

The shared capacity runner has focused command-level tests.
Those tests verify lock contention, fail-fast output, child exit-code forwarding, interruption cleanup, and non-recursive composition.

Reporter verification includes one successful run and one controlled failing run.
The failing run must retain the test name, assertion difference, stack trace, and applicable captured output.
Coverage verification must produce the machine-readable artifact without printing the text coverage table.

Runtime targets are measured on devbox as verification evidence.
Tests do not fail based on wall-clock duration.
Implementation work records before-and-after timings for each refactored hotspot and for both complete quality commands.

The accepted experiment on branch `prototype/fast-task-cli-suite` demonstrated the testing precedent.
It retained all 46 Task CLI tests, reduced the 42 routine tests from approximately 38.66 seconds to 3.15 seconds, and preserved four process-backed tests in a focused file.
The experiment commit is `6779f17`.

## Out of Scope

- Deciding when But Why? or external CI invokes `just full-quality`.
- Adding `just full-quality` to ordinary agent instructions.
- Adding changed-file or dependency-graph test selection.
- Adding hard wall-clock failures.
- Adding coverage percentage thresholds.
- Testing npm-hosted `pnpx` execution before npm publication.
- Removing the opt-in live Herdr smoke test.
- Changing product behavior to make tests faster.
- Changing devbox CPU, memory, or swap configuration.
- Defining the final test-file membership before each hotspot is measured and refactored.

## Further Notes

The measured baseline for the complete non-coverage suite is approximately 103.83 seconds.
The measured baseline for coverage is approximately 108.86 seconds with approximately 1.14 GiB maximum resident memory.
Nine integration-heavy files account for approximately 77 percent of aggregate test time.
Coverage adds approximately five seconds, 289 MiB maximum resident memory, and 143 output lines to the measured baseline.

Parallel Vitest execution means isolated savings do not reduce complete-suite wall time linearly.
Each implementation slice must remeasure the complete suite because removing one critical path exposes the next slow file.
The expected result is approximately 10 to 20 seconds for routine quality and approximately 25 to 40 seconds for full quality.
The maintained operating budgets are 10 seconds for routine quality and 20 seconds for full quality.
The 15-second routine-quality and 30-second full-quality limits are hard completion gates.
Implementation must continue reducing test cost or low-value boundary coverage until both measured commands satisfy their operating budgets and completion limits.
