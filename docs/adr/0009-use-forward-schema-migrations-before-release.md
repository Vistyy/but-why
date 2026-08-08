---
status: accepted
---

# Use immutable forward schema migrations before release

But Why uses immutable ordered forward migrations before the first public release.
After a migration is applied, a schema change appends a new migration instead of rewriting the applied migration.
This decision does not require compatibility with a pre-release representation after that representation is explicitly retired.

## Consequences

Migration `0001_baseline` and every later applied migration remain unchanged.
The first public release freezes the complete migration chain shipped in that release rather than collapsing it into a new baseline.
