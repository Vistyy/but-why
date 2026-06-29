# Prototype notes

Question: Can But Why? use Sandcastle for v1 validation execution without reimplementing execution plumbing?

Answer: yes against Sandcastle main commit `2d93226d37da129c54d4ecfd5b370122b48b31b2`, but not against published `0.10.0`.

Verdict: green with release and token-usage caveats.

Sandcastle main proved validation worktrees, command checks through `sandbox.exec()`, Pi reviewer execution, structured output validation and retry, reviewer log paths, Docker sandbox execution, Pi reviewer execution inside Docker with host Pi auth mounted read-only, and cleanup.

Remaining caveats: the tested APIs are not published in `0.10.0`, Pi token usage is not parsed into `result.iterations[].usage`, and Podman was not tested.

Durable report: `docs/spikes/sandcastle-v1-execution.md`.
