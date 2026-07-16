# Run configured Specialists

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

- [ ] No Specialist is enabled by But Why? by default.
- [ ] The active list resolves from Repo Config when present and otherwise Global Config.
- [ ] Definitions resolve Repo Config before Global Config and require instructions.
- [ ] Each Specialist resolves an Agent Profile through the shared profile rules.
- [ ] Specialists receive Candidate and repository evidence but never Acceptance Context.
- [ ] Every configured Specialist runs once for the Candidate.
- [ ] Trustworthy reports appear in configured order regardless of internal scheduling.
- [ ] Any Specialist Finding blocks the Candidate.
- [ ] Tooling failure is reported without inventing a reviewer verdict.

## Blocked by

- `docs/issues/096-run-built-in-acceptance-review.md`
