# Verification

## Recurring material risks

- Approved-intent identity can be lost.
  But Why can then act on unapproved or later-mutated Task intent.
- Candidate or Validation identity can be lost.
  But Why can then judge, reuse, publish, complete, or clean up the wrong Candidate.
- External-target identity can be lost.
  But Why can then mutate the wrong repository, branch, pull request, or commit.
- Durable state can become inconsistent.
  Concurrency, interruption, or uncertain external mutation can make Shared Repository State disagree with Git, remote, or workspace facts.
- Destructive cleanup can lose unique work.
  Recovery or cleanup can delete dirty work, unique commits, Artifact Content, Reviewer Transcripts, or an advanced remote branch.
- A false terminal result can complete or cancel work without authoritative facts.
  Later operations can then rely on an operation, external mutation, or terminal state that did not occur.

## Project-specific evidence constraints

- Each retained check must own a distinct current Verification Claim.
  Use the cheapest reliable supported seam for that claim.
- SQLite atomicity, migration-preservation, snapshot, and persisted-data claims require focused evidence through real SQLite.
- Git identity and work-preservation claims require focused evidence through real Git.
- Use a real process only when the claim requires package, executable, stdin, process-tree, or agent-runtime behavior.
  Captured Adapters are sufficient for GitHub classification and retry behavior.
- Trusted But Why Executable selection requires a focused real-process sentinel from a linked worktree until first-release executable selection replaces the Source Checkout Guard.
- Package, public documentation, structural-tooling, and temporary test-operation checks have their own workflow owners.
  Do not misclassify them as product-risk evidence.
- The historical `.boundary.test.ts` suffix is an execution category, not evidence ownership or justification for retaining a test.
- Evidence with a known intermittent failure cannot remain blocking.
- Retain the shared capacity lock and the three-worker Vitest limit until a corrected and reduced portfolio proves a better valid three-concurrent-workload result.
