# Record Code-Writing Executions and fix check Findings

## Parent

`docs/prds/change-centered-validation-prd.md`

## What to build

Add the shared Code-Writing Execution record and use a fresh Fixer Execution to address check Findings during standalone validation.
The Fixer writes only through the attached clean checkout, commits a successor Candidate, and returns to validation.

## Acceptance criteria

- [ ] Every Implementer or Fixer invocation records its role, expected head, workspace, status, timestamps, result, Artifacts, failures, and Implementation Decisions.
- [ ] A Fixer Execution records its input Candidate, Validation Run, and assigned Findings.
- [ ] Standalone fixing verifies a clean checkout and expected head immediately before writing.
- [ ] Enabled automatic fixing commits a successor Candidate and reruns the complete configured check set.
- [ ] Disabled automatic fixing returns a typed blocker for Change-owned Needs Input.
- [ ] Resolved check Findings link to the eligible successor result without mutating the original Finding.
- [ ] Unexpected edits, head movement, interruption, or dirty crash recovery preserve work without reset or overwrite.
- [ ] Only one Code-Writing Execution writes to a Change Workspace at a time.
- [ ] The configurable safety budget counts Implementer and Fixer Executions together.

## Blocked by

- `docs/issues/049-configure-default-agent-harness-during-setup.md`
- `docs/issues/053-freeze-policy-and-make-validation-idempotent.md`
