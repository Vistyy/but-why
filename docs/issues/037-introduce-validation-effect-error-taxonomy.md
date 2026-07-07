# Introduce validation Effect error taxonomy

## Status

Not done.

## Parent

`docs/prds/v1-validation-prd.md`

## What to build

Define typed validation workflow errors for Effect-based validation orchestration.

The taxonomy should make expected validation workflow failures explicit without turning Findings into exceptions.

Findings are validation results that block the Task.

Tooling errors are Run errors caused by infrastructure, configuration, Sandcastle, Git, GitHub, or malformed external output.

Effect error types should live in workflow or adapter seams and should not leak into pure domain entities.

## Acceptance criteria

- [ ] Validation workflow errors are represented with `Data.TaggedError` or an equivalent typed Effect error shape.
- [ ] The taxonomy covers validation workspace setup failure.
- [ ] The taxonomy covers repo and global config validation failure.
- [ ] The taxonomy covers invalid sandbox mode or unavailable sandboxing.
- [ ] The taxonomy covers command execution tooling failure separately from a check command's non-zero exit.
- [ ] The taxonomy covers reviewer structured output failure after Sandcastle retry is exhausted.
- [ ] The taxonomy covers missing reviewer profile or invalid reviewer config.
- [ ] The taxonomy covers GitHub publishing and polling tooling failures.
- [ ] Findings remain ordinary validation results, not Effect failures.
- [ ] Tooling errors can be recorded on a Validation Run without creating Findings.
- [ ] CLI rendering still happens at the CLI/output boundary.
- [ ] Pure domain modules do not expose Effect types in their public interfaces.
- [ ] Tests cover at least one typed tooling error being recorded without moving the Task to `needs_input`.

## Blocked by

- `docs/issues/027-represent-validation-run-separately-from-run.md`
- `docs/issues/036-establish-effect-adoption-baseline.md`
