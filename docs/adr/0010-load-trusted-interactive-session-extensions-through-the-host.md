---
status: accepted
---

# Load trusted Interactive Session extensions through the host

But Why's Interactive Session host loads But Why-owned trusted extensions separately from user-configured Agent Profile resources.

The host always loads the packaged `continue-change` extension for an Implementer Interactive Session.
It loads the packaged Implementation Advisor extension only when the advisor is configured.
It loads neither extension for reviewer sessions.

Agent Profile resource settings remain the authority for user-configured extensions.
They do not enable, disable, or replace trusted But Why extensions.
The host resolves trusted extensions from the installed package, passes absolute paths to Pi, and verifies required entry points before launch.

## Considered Options

- Require the Implementer Agent Profile to list every But Why extension.
- Load trusted But Why extensions through the Interactive Session host while keeping user resources in Agent Profiles.
- Move extension behavior into the host instead of using Pi extensions.

## Consequences

Automatic Change continuation no longer depends on manual Agent Profile configuration.
The advisor configuration becomes the sole configuration switch for the advisor extension.
A missing required continuation extension prevents Interactive Session launch.
A missing or failed optional advisor extension disables only the advisor.
Package verification must prove that every trusted extension and runtime dependency ships and loads from an installed layout.
Future trusted extensions must define their eligible agent role and cannot use this boundary to bypass user-resource policy in unrelated Pi sessions.
