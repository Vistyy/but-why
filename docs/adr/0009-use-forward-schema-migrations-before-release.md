---
status: accepted
---

# Use forward schema migrations before release

But Why preserves current Shared Repository State across schema changes before the first public release.
Every applied Effect SQL migration is immutable, and each later schema change appends an ordered forward migration instead of rewriting the current baseline.

## Considered Options

- Continue replacing one pre-release baseline and rebuild local state after each schema change.
- Begin ordered forward migrations before release and carry the resulting chain into the first published version.

## Consequences

Migration `0001_baseline` remains unchanged.
The Acceptance Reviewer Session schema and later schema changes use the ordered migration chain.
Each schema-changing Task uses the next available ordered migration and proves that an existing database upgrades without losing supported facts.
The first public release freezes the complete migration chain shipped in that release rather than collapsing it into a new baseline.
