---
status: accepted
---

# Preserve exact Candidate provenance through Submission

But Why judges and publishes an exact Candidate identified by its Change, freshly fetched remote Change Base commit, and locally owned Repository Branch head commit.
Submission requires the Repository Branch to contain that Change Base before Candidate creation.
But Why publishes only that validated local head through an owned pull request and never adopts an unexpected remote head.

## Considered Options

- Accept local or stale Change Bases and reconcile identity later.
- Treat a matching head commit as sufficient retry evidence.
- Preserve exact remote-base, local-head, validation, and publication evidence throughout Submission.

## Consequences

Change Start fetches the remote default branch or named base branch and records the publication remote URL.
Submission rejects a publication remote name that later resolves to a different URL.
Submission reconciles an existing owned pull request before fetching a newer Change Base because terminal pull request facts take precedence.
A new Submission fetches the recorded Change Base and rejects divergence before Candidate or Validation Run creation.
But Why does not modify the Managed Worktree or Repository Branch to satisfy ancestry.

Tracked-tree equality between the exact Change Base and Repository Branch head defines No-Change after ancestry passes.
A changed Candidate completes only through its exact owned pull request.
A passing Task-backed No-Change Submission can complete without a pull request after Acceptance Review passes.
A taskless No-Change Submission returns `nothing_to_submit` and remains open.

Completed Submissions retain their Candidate, Validation Policy Snapshot, validation, and publication evidence.
Later configuration or Change Base changes do not invalidate completed evidence.
A repeated Submit returns stored success only when durable evidence identifies the same exact Candidate and confirmed publication or No-Change completion.
