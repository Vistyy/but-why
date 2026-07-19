# Publish one exact Candidate with recovery

## Specification

- `docs/prds/change-centered-validation-prd.md`
- `docs/specs/taskless-changes-and-worktree-handoff.md`
- `CONTEXT.md`
- `docs/adr/0011-keep-v1-pr-heads-locally-owned.md`

## Behaviors owned

- One exact passing Candidate creates or updates one Change-owned PR.
- Task-backed and taskless Changes receive deterministic PR metadata.
- Ambiguous remote responses never create duplicate PRs.

## What to build

Publish through a fakeable GitHub seam with exact-head checks, durable Change-owned PR identity, deterministic metadata, and lost-response recovery as one safe capability.

## Primary verification seam

Fake GitHub publication tests covering Task-backed and taskless success plus a lost create response.

## Acceptance criteria

- [x] Publication requires passing evidence for the exact current Candidate and policy.
- [x] Immediately before remote mutation, the Change branch still equals the validated head.
- [x] Repository, base target, head branch, and expected SHA are explicit publication facts.
- [x] Task-backed PR metadata is generated deterministically from Task and validation facts.
- [x] A taskless PR title uses the first non-merge commit subject after the starting commit and falls back to `Change <short-change-id>`.
- [x] A taskless PR body is generated from Change, Candidate, and Validation Run facts.
- [x] Durable markers and lookup recover a successful remote creation whose response was lost.
- [x] Repeated publication reuses the Change-owned PR and never creates a second one.
- [x] A newer validated Candidate updates only the expected owned head.
- [x] But Why? never approves or merges the PR.

## Completion evidence

- Implementation: `b0dc6a8` through `4364a3b`.
- Verification: `just quality`.

## Blocked by

- `docs/issues/089-run-configured-specialists.md`
- `docs/issues/092-recheck-reviewer-findings-without-anchoring.md`
- `docs/issues/096-run-built-in-acceptance-review.md`
- `docs/issues/133-start-prepared-changes.md`
