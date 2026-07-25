---
status: accepted
---

# Configure Interactive Session Environments in Repo Config

Repo Config may define an optional structured `interactiveSession.environmentCommand` argument list that But Why prepends when launching an Interactive Session.
But Why reads it from the Change's Managed Worktree because the development toolchain belongs to that repository state rather than Global Config or the caller checkout.
The wrapper affects only the Interactive Session and its child commands because Repository Preparation and Validation have separate execution configuration.
Missing configuration preserves direct launch, while wrapper failure rejects launch without fallback and preserves the ready Change for retry.
This explicit configuration avoids unreliable tool detection and automatic `direnv allow` approval.
