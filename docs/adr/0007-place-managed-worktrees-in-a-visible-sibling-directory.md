---
status: accepted
---

# Place Managed Worktrees in a visible sibling directory

New Managed Worktrees use `<starting-checkout-parent>/<starting-checkout-name>-worktrees/but-why/<change-slug>`.
Change Start uses the invoking current worktree as the starting checkout and records the resulting Managed Worktree path.
No checkout is privileged.
This layout keeps implementation files outside opaque Git metadata so editors, indexers, search tools, file watchers, backup systems, and security tools can discover them conventionally.
Shared Repository State remains under `<git-common-dir>/but-why/` because it belongs to the Local Repository rather than one checkout.
Existing Changes retain their recorded absolute Managed Worktree paths without migration.
Repository relocation and Git worktree repair are unsupported.

Recovery for a missing or stale Managed Worktree reattaches the exact recorded Repository Branch at its current commit when the branch exists and is not attached elsewhere.
Recovery preserves every commit on the recorded branch and does not reset it to the Change starting commit.
A branch attached elsewhere, a missing recorded branch, or a managed path containing conflicting files stops with actionable identity and location facts, and conflicting files are never overwritten or removed.

The operator may recover the branch externally or cancel the Change or its linked Task.

A configurable root, a fallback under Git metadata, automatic relocation, moving existing Managed Worktrees, reflog recovery, and commit-selection machinery were rejected because they add configuration or repair states without improving the single supported workflow.
A flat sibling layout without the `but-why` namespace was rejected because the sibling root can coexist with other worktree owners.
Bare repositories were rejected because Change Start requires a current worktree with tracked Repo Config and project files.
