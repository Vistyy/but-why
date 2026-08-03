# Verification

## Recurring material risks

- Evidence can refer to the wrong Task, Change, Candidate, Change Base, policy snapshot, repository, branch, pull request, or commit.
  But Why can then judge, complete, publish, or clean up the wrong work.
- An interrupted, incomplete, or uncertain operation can be recorded as successful.
  Later operations can rely on a terminal fact or external mutation that did not occur.
- Concurrency, interruption, or uncertain external mutation can make Shared Repository State disagree with Git, remote, or workspace facts.
  Recovery can then become unsafe or untrustworthy.
- Before publication, `just by` can select an executable other than the canonical main-checkout Trusted But Why Executable.
  Candidate code can then mutate Shared Repository State through an untrusted executable.

## Project-specific evidence constraints

- SQLite atomicity and migration-preservation claims require focused evidence through real SQLite.
- Git identity and work-preservation claims require focused evidence through real Git.
- Trusted But Why Executable selection requires a focused real-process sentinel from a linked worktree.
- The historical `.boundary.test.ts` suffix is an execution category, not evidence ownership or justification for retaining a test.
- Evidence with a known intermittent failure cannot remain blocking.
