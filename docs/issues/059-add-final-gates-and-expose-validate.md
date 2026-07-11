# Add final gates and expose by validate

## Parent

`docs/prds/change-centered-validation-prd.md`

## What to build

After checks pass and every Specialist is complete, run Final Review and applicable Acceptance Review in parallel against the same Candidate.
Fix their combined Findings, rerun both final reviewers until the Candidate passes, and expose the complete standalone flow as `by validate`.

## Acceptance criteria

- [ ] Final Review checks whole-change integration and fix interactions without repeating Specialist concerns.
- [ ] Acceptance Review checks the Candidate against immutable Acceptance Context.
- [ ] A Change without Acceptance Context skips Acceptance Review explicitly.
- [ ] Final and Acceptance Review start only after all Specialists are complete and checks pass.
- [ ] Both reviewers inspect the same exact Candidate and run in parallel.
- [ ] Findings from either reviewer enter one Fixer cycle, followed by checks and both final reviewers.
- [ ] Resolved Final and Acceptance Findings link to an eligible successor result without mutating the original Finding.
- [ ] The Validation Run becomes eligible only after every required final review returns no Findings.
- [ ] `by validate` uses Issue 051's shared capability to automatically resolve the Change and capture or reuse the current Candidate before running the complete Validation Gate.
- [ ] `by validate` runs the complete Validation Gate on a standalone Change and never publishes.
- [ ] Structured output distinguishes active, passed, blocked, Needs Input precursor, and tooling-failure outcomes.

## Blocked by

- `docs/issues/054-link-tasks-to-changes-and-project-status.md`
- `docs/issues/055-add-shared-read-only-reviewer-runner.md`
- `docs/issues/058-close-specialist-fixing-loop.md`
