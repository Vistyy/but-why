# Add configurable quality reviewers

## Status

Not done.

## Parent

`docs/prds/v1-validation-prd.md`

## What to build

Run configured Quality Reviewers after Acceptance Review passes.

Reviewer role names should come from config, not hard-coded architecture assumptions.

## Acceptance criteria

- [ ] Quality Reviewers run only after checks and Acceptance Review pass.
- [ ] Quality reviewers run inside the Validation Workspace, not the user's checkout.
- [ ] Repo config can define reviewer roles and instruction files.
- [ ] Reviewer roles can resolve inline settings, repo agent profiles, or global agent profiles.
- [ ] Config can run quality reviewers sequentially or in parallel.
- [ ] Parallel quality reviewer mode uses bounded Effect concurrency.
- [ ] Sequential quality reviewer mode preserves deterministic reviewer ordering.
- [ ] Each reviewer stores Findings on the Validation Run.
- [ ] Any quality Finding moves the Task to `needs_input`.
- [ ] Empty findings from all quality reviewers allow validation to continue.
- [ ] Token usage is stored per producer and model.
- [ ] Reviewer failures caused by tooling are Validation Tooling Failures, not Findings.
- [ ] Parallel reviewer execution records per-reviewer producer identity and does not collapse errors ambiguously.

## Blocked by

- `docs/issues/021-build-reviewer-model-eval-harness.md`
- `docs/issues/037-introduce-validation-effect-error-taxonomy.md`
- `docs/issues/039-validate-config-and-reviewer-contracts-with-effect-schema.md`
