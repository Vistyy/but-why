# Add configurable quality reviewers

## Parent

`docs/prd.md`

## What to build

Run configured quality reviewers after intent review passes.

Reviewer role names should come from config, not hard-coded architecture assumptions.

## Acceptance criteria

- [ ] Quality reviewers run only after checks and intent review pass.
- [ ] Repo config can define reviewer roles and instruction files.
- [ ] Reviewer roles can resolve inline settings, repo agent profiles, or global agent profiles.
- [ ] Config can run quality reviewers sequentially or in parallel.
- [ ] Each reviewer stores Findings on the Run.
- [ ] Any quality Finding moves the Task to `needs_input`.
- [ ] Empty findings from all quality reviewers allow validation to continue.
- [ ] Token usage is stored per producer and model.
- [ ] Reviewer failures caused by tooling are Run errors, not Findings.

## Blocked by

- 012-add-intent-reviewer-agent.md
