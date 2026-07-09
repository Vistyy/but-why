# Introduce validation Effect error taxonomy

## Status

Done.

## Parent

`docs/prds/v1-validation-prd.md`

## What to build

Define typed validation workflow errors for Effect-based validation orchestration.

The taxonomy should make expected validation workflow failures explicit without turning Findings into exceptions.

Findings are validation results that block the Task.

Submit Rejection Errors reject a submitted candidate before But Why? creates a Submission or Validation Run.

Validation Tooling Failures happen after a Validation Run has started and are caused by infrastructure, Sandcastle, Git, GitHub, unavailable sandboxing, command execution tooling, or malformed external output.

Effect error types should live in workflow or adapter seams and should not leak into pure domain entities.

## Acceptance criteria

- [x] Validation workflow errors are represented with `Data.TaggedError`.
- [x] The taxonomy distinguishes Submit Rejection Errors from Validation Tooling Failures.
- [x] Submit Rejection Errors cover repo and global config validation failure.
- [x] Submit Rejection Errors cover missing reviewer profile or invalid reviewer config.
- [x] Repo config validation failures cover unsupported sandbox modes before Validation Run creation.
- [x] Validation Tooling Failures cover validation workspace setup failure.
- [x] Validation Tooling Failures cover unavailable sandboxing at runtime.
- [x] Validation Tooling Failures cover command execution tooling failure separately from a check command's non-zero exit.
- [x] A check command's non-zero exit remains a Finding and is not represented as an Effect failure.
- [x] Validation Tooling Failures cover Reviewer Output Contract Failure after Sandcastle structured output retry is exhausted.
- [x] Validation Tooling Failures cover GitHub publishing and polling tooling failures.
- [x] Findings remain ordinary validation results, not Effect failures.
- [x] Tooling errors can be recorded on a Validation Run without creating Findings.
- [x] CLI rendering still happens at the CLI/output boundary.
- [x] Pure domain modules do not expose Effect types in their public interfaces.
- [x] Tests cover at least one typed tooling error being recorded without moving the Task to `needs_input`.

## Blocked by

- `docs/issues/027-represent-validation-run-separately-from-run.md`
- `docs/issues/036-establish-effect-adoption-baseline.md`
