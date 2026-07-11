# Add the shared read-only reviewer runner

## Parent

`docs/prds/change-centered-validation-prd.md`

## What to build

Create one Sandcastle-backed execution boundary for Specialist, Final, and Acceptance Reviewers.
It receives immutable Candidate and policy inputs, optional Acceptance Context, and produces typed reviewer results without write access.

## Acceptance criteria

- [ ] A reviewer runs against the exact Candidate in a read-only Validation Workspace.
- [ ] Reviewer input includes its role, instructions, policy, repository guidance, and optional Acceptance Context.
- [ ] Structured output distinguishes Findings, no Findings, invalid output, tooling failure, and interrupted execution.
- [ ] Artifacts and token usage are recorded for inspection.
- [ ] Reviewer executions cannot modify the Change Workspace, publish, or resolve Findings directly.
- [ ] The runner is shared by all reviewer roles without embedding their orchestration rules.

## Blocked by

- `docs/issues/049-configure-default-agent-harness-during-setup.md`
- `docs/issues/053-freeze-policy-and-make-validation-idempotent.md`
