# Boundaries

Decode `unknown` at untrusted input, persistence, and external response boundaries with the installed Schema APIs.
Do not use casts to bypass boundary validation.
Distinguish an absent property from explicit `undefined` or `null` when the contract does.
Keep normalization and defaults at the boundary that owns them.

Keep expected operational failures in the typed error channel.
Map infrastructure failures to the narrow error contract owned by the current boundary.
Do not catch causes or defects when typed-error recovery is sufficient.
Do not replace a specific error with global `Error` when callers need to distinguish the failure.

Read configuration at startup or at the service boundary that owns it.
Use a default only for a missing value.
Do not silently replace malformed configuration with a default.
Keep credentials redacted and out of error text.
Effect Config does not replace But Why's strict repository JSON contracts, path rules, or diagnostics.

An external Adapter owns request or command construction, authentication, status or exit classification, response decoding, error mapping, and any safe retry policy.
Classify an HTTP response status before decoding its success body.
Pass cancellation through when a raw Promise, `fetch`, SDK, or process boundary supports it.
Do not replace an established command Adapter with HTTP, or the reverse, without preserving authentication, interruption, uncertain-mutation recovery, and supported-environment behavior.
