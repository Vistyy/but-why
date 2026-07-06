---
status: accepted
---

# Use canonical Task Slugs for operational names

Task IDs are opaque identities, so Git and filesystem names must not depend on local Task ID shape.
But Why uses one canonical Task Slug algorithm for local and remote-style Task IDs: normalize a readable part and append a hash of the exact raw Task ID.
This deliberately changes local internal refs and paths instead of preserving `BW-123`-style operational names, because one path avoids leaking local identity rules into future remote-backed Tasks.

## Considered Options

- Preserve local Task IDs exactly in operational names and only slug remote-style Task IDs.
- Use one canonical Task Slug algorithm for all Task IDs.

## Consequences

- Current user-facing local Task IDs stay unchanged.
- Internal Git refs, worktree paths, artifact paths, and Git/filesystem-facing run names may change for local Tasks.
- Callers should consume Task Slugs for operational names instead of inspecting Task ID shape.
