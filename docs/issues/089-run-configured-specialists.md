# Run configured Specialists

## Status

Done.

## Specification

- `docs/prds/change-centered-validation-prd.md`
- `CONTEXT.md`
- `docs/config.md`

## Behaviors owned

- Global Config may enable reusable Specialists.
- Repo Config may replace the active list and override definitions.
- Every configured Specialist judges the same exact Candidate after Acceptance passes.

## What to build

Run zero, one, or several configured Pi Specialists and return every trustworthy result in configured order.
Keep scheduling internal.

## Primary verification seam

Multi-Specialist Candidate review test with fake Pi sessions.

## Acceptance criteria

- [x] No Specialist is enabled by But Why? by default.
- [x] The active list resolves from Repo Config when present and otherwise Global Config.
- [x] Definitions resolve Repo Config before Global Config and require instructions.
- [x] Each Specialist resolves an Agent Profile through the shared profile rules.
- [x] Specialists receive the exact comparison base, head, and repository workspace, but no earlier phase artifacts or Acceptance Context.
- [x] Every configured Specialist runs once for the Candidate.
- [x] Trustworthy reports appear in configured order regardless of internal scheduling.
- [x] Any Specialist Finding blocks the Candidate.
- [x] Tooling failure is reported without inventing a reviewer verdict.

## Completion

Implemented in `18661e1`; initial review corrections completed through `eebef21`.
Specialist phase naming and review inputs were aligned in `bafea95`.
Spec review: Approved with required comments.
Standards review: Approved.
Quality: Passed - 317 tests, formatting, lint, typecheck, ast-grep, and Fallow checks.

## Blocked by

- `docs/issues/096-run-built-in-acceptance-review.md`
