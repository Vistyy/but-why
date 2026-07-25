# Place Managed Worktrees in a visible sibling directory

Status: accepted

New Managed Worktrees use `<main-checkout-parent>/<main-checkout-name>-worktrees/but-why/<change-slug>`.
But Why asks Git for the canonical main checkout so Change Start resolves the same root from the main checkout and every linked worktree.
This layout keeps implementation files outside opaque Git metadata so editors, indexers, search tools, file watchers, backup systems, and security tools can discover them conventionally.
Shared Repository State remains under `<git-common-dir>/but-why/` because it belongs to the Local Repository rather than one checkout.
Existing Changes retain their recorded absolute Managed Worktree paths without migration.
Repository relocation and Git worktree repair are unsupported.

A configurable root, a fallback under Git metadata, automatic relocation, and moving existing Managed Worktrees were rejected because they add configuration or repair states without improving the single supported workflow.
A flat sibling layout without the `but-why` namespace was rejected because the sibling root can coexist with other worktree owners.
Bare repositories were rejected because But Why requires a normal main checkout with tracked Repo Config and project files.
