# Add Fallow codebase health reporting

## Status

Done.

## Parent

`docs/prds/codebase-quality-tooling-prd.md`

## What to build

Add Fallow as the codebase health and architecture analysis tool.

This slice should add `just fallow-check` and include it in the existing `just quality` command, without creating a separate new quality gate concept.

In this issue, active project source means `src/**` and `test/**`, excluding `spikes/**`.
Fallow should be strict and broad for active project source.
The Validation Gate should block on Fallow's graph, dead-code, dependency, duplication, complexity, and health findings for active project source.
Production boundary rules apply to `src/**`.
Tests are checked for health but may cross boundaries when they intentionally test seams or storage behavior.
Historical spike code under `spikes/**` is excluded because it is not active codebase health signal.

But Why? should be treated as a domain-centered modular-monolith CLI.
Domain policy stays pure.
CLI and output serialization stay at the edge.
Repo-local persistence stays behind persistence seams.
Validation execution stays behind validation seams.

Boundary enforcement should start immediately for boundaries that exist today.
Do not enforce future TaskStore, RunStore, or ValidationRuns seams before those seams exist.
Issue 032 remains responsible for broader stable module boundary enforcement after TaskStore, RunStore, and ValidationRuns exist.
If existing active code violates an enforceable boundary, fix the code in this issue before enabling the blocking rule.

It should report useful health information such as cycles, dead code, unused exports, duplication, complexity, and boundary violations that are already safe to check.

Any enabled Fallow rule for active project source must block.
Noisy findings must be fixed, configured, or narrowly suppressed before enabling the check.

Suppressions are allowed only when Fallow cannot see intentional use.
Each suppression must be narrow and must explain why it exists.
Stale suppressions should fail the check.

## Boundary rules to enforce now

- [x] Pure task domain modules do not import CLI, output serialization, persistence, submit, validation, Git, filesystem, process execution, or SQLite concerns.
- [x] Pure run domain modules do not import CLI, output serialization, persistence, submit, Git, filesystem, process execution, or SQLite concerns.
- [x] `src/output/**` is imported only by CLI edge modules and tests.
- [x] Direct `node:sqlite` imports are limited to repo-local persistence and storage initialization modules, plus tests that intentionally inspect storage behavior.
- [x] `src/validation/**` does not import `src/repoState.ts`; shared validation cleanup types live outside the persistence seam.
- [x] Existing `src/submit/**` to `src/validation/**` imports may remain only as documented temporary exceptions until issue 026 introduces `ValidationRuns`.
- [x] Issue 031 does not enforce the submit-to-validation boundary before `ValidationRuns` exists.

## Acceptance criteria

- [x] Fallow is installed as a development tool.
- [x] `just fallow-check` is the one agent-facing Fallow check command used locally and by the Validation Gate checks phase.
- [x] The existing `just quality` command runs `just fallow-check`.
- [x] Fallow analyzes the TypeScript source used by the project.
- [x] Fallow is configured with real app and test entrypoints, including `src/main.ts` and `test/**/*.ts`, instead of suppressing entrypoint files.
- [x] Fallow blocks circular dependencies and re-export cycles for active project source.
- [x] Fallow blocks unresolved imports, unlisted dependencies, unused dependencies, and unused dev dependencies for active project source.
- [x] Fallow blocks duplicate exports, unused files, unused exports, and other provable dead code for active project source, including tests.
- [x] Fallow blocks duplication findings for active project source.
- [x] Fallow uses default duplication thresholds unless a different threshold is justified in the config.
- [x] Fallow blocks complexity and health findings for active project source.
- [x] Fallow uses default health and complexity thresholds unless a different threshold is justified in the config.
- [x] Fallow blocks boundary violations for boundaries that exist today in `src/**`.
- [x] Tests are checked for dead code, dependency, duplication, complexity, and health findings, but production boundary rules do not apply to tests.
- [x] Existing active-code findings are fixed, tuned, or explicitly suppressed before the blocking check is enabled.
- [x] Suppressions are narrow, justified, and checked for staleness.
- [x] `spikes/**` is excluded from blocking Fallow checks.
- [x] Future TaskStore, RunStore, and ValidationRuns boundaries are not enforced before those seams exist.
- [x] Fallow output is actionable enough for agents to repair failures.
- [x] The gate uses Fallow's built-in structured output where useful; no custom serializer is added unless needed.
- [x] Validation checks pass with strict blocking Fallow checks enabled.

## Blocked by

None - can start immediately.
