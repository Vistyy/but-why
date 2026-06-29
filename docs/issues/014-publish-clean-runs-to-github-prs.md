# Publish clean Runs to GitHub PRs

## Parent

`docs/prd.md`

## What to build

After local validation has no Findings, publish the task branch through GitHub PRs.

This slice records the PR path but does not yet need to watch CI until final readiness.

## Acceptance criteria

- [ ] Clean local validation pushes the task branch to the detected GitHub remote.
- [ ] But Why opens a PR when one does not exist.
- [ ] But Why updates or reuses the PR when one already exists for the Task branch.
- [ ] PR URL and GitHub identifiers are recorded.
- [ ] PR creation errors mark the Run as error and return the Task to its previous state.
- [ ] But Why does not merge the PR.
- [ ] V1 has no non-PR publishing path.

## Blocked by

- 013-add-configurable-quality-reviewers.md
