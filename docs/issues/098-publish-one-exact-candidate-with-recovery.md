# Publish one exact Candidate with recovery

## Specification

- `docs/prds/change-centered-validation-prd.md`
- `CONTEXT.md`
- `docs/adr/0011-keep-v1-pr-heads-locally-owned.md`

## Behaviors owned

- One exact passing Candidate creates or updates one locally owned PR.
- Ambiguous remote responses never create duplicate PRs.
- PR content is deterministic and merge remains human-controlled.

## What to build

Publish through a fakeable GitHub seam with exact-head checks, durable PR identity, and lost-response recovery as one safe capability.

## Primary verification seam

Fake GitHub publication test covering success and a lost create response.

## Acceptance criteria

- [ ] Publication requires passing evidence for the exact current Candidate and policy.
- [ ] Immediately before remote mutation, the Task branch must still equal the validated head.
- [ ] Repository, base target, head branch, and expected SHA are explicit publication facts.
- [ ] The PR title and body are generated deterministically from Task and validation facts.
- [ ] Durable markers and lookup recover a successful remote creation whose response was lost.
- [ ] Repeated publication reuses the owned PR and never creates a second one.
- [ ] A newer validated Candidate updates only the expected owned head.
- [ ] But Why? never approves or merges the PR.

## Blocked by

- `docs/issues/089-run-configured-specialists.md`
- `docs/issues/092-recheck-reviewer-findings-without-anchoring.md`
- `docs/issues/096-run-built-in-acceptance-review.md`
