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
- SQLite atomicity, migration-preservation, and persisted-data claims require focused evidence through real SQLite.
- Git identity and work-preservation claims require focused evidence through real Git.
- Use a real process only when the claim requires package, executable, stdin, process-tree, or agent-runtime behavior.
  Captured Adapters are sufficient for GitHub classification and retry behavior.
- A Validation Run does not prove changes to Validation Sequence machinery unless its evidence shows that the exact Candidate implementation was exercised directly.
- Installed-package isolation and current-worktree behavior require focused real-process sentinels in disposable repositories with independent Git Common Directories and state.
- Package, public documentation, structural-tooling, and temporary test-operation checks have their own workflow owners.
  Do not misclassify them as product-risk evidence.
- `just quality` is the only repository-wide blocking quality command.
  It runs each blocking static check, the build, and one ordinary unfiltered Vitest invocation that discovers every maintained test.
  Coverage and health remain advisory and do not own blocking tests.
- Evidence with a known intermittent failure cannot remain blocking.
- Retain the shared capacity lock and the three-worker Vitest limit.
  The final three-workload measurement at the migrated portfolio revision retained the lock because the unlocked one-worker scenario made each active quality execution more than twice as slow, and the unlocked two- and three-worker scenarios failed retained evidence with five-second timeouts.
  The measurement limits are host-specific and do not justify a lower worker limit or lock removal until a corrected and reduced portfolio proves a better valid three-concurrent-workload result.
