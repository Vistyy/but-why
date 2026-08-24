---
status: accepted
---

# Use forward schema migrations before publication

Before the first public release, But Why may replace prerelease Shared Repository State instead of preserving compatibility with unsupported development schemas.
The release-ready schema starts with the Effect SQL migration named `0001_baseline` and applies every subsequent immutable ordered migration shipped by the release.
Repositories with prerelease state reconcile supported work with the old executable, archive the old state directory, and initialize fresh state with the new executable.
The new executable does not convert, inspect, or dispatch to a predecessor schema.

## Consequences

`0001_baseline` defines the initial schema that the first public release supports.
No unsupported prerelease migration chain, compatibility alias, conversion path, or pinned predecessor dispatch ships in the release-ready runtime.
Schema changes append immutable ordered migrations instead of rewriting an applied migration, including changes delivered before the first public release.
