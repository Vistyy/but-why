# Establish and verify the final quality interface

## Status

Done.

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

- [x] Existing `just quality` and `just full-quality` memberships and performance guarantees remain intact.
- [x] Successful output is concise, while controlled failures retain test names, errors, diffs, stack traces, and applicable captured output.
- [x] Coverage continues to produce the required machine-readable artifact without printing the full text table.
- [x] Complete test and coverage workloads share one fail-fast capacity lock, nested recipes do not reacquire it, and targeted tests remain unlocked.
- [x] Fallow dependency, dead-code, architecture, coverage-based, and direct health checks retain their selected blocking or advisory status.
- [x] ast-grep fixtures, formatting, linting, type checking, tests, documentation validation, and build checks pass through Just.
- [x] No coverage percentage threshold is introduced.
- [x] `just init`, `just quality`, and `just full-quality` pass in a clean locked-Nix checkout.
- [x] Both quality commands leave tracked files unchanged.

## Scoped implementation record

- Baseline: `abb7c816f3c2025a02213ddf1489ff4cbeede351`.
- Spec review source: this task draft.
- Normative traceability: `docs/specs/test-suite-feedback-loop-redesign.md`, `docs/tooling.md`, and `docs/architecture.md`.
- Primary seam: `nix develop -c just init`, `nix develop -c just quality`, `nix develop -c just full-quality`, and `git status --short`.

| Acceptance criterion | Implementation target | Public test seam | Verification target |
| --- | --- | --- | --- |
| Quality suite membership and performance remain intact | `justfile` quality compositions | `just quality` and `just full-quality` | Three-run command timings and suite summaries |
| Success is concise and failure diagnostics remain complete | `vitest.config.ts` reporter configuration | Controlled Vitest success and failure runs | Reporter output assertions and quality commands |
| Coverage emits machine-readable output without a text table | `vitest.config.ts` coverage reporters and `just coverage` | Coverage command | Coverage artifact and output inspection |
| Complete workloads share fail-fast capacity while targeted tests stay unlocked | `scripts/run-test-workload.sh`, `scripts/with-capacity-lock.sh`, and `justfile` test recipes | Public Just-interface and capacity runner tests | Contention, child status, interruption, nested invocation, and targeted selection tests |
| Fallow and direct health checks retain their selected status | Existing `justfile` health compositions | `just quality`, `just full-quality`, and `just health` | Blocking and advisory exit statuses |
| Static, build, and documentation checks remain in the gates | Existing Just quality compositions | Quality commands | ast-grep, format, lint, type, docs, Fallow, and build output |
| No coverage threshold is introduced | Existing Vitest and Fallow configuration | Coverage and health commands | Configuration and command verification |
| Clean locked-Nix commands pass | Repository toolchain | Primary command seam | `nix develop -c just init`, `quality`, and `full-quality` |
| Quality commands leave tracked files unchanged | Quality command compositions | Primary command seam | `git status --short` after both gates |

Required validation commands are `just test test/repository/quality-interface.boundary.test.ts`, `BY_VERIFY_QUALITY_COVERAGE=1 just test test/repository/quality-interface.boundary.test.ts`, `just typecheck`, `just format-check`, `just lint`, `just docs-check`, `just ast-grep-check`, `just quality`, `just full-quality`, `just health`, and the locked-Nix primary seam.

## Decision ledger

- Local: use one shell capacity runner backed by a lock in the Git Common Directory so linked worktrees share the repository workflow guardrail.
- Local: mark the active workload class beside the lock and fail fast with an actionable message rather than waiting for capacity.
- Local: use an inherited `BY_CAPACITY_LOCK_HELD` marker so nested internal commands execute under the existing lock without reacquiring it.
- Local: run each locked workload in its own process group so interruption cleanup terminates descendants before releasing capacity.
- Local: use Vitest's dot reporter because it removes routine per-test success lines while retaining Vitest's complete failed-test diagnostics.
- User-approved: the original Task 156 request explicitly approved the shared capacity lock, concise Vitest reporter, truthful Just statuses, and complete-workload coordination; the follow-up approval authorized moving the process-heavy quality-interface tests into the boundary suite.
- Local: preserve the existing suite selection, runtime warning budgets, advisory health coverage, and absence of a coverage threshold because the approved specification assigns those behaviors outside this implementation choice.

## Completion evidence

- Implementation: `323e6ce66d4a9ec83a9c16e8c4944ca4aec1c696`.
- Completion and review-correction commits: `18ff84a`, `42f6837`, `f067868`, `9f79ca8`, and `9b79e3a`.
- Focused quality-interface boundary tests passed with six tests, plus the seven-test coverage-interface verification mode.
- The complete boundary suite passed with 66 tests.
- Static checks, build, documentation validation, and the advisory health report passed through Just.
- Three consecutive locked-Nix runs measured `just quality` at 6.513s, 6.634s, and 6.629s, with a median of 6.629s.
- Three consecutive locked-Nix runs measured `just full-quality` at 17.758s, 17.757s, and 17.495s, with a median of 17.757s.
- The quality-interface boundary tests are excluded from routine quality and retained in full quality.
- The locked-Nix primary seam passed `just init`, `just quality`, and `just full-quality`.
- The quality and full-quality runs left only the task implementation changes in the tracked working tree.
- Coverage produced `coverage/coverage-final.json` without a text coverage table.
- Spec review: `APPROVED` and latched.
- Standards review: `APPROVED` and latched.

## Blocked by

None - completed prerequisites.
