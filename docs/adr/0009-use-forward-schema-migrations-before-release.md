---
status: accepted
---

# Cut over to one release baseline before publication

Before the first public release, But Why may replace prerelease Shared Repository State instead of preserving compatibility with unsupported development schemas.
The release-ready schema starts from exactly one Effect SQL migration named `0001_baseline`.
Repositories with prerelease state reconcile supported work with the old executable, archive the old state directory, and initialize fresh state with the new executable.
The new executable does not convert, inspect, or dispatch to a predecessor schema.

## Consequences

`0001_baseline` defines the complete schema that the first public release supports.
No prerelease migration chain, compatibility alias, conversion path, or pinned predecessor dispatch ships in the release-ready runtime.
After publication makes a baseline durable, later schema changes append immutable ordered migrations instead of rewriting an applied release migration.
