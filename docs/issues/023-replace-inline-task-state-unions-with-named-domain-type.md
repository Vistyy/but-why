# Centralize Task lifecycle state language behind narrow seams

## Status

Not done.

## Parent

`docs/prds/v1-validation-prd.md`

## What to build

Create a small Task lifecycle seam that owns the canonical Task state vocabulary and legal state transitions.

Replace scattered inline Task state unions, transition maps, and command-specific state lists with named domain types or narrow policy seams.

The lifecycle seam should own shared Task state facts such as `TaskState`, `taskStates`, and valid state transitions.

Use these task-owned seams:

- `src/task/lifecycle.ts` for `TaskState`, `taskStates`, `isTaskState`, and `canTransition(from, to)`.
- `src/task/submitPolicy.ts` for submit eligibility, including `SubmitEligibleState` and `canSubmitFrom(state)`.
- `src/task/startPolicy.ts` for start eligibility, including `canStartFrom(state)`.

Use short function names because the file path gives the Task context.

Command-specific rules should stay in focused policy seams that depend on the lifecycle seam, rather than growing one god interface.

Callers should import from the focused seam they need.
Do not rebuild a broad Task state interface through a barrel export.

Use Effect Schema at input, persistence, or CLI boundaries where parsing unknown data is needed.
Keep lifecycle and command policy rules as plain domain functions.

In scope:

- Submit eligibility and recovery state language, with recovery modeled as restoring the previous submittable Task state.
- Task start eligibility language, exposed as an operation rule such as `canStartFrom(state)` rather than an unstartable-state list.
- Valid Task state transitions.
- Removal of inline unions such as `"implementing" | "needs_input"` from domain code.
- Removal of duplicated Task transition paths from tests.
- Removal of redundant old production helpers, lists, and pass-through code after callers move to the focused seams.
- A drift test for durable Task state constraints that must still use SQL string literals.

Out of scope:

- Dashboard actionability and dashboard ordering.
- Behavior changes to Task lifecycle, submit, start, dashboard, or persistence.
- A broad catch-all Task state interface that every caller imports.

This is a standalone cleanup task and does not need to fit into the larger implementation graph.

## Acceptance criteria

- [ ] `src/task/lifecycle.ts` owns the canonical Task state vocabulary and hides the valid transition graph behind `canTransition(from, to)`.
- [ ] `src/task/submitPolicy.ts` owns submit eligibility through `canSubmitFrom(state)` and a stored-state type such as `SubmitEligibleState`.
- [ ] Submit recovery stores the previous submit-eligible Task state instead of introducing a separate recovery-state concept.
- [ ] `src/task/startPolicy.ts` owns start eligibility through `canStartFrom(state)`.
- [ ] Domain callers ask focused lifecycle or policy questions such as `canTransition(from, to)`, `canSubmitFrom(state)`, or `canStartFrom(state)` instead of importing raw state lists or repeating inline state unions.
- [ ] No new inline Task state string unions are introduced in domain code.
- [ ] Tests use lifecycle or policy helpers instead of copying Task transition paths.
- [ ] Redundant old production helpers, state lists, and pass-through exports are deleted after callers move to the focused seams.
- [ ] Durable storage constraints that duplicate Task state strings are covered by a drift test against `taskStates`.
- [ ] Dashboard actionability is not pulled into the Task lifecycle seam as part of this issue.
- [ ] Existing Task state behavior remains unchanged.

## Blocked by

- `docs/issues/011-create-validation-workspaces-through-sandcastle.md`
