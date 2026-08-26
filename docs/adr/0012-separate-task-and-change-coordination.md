---
status: accepted
supersedes: 0006-use-domain-centered-modules-and-module-owned-persistence
---

# Separate Task and Change coordination

Task and Change remain separate behavior modules.

Task and Change coordination is the application boundary for operations that must read or update both domains.

The boundary owns the durable Task-to-Change link, linked Change Start, coordinated cancellation, exact merged completion, and joined Task inspection.

A linked Change stores its initial Acceptance Context, while the link is stored in `task_change_links` rather than on the Change record.

Change-owned operations use the Change ID for branches, Managed Worktrees, and Interactive Session names.

Exact merged completion closes the Change and changes a linked `todo` Task to `done` in one SQLite transaction.

An already `done` linked Task makes completion idempotent.

A `new` or `cancelled` linked Task rejects completion without changing either record.

## Considered Options

- Keep Task identity and lifecycle operations inside Change persistence.
- Store a copied Task ID on every Change and coordinate through CLI commands.
- Use a dedicated Task and Change coordination boundary with an immutable relationship table.

## Consequences

Change-only inspection and delivery do not expose Task identity.

Task inspection obtains its Change activity through the joined coordination projection.

The first supported relationship remains one Task to one Change and stores only their internal integer identities.
Public Task and Change IDs derive from the immutable repository ID Prefix.

The release baseline stores only current links and does not convert prerelease relationship representations.

Repository Runtime continues to provide transaction capability without knowing Task or Change behavior.

Task and Change owner persistence resides under the applicable owner Adapter boundaries, while Task/Change coordination retains the `task_change_links` relationship and cross-domain transaction ordering.
