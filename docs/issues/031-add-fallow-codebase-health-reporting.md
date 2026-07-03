# Add Fallow codebase health reporting

## Status

Not done.

## Parent

`docs/prds/codebase-quality-tooling-prd.md`

## What to build

Add Fallow as the codebase health and architecture analysis tool.

This first slice should make Fallow runnable locally and through the quality gate without overfitting module boundaries before the store seams settle.

It should report useful health information such as cycles, dead code, unused exports, duplication, complexity, and boundary violations that are already safe to check.

Noisy rules may start in report mode instead of blocking mode.

## Acceptance criteria

- [ ] Fallow is installed as a development tool.
- [ ] A Fallow command can be run locally through package scripts or the task runner.
- [ ] Fallow analyzes the TypeScript source used by the project.
- [ ] Fallow reports cycles where supported.
- [ ] Fallow reports dead code or unused exports where supported.
- [ ] Fallow reports duplication or complexity health where supported.
- [ ] The quality gate runs the stable Fallow checks.
- [ ] Noisy checks are kept non-blocking or deferred.
- [ ] Fallow output is actionable enough for agents to repair failures.
- [ ] Quality passes with the stable Fallow checks enabled.

## Blocked by

None - can start immediately.
