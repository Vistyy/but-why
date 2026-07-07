# Establish Effect adoption baseline

## Status

Done.

## Parent

`docs/prds/v1-validation-prd.md`

## What to build

Make Effect a deliberate validation orchestration tool instead of a thin Promise wrapper.

This slice should update the dependency baseline and document where Effect belongs in But Why.

Effect should be used for workflow orchestration, typed failures, resource lifecycles, scheduling, concurrency, and runtime boundary validation.

Pure domain modules should remain plain TypeScript.

Sandcastle remains the execution engine for worktrees, commands, agents, logs, structured output retries, and token usage.

## Acceptance criteria

- [x] The `effect` dependency is upgraded to `3.21.4` after checking release notes, and `pnpm-lock.yaml` is refreshed.
- [x] Architecture docs state that Effect belongs at validation workflow, adapter, resource, retry, concurrency, and schema-validation seams.
- [x] Architecture docs state that pure Task, Validation Run, Finding, and policy modules should not expose Effect types.
- [x] Architecture docs preserve the distinction between Findings and Validation Tooling Failures.
- [x] Architecture docs preserve Sandcastle ownership of command execution, agent execution, logs, structured output retry, and token usage capture.
- [x] No broad migration to `@effect/cli`, `@effect/platform`, or `@effect/ai` is added in this slice, verified by dependency review.
- [x] Direct Effect runtime execution remains limited to `src/main.ts`.
- [x] Existing tests, typecheck, ast-grep, and Fallow checks pass.

## Blocked by

None.
