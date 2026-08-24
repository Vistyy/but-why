---
status: accepted
---

# Use forward schema migrations before publication

Before the first public release, But Why may replace prerelease Shared Repository State instead of preserving compatibility with unsupported development schemas.
The release-ready schema starts with the Effect SQL migration named `0001_baseline` and applies every subsequent ordered migration shipped by the release.
A migration becomes immutable when the Change that introduces it merges to `main`; from that point, an installed executable may apply it to live Shared Repository State.
Before that merge, the Change may revise or remove its migrations in response to implementation and review, even when Candidate tests have applied them to disposable state.
Those tests recreate their disposable state after a revision instead of requiring a corrective migration for an earlier Candidate schema.
Repositories with prerelease state reconcile supported work with the old executable, archive the old state directory, and initialize fresh state with the new executable.
The new executable does not convert, inspect, or dispatch to a predecessor schema.

## Consequences

`0001_baseline` defines the initial schema that the first public release supports.
No unsupported prerelease migration chain, compatibility alias, conversion path, or pinned predecessor dispatch ships in the release-ready runtime.
Schema changes after a migration's merge append ordered migrations instead of rewriting or removing the merged migration, including changes delivered before the first public release.
An unmerged Change revises its own migration directly when no merged migration must remain compatible.
