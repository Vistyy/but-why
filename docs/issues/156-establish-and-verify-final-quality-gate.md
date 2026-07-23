# Establish and verify the final quality interface

## Specification

- [Test Suite Feedback Loop Redesign](../specs/test-suite-feedback-loop-redesign.md)
- [Tooling](../tooling.md)
- [Architecture](../architecture.md)

## Behaviors owned

- Supported complete test and coverage workloads share one fail-fast capacity runner.
- Every blocking Just command returns a truthful status through the locked local toolchain.
- Existing quality commands preserve complete failure diagnostics while successful output remains concise.

## What to build

Harden the routine and full quality commands after the expensive test boundaries and source hierarchy are final.
Preserve complete failure diagnostics while making successful output concise.
Route complete test and coverage workloads through one shared capacity runner while targeted tests remain unlocked.
Remove the replaced duplicate coverage and quality paths.
Update current tooling documentation only after the command behavior is implemented.

## Primary verification seam

A clean local checkout runs `nix develop -c just init`, `nix develop -c just quality`, `nix develop -c just full-quality`, and `git status --short`.

## Acceptance criteria

- [ ] Existing `just quality` and `just full-quality` memberships and performance guarantees remain intact.
- [ ] Successful output is concise, while controlled failures retain test names, errors, diffs, stack traces, and applicable captured output.
- [ ] Coverage continues to produce the required machine-readable artifact without printing the full text table.
- [ ] Complete test and coverage workloads share one fail-fast capacity lock, nested recipes do not reacquire it, and targeted tests remain unlocked.
- [ ] Fallow dependency, dead-code, architecture, coverage-based, and direct health checks retain their selected blocking or advisory status.
- [ ] ast-grep fixtures, formatting, linting, type checking, tests, documentation validation, and build checks pass through Just.
- [ ] No coverage percentage threshold is introduced.
- [ ] `just init`, `just quality`, and `just full-quality` pass in a clean locked-Nix checkout.
- [ ] Both quality commands leave tracked files unchanged.

## Blocked by

- [Task 134](134-remove-incidental-git-from-sqlite-tests.md)
- [Task 135](135-consolidate-source-hierarchy.md)
- [Task 155](155-cover-validation-workspace-recovery.md)
- [Task 157](157-cover-change-implement-handoff-errors.md)
