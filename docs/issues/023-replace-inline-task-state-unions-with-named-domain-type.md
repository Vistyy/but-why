# Centralize Task lifecycle state language behind narrow seams

## Status

Done.

## Parent

`docs/prds/v1-validation-prd.md`

## What to build

Create a small Task lifecycle seam that owns the canonical Task state vocabulary and legal state transitions.

Replace scattered inline Task state unions, transition maps, and command-specific state lists with named domain types or narrow policy seams.

The lifecycle seam should own shared Task state facts such as `TaskState`, `taskStates`, and valid state transitions.

Use these task-owned seams:

- `src/task/lifecycle.ts` for `TaskState`, `taskStates`, `isTaskState`, and `canTransition(from, to)`.
- `src/task/submitPolicy.ts` for submit eligibility, including `SubmitEligibleState` and `canSubmitFrom(state)`.
  `canSubmitFrom(state)` should be a TypeScript type guard that narrows to `SubmitEligibleState`.
- `src/task/startPolicy.ts` for start eligibility, including `canStartFrom(state)`.

`canStartFrom(state)` answers whether `by start` may succeed from that state.
Starting from `implementing` remains an idempotent success with the same success output, but `implementing -> implementing` is not a valid Task Lifecycle transition.

Use short function names because the file path gives the Task context.

Command-specific rules should stay in focused policy seams that depend on the lifecycle seam, rather than growing one god interface.

Callers should import from the focused seam they need.
Do not rebuild a broad Task state interface through a barrel export.

Use Effect Schema at input, persistence, or CLI boundaries where parsing unknown data is needed.
Keep lifecycle and command policy rules as plain domain functions.

In scope:

- Submit eligibility and recovery state language, with recovery modeled as restoring the previous `SubmitEligibleState`.
- Task start eligibility language, exposed as an operation rule such as `canStartFrom(state)` rather than an unstartable-state list.
- Valid Task state transitions.
- Removal of inline unions such as `"implementing" | "needs_input"` from domain TypeScript code.
  SQL constraints and CLI help text may still contain Task state string literals at boundaries.
- Removal of duplicated Task transition paths from tests.
  One lifecycle test may list the full transition graph to prove the canonical graph is correct.
  Other tests should use `canTransition` instead of copying transition paths.
- Removal of redundant old production helpers, lists, and pass-through code after callers move to the focused seams.
- A drift test for durable Task state constraints that must still use SQL string literals.

Out of scope:

- Dashboard actionability and dashboard ordering.
- Behavior changes to Task lifecycle, submit, start, dashboard, or persistence.
- A broad catch-all Task state interface that every caller imports.

This is a standalone cleanup task and does not need to fit into the larger implementation graph.

## Acceptance criteria

- [x] `src/task/lifecycle.ts` owns the canonical Task state vocabulary and hides the valid transition graph behind `canTransition(from, to)`.
- [x] `src/task/submitPolicy.ts` owns submit eligibility through `canSubmitFrom(state)` and a stored-state type such as `SubmitEligibleState`.
  `canSubmitFrom(state)` is a TypeScript type guard that narrows to `SubmitEligibleState`.
- [x] Submit recovery stores the previous `SubmitEligibleState` instead of introducing a separate recovery-state concept.
- [x] `src/task/startPolicy.ts` owns start eligibility through `canStartFrom(state)`.
  `canStartFrom("implementing")` returns true because `by start` is idempotent from `implementing`.
  `canTransition("implementing", "implementing")` returns false because same-state command no-ops are not Task Lifecycle transitions.
- [x] Domain callers ask focused lifecycle or policy questions such as `canTransition(from, to)`, `canSubmitFrom(state)`, or `canStartFrom(state)` instead of importing raw state lists or repeating inline state unions.
- [x] No new inline Task state string unions are introduced in domain TypeScript code.
  SQL constraints and CLI help text may still use Task state literals at boundaries.
- [x] Tests use lifecycle or policy helpers instead of copying Task transition paths.
  At most one lifecycle test lists the full canonical transition graph.
- [x] Redundant old production helpers, state lists, and pass-through exports are deleted after callers move to the focused seams.
  Old import paths are not kept through compatibility exports.
- [x] Durable storage constraints that duplicate Task state strings are covered by a drift test against `taskStates`.
- [x] Dashboard actionability is not pulled into the Task lifecycle seam as part of this issue.
- [x] Existing Task state behavior remains unchanged.

## Blocked by

- `docs/issues/011-create-validation-workspaces-through-sandcastle.md`
