---
status: accepted
---

# Use a domain-centered modular monolith

But Why uses a domain-centered modular monolith with selective ports and adapters.
The code should stay one coherent application, with domain-named modules and use cases at the center, CLI/output/storage/execution integrations at the edges, and ports only where behavior truly varies.
This avoids vague layering, strict Clean Architecture ceremony, plugin-style validation, and event-sourcing complexity while preserving seams needed for future remote Task Authorities, repo-local Validation Run history, GitHub integration, and Sandcastle execution.
