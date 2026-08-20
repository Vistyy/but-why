# Verification

## Recurring material risks

- Acceptance Context identity can be lost.
  But Why can then judge a Candidate against intent that was not approved for that Change.
- Candidate or Validation Run identity can be lost.
  But Why can then judge, reuse, publish, complete, or clean up the wrong Candidate.
- External-target identity can be lost.
  But Why can then mutate the wrong repository, branch, pull request, or commit.
- Durable state can become inconsistent.
  Concurrency, interruption, or uncertain external mutation can make Shared Repository State disagree with Git, remote, or workspace facts.
- Terminal Cleanup or Discard Work can destroy work or evidence outside its authorized target.
  A cleanup error can delete dirty Managed Worktree content, unique Repository Branch commits, an advanced Remote Change Branch, or Agent Transcripts that must be retained.
- A false terminal result can complete or cancel work without authoritative facts.
  Later operations can then rely on an operation, external mutation, or terminal state that did not occur.

## Project-specific evidence constraints

- Each retained check must protect supported behavior or detect an important failure.
  Where checks overlap, retain only distinct protection and use the cheapest reliable supported seam.
- Focused evidence for SQLite atomicity, the supported `0001_baseline` and forward migrations, and persisted Shared Repository State behavior must use real SQLite.
- Focused evidence for Git identity and work-preservation behavior must use real Git.
- Use a real process only when package, executable, stdin, process-tree, or agent-runtime behavior is at issue.
  Captured Adapters are sufficient for GitHub classification and retry behavior.
- A Validation Run does not prove changes to the Validation Gate unless its evidence shows that the exact Candidate implementation was exercised directly.
- Installed-package isolation and current-worktree behavior require focused real-process sentinels in disposable repositories with independent Git Common Directories and state.
- Evidence with a known intermittent failure cannot remain blocking.
- Retain the shared capacity lock and the three-worker Vitest limit.
  Change either only when a future Candidate demonstrates a valid result with three concurrent workloads for the changed portfolio.
