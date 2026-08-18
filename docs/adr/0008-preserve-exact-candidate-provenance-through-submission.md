---
status: accepted
---

# Preserve exact Candidate provenance through Submission

But Why judges and publishes an exact Candidate identified by its Change, freshly fetched remote Change Base commit, and locally owned Repository Branch head commit.
Submission requires the Repository Branch to contain that Change Base before Candidate creation.
But Why publishes only that validated local head through an owned pull request and never adopts an unexpected remote head.
Current publication facts record the exact Candidate, Validation Run, target, head branch, expected head commit, and owned pull request.
An Open Change can publish a revised Candidate to the same owned pull request after the revised Candidate passes Submission.
A shared pure owned-pull-request identity classifier consumes repository, base branch, head branch, head commit, pull-request state, and merge facts for Submit, publication, and reconciliation without sharing lifecycle orchestration.
Submit observes the current owned pull request and passes an exact merged owned pull request to terminal completion.

## Considered Options

- Accept local or stale Change Bases and reconcile identity later.
- Treat a matching head commit as sufficient retry evidence.
- Preserve exact remote-base, local-head, validation, and publication evidence throughout Submission.

## Consequences

Change Start fetches the remote default branch or named base branch and records the publication remote URL.
Submission rejects a publication remote name that later resolves to a different URL.
Submission observes an existing owned pull request before fetching a newer Change Base because terminal pull request facts take precedence.
An exact open owned pull request continues normally.
An open owned pull request whose only mismatch is its head commit continues through Candidate capture and validation without reusing completed publication evidence.
If that pull request then identifies the exact current validated Candidate, publication reconfirms the Remote Change Branch, skips a duplicate push, preserves the pull request title, requests the open state and current generated body, and confirms the exact publication facts.
Pull request metadata is presentation and is not Candidate identity or completed publication evidence.
If the Remote Change Branch remains at the previously published head, publication retains the exact force-with-lease safeguard.
An exact closed-unmerged owned pull request is reopened and updated by publication.
An exact merged owned pull request is passed to terminal completion.
Any other mismatched or unavailable pull request facts stop safely without durable lifecycle mutation.
Submit does not run full reconciliation or cleanup.
A new Submission fetches the recorded Change Base and rejects divergence before Candidate or Validation Run creation.
But Why does not modify the Managed Worktree or Repository Branch to satisfy ancestry.

Tracked-tree equality between the exact Change Base and Repository Branch head returns `nothing_to_submit` after ancestry passes.
A changed Candidate completes only through its exact owned pull request.
A `nothing_to_submit` Submission keeps its Task and Change open and does not run validation.

Completed Submissions retain their Candidate, Validation Input Snapshot, validation, and current publication facts.
Later configuration or Change Base changes do not invalidate completed evidence.
A repeated Submit returns stored success only when durable evidence identifies the same exact Candidate and confirmed publication.
A revised Candidate must pass Submission before But Why updates the same owned pull request.
Each successful publication updates the owned pull request to the exact validated Candidate head without appending a separate chronology.
A closed owned pull request blocks publication while it remains closed unless the owned pull request is exact and closed-unmerged, which publication reopens and updates.
If the owned pull request reopens before the Change closes, a later Submission can continue through that pull request.
Publication supplies the complete current Implementation Decision Log when it creates the pull request and requests the current log in the body when it updates the pull request.
Candidate Publication chronology, its table, command, output, compatibility behavior, documentation, and tests are removed.
