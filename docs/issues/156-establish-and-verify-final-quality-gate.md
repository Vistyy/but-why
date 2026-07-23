# Establish and verify the final quality interface

## Specification

- [Test Suite Feedback Loop Redesign](../specs/test-suite-feedback-loop-redesign.md)
- [Tooling](../tooling.md)
- [Architecture](../architecture.md)

## Behaviors owned

- `just quality` provides concise routine product feedback without coverage.
- `just full-quality` adds coverage, coverage-based analysis, and the focused slow boundary suite.
- Supported complete test and coverage workloads share one fail-fast capacity runner.
- Every blocking Just command returns a truthful status through the locked local toolchain.
- Both quality commands report elapsed time and advisory runtime warnings without turning those warnings into failures.

## What to build

Establish the routine and full quality commands after the expensive test boundaries and source hierarchy are final.
Generate machine-readable coverage once for the routine suite without printing the text coverage table.
Preserve complete failure diagnostics while making successful output concise.
Route complete test and coverage workloads through one shared capacity runner while targeted tests remain unlocked.
Remove the replaced duplicate coverage and quality paths.
Update current tooling documentation only after the command behavior is implemented.

## Primary verification seam

A clean local checkout runs `nix develop -c just init`, `nix develop -c just quality`, `nix develop -c just full-quality`, and `git status --short`.

## Acceptance criteria

- [ ] `just quality` runs routine tests and every selected routine blocking check without generating coverage.
- [ ] `just full-quality` provides every routine guarantee plus machine-readable coverage, coverage-based analysis, and the focused slow boundary suite.
- [ ] Full quality does not rerun the same routine tests unnecessarily.
- [ ] Successful output is concise, while controlled failures retain test names, errors, diffs, stack traces, and applicable captured output.
- [ ] Coverage produces the required machine-readable artifact without printing the full text table.
- [ ] `just quality` warns above 15 seconds and `just full-quality` warns above 30 seconds without changing a successful exit status.
- [ ] Complete test and coverage workloads share one fail-fast capacity lock, nested recipes do not reacquire it, and targeted tests remain unlocked.
- [ ] Fallow dependency, dead-code, architecture, coverage-based, and direct health checks retain their selected blocking or advisory status.
- [ ] ast-grep fixtures, formatting, linting, type checking, tests, documentation validation, and build checks pass through Just.
- [ ] No coverage percentage threshold is introduced.
- [ ] `just init`, `just quality`, and `just full-quality` pass in a clean locked-Nix checkout.
- [ ] Both quality commands leave tracked files unchanged.
- [ ] The achieved routine and full-quality runtimes are recorded against the 15-second and 30-second soft targets.

## Blocked by

- [Task 134](134-remove-incidental-git-from-sqlite-tests.md)
- [Task 135](135-consolidate-source-hierarchy.md)
- [Task 155](155-cover-validation-workspace-recovery.md)
- [Task 157](157-cover-change-implement-handoff-errors.md)
