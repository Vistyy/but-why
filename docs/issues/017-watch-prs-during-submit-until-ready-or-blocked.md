# Watch PRs during submit until ready or blocked

## Status

Not done.

## Parent

`docs/prd.md`

## What to build

Extend `by submit` to watch the GitHub PR until it reaches a clear outcome.

A clean PR moves the Task to `ready`, while PR problems become blocking Findings.

## Acceptance criteria

- [ ] Submit watches the PR after publishing.
- [ ] A mergeable PR with required checks passing moves the Task to `ready`.
- [ ] CI failure creates a blocking Finding.
- [ ] Merge conflict creates a blocking Finding.
- [ ] Active requested changes create a blocking Finding.
- [ ] Timeout while checks remain pending creates a blocking Finding.
- [ ] Blocking PR Findings move the Task to `needs_input`.
- [ ] GitHub tooling errors mark the Run as error and return the Task to its previous state.
- [ ] Submit prints state, summary, next action, and PR URL when relevant.

## Blocked by

- 016-publish-clean-runs-to-github-prs.md
