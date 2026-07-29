---
status: accepted
---

# Use forward schema migrations before release

But Why preserves current Shared Repository State across schema changes before the first public release.
Every applied Effect SQL migration is immutable, and each later schema change appends an ordered forward migration instead of rewriting the current baseline.
But Why records and verifies a Migration Fingerprint for each applied migration before it permits use of Shared Repository State because Effect SQL identifies applied migrations by ID and name without validating their content.

## Considered Options

- Continue replacing one pre-release baseline and rebuild local state after each schema change.
- Preserve only Tasks through Task Archives and discard other Shared Repository State during schema changes.
- Begin ordered forward migrations before release and carry the resulting chain into the first published version.
- Replace Effect SQL migration execution with an external migration engine that provides migration checksums.
- Retain Effect SQL and add project-owned Migration Fingerprints for canonical migration content.

## Consequences

Migration `0001_baseline` remains unchanged.
The Acceptance Reviewer Session schema is the intended first feature to append a forward migration.
Each schema-changing Task uses the next available ordered migration and proves that an existing database upgrades without losing supported facts.
Applied migration content must match its recorded Migration Fingerprint before Shared Repository State can be used.
A fingerprint mismatch requires explicit recovery and must not update the recorded fingerprint during normal startup.
The first public release freezes the complete migration chain shipped in that release rather than collapsing it into a new baseline.
Task Archives remain accidental-loss recovery and do not replace schema migration.
