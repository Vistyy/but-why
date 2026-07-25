---
status: accepted
---

# Version persisted state after the first public release

Before the first public npm release, But Why initializes Shared Repository State from one replaceable current schema baseline.
The first public release freezes that baseline as schema version 1.
After that release, persisted schema changes use ordered forward migrations through the existing Effect SQL Migrator so a newer installed CLI can open state created by an older supported release.
The released `0001_baseline` remains immutable, and later schema changes add ordered migration records.
A change that cannot preserve supported persisted state requires an explicit compatibility and release decision.

## Considered Options

- Continue replacing the schema baseline after public release and require users to discard persisted state.
- Delay migration policy until an unspecified point when the schema feels stable.
- Use the first public release as the explicit boundary between replaceable pre-release state and versioned persisted state.

## Consequences

BY-15 establishes the supported-state compatibility policy and configures the existing Effect SQL Migrator for immutable released migrations after the first public release.
Migrations preserve the domain-owned persistence interfaces and Change-owned transaction boundaries established by ADR 0014.
Pre-release schema fixes continue to update the single current baseline.
Existing pre-release development databases may require an explicit one-time repair rather than permanent product migration code.
