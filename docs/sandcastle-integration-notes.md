# Sandcastle integration notes

Status: Current internal integration record.

This document records confirmed Sandcastle 0.12.0 behavior that affects the current But Why implementation.
It is not a product specification or an architecture decision.
[ADR 0001](adr/0001-use-fixed-validation-gate-through-sandcastle.md) remains authoritative for the v1 dependency decision and ownership boundary.
[Open Questions](open-questions.md) remains authoritative for unresolved product and architecture decisions.

Update this document when a Sandcastle upgrade changes an observed behavior or when But Why removes a listed workaround.
Verify each changed claim against the installed Sandcastle version before updating it.

## Current integration boundary

Sandcastle creates disposable Validation Workspaces and runs host processes behind But Why domain seams.
`src/change/validation/createValidationWorkspace.ts` owns Sandcastle workspace creation.
`src/agent/reviewerAgentRuntime.ts` owns the Sandcastle Pi reviewer Adapter.
But Why owns Reviewer Session identity, persistence, evidence, Restart policy, and Change cleanup.

The current production Validation Workspace uses Sandcastle `noSandbox()`.
The agent process therefore runs directly on the host in a disposable Git worktree.

## Confirmed constraints and workarounds

### Host-run session transfer is not automatic

**Observed behavior:** Sandcastle transfers sessions through `resumeIntoSandbox` and `captureToHost` only when the sandbox exposes a bind-mount handle.
`noSandbox()` does not expose a bind-mount handle.

**Consequence:** Sandcastle does not copy Pi session JSONL into or out of a host-run Validation Workspace.

**Current But Why behavior:** Pi writes directly to the Change-owned session directory under the Local Repository operational directory.
The Pi command receives the documented `--session-dir` option.
Sandcastle receives the same path as `sessionStorage.hostSessionsDir` for resume prechecks and session lookup.

**Replacement opportunity:** A replacement execution Adapter can expose one host-session interface instead of coordinating separate Pi and Sandcastle storage settings.

### `hostSessionsDir` does not configure the Pi process

**Observed behavior:** Sandcastle uses `sessionStorage.hostSessionsDir` in its Pi session-storage Adapter.
The setting does not add Pi's `--session-dir` option and does not set `PI_CODING_AGENT_SESSION_DIR` for the Pi process.

**Consequence:** If But Why configures only `hostSessionsDir`, Pi writes under its default `~/.pi/agent/sessions` directory while Sandcastle searches the Change-owned operational directory.
A streamed session ID can then exist without a reusable JSONL at the configured Sandcastle path.

**Current But Why behavior:** `src/agent/reviewerAgentRuntime.ts` supplies the same Change-owned path to Pi through `--session-dir` and to Sandcastle through `hostSessionsDir`.
But Why persists a session reference only after the session file is found in that directory.

**Replacement opportunity:** Remove the duplicated storage-path configuration when one Adapter owns process launch and session lookup.

### `Sandbox.run()` does not apply `AgentProvider.env` to the existing no-sandbox handle

**Observed behavior:** A focused Sandcastle 0.12.0 experiment configured `AgentProvider.env` before calling `Sandbox.run()` on a sandbox created through `createSandbox()` and `noSandbox()`.
The launched process did not receive that environment variable.

**Consequence:** But Why cannot rely on `AgentProvider.env` to configure Pi session storage in the current `createSandbox()` integration.

**Current But Why behavior:** The Pi command uses the explicit `--session-dir` option instead of relying on `AgentProvider.env`.

**Replacement opportunity:** A replacement Adapter should define environment composition once and apply it consistently to every process launched through an existing workspace handle.

### Host-run results omit the captured session path

**Observed behavior:** With `noSandbox()`, Sandcastle can report the session ID parsed from Pi output while `IterationResult.sessionFilePath` remains absent.
The path is normally populated by the bind-mount capture path that `noSandbox()` skips.

**Consequence:** A session ID alone does not prove that a reusable session file exists.

**Current But Why behavior:** `src/agent/reviewerAgentRuntime.ts` resolves the reported ID through Sandcastle's host session lookup.
The runtime returns reusable session metadata only when that lookup finds the JSONL.

**Replacement opportunity:** A replacement result contract should return either a verified durable session handle or an explicit capture-unavailable result.

### Host-run Pi resume retains the previous workspace cwd

**Observed behavior:** Pi stores the working directory in the session header.
Pi resolves `--session <id>` against that stored working directory when it opens the session.
Sandcastle does not rebind the header for `noSandbox()` because its Pi transfer path requires a bind-mount handle.

**Consequence:** A session created in a removed Validation Workspace is not local to its successor Validation Workspace.
Pi can classify the session as belonging to another project or continue with tools rooted at the removed path.

**Current But Why behavior:** Before a resumed host run, `src/agent/reviewerAgentRuntime.ts` atomically updates the persisted Pi session header to the current verified Validation Workspace path.
The runtime updates the one authoritative JSONL in place and preserves a snapshot until the review produces a valid final report.

**Replacement opportunity:** A replacement session interface should accept the current workspace explicitly instead of requiring JSONL header rebinding.

### Pi host lookup returns the first matching session file

**Observed behavior:** Sandcastle searches the configured Pi session root by directory order and returns the first filename that ends with the requested session ID.
Sandcastle does not select the newest matching file.

**Consequence:** Duplicate copies of one Pi session ID can resume stale conversation history.

**Current But Why behavior:** Pi writes and resumes the session in one Change-owned session root.
But Why does not create workspace-specific copies of the same session file.

**Replacement opportunity:** A replacement session store should make one durable file authoritative for each Reviewer Session reference.

### Host cancellation does not prove process-tree termination

**Observed behavior:** Sandcastle host cancellation can return while Pi reviewer descendants continue running.

**Consequence:** But Why cannot treat Sandcastle cancellation completion as proof that every reviewer process stopped.

**Current But Why behavior:** Interrupted reviewer process recovery remains unsupported.
The broader decision remains in [Open Questions](open-questions.md#how-should-reviewer-execution-use-containers).

**Replacement opportunity:** A replacement process Adapter should own a process group and provide bounded termination evidence.

### Validation Workspace placement is controlled by Sandcastle

**Observed behavior:** Sandcastle places current Validation Workspaces under the consumer repository's `.sandcastle` runtime directory.

**Consequence:** But Why must account for Sandcastle paths in repository hygiene, cleanup, and user documentation.

**Current But Why behavior:** The Validation Workspace Adapter contains the path knowledge and cleanup behavior.
The post-v1 placement decision remains in [Open Questions](open-questions.md#where-should-disposable-validation-workspaces-live).

**Replacement opportunity:** A replacement workspace Adapter can place disposable Validation Workspaces outside the consumer repository.

### Pi usage evidence is not trustworthy

**Observed behavior:** Sandcastle 0.12.0 does not return trustworthy Pi token or monetary usage for the current reviewer path.

**Consequence:** But Why does not claim authoritative Pi usage or cost accounting.

**Current But Why behavior:** Reviewer evidence records wall-clock duration and continuity facts owned by But Why.
The accounting decision remains in [Open Questions](open-questions.md#how-should-agent-usage-and-cost-be-measured).

**Replacement opportunity:** A replacement execution Adapter can expose usage only when the provider supplies a verifiable contract.

## Replacement cleanup checklist

When But Why replaces Sandcastle, inspect and remove or simplify these integration-specific paths:

- Replace `createSandbox()` and `noSandbox()` in `src/change/validation/createValidationWorkspace.ts`.
- Replace Sandcastle `Sandbox` and `SandboxRunResult` types at the validation and reviewer Adapter seams.
- Remove the paired Pi `--session-dir` and Sandcastle `hostSessionsDir` configuration.
- Remove the fallback host session lookup that compensates for an absent `sessionFilePath`.
- Re-evaluate local reviewer-output correction if the replacement owns trustworthy same-conversation correction.
- Replace `.sandcastle` path handling, logs, cleanup, ignore rules, tests, and public documentation.
- Replace Sandcastle-specific Validation Tooling Failure translation while preserving domain-level failure behavior.
- Preserve the real cross-workspace Reviewer Session test at the replacement Adapter seam.
- Preserve Reviewer Session identity, persistence, Restart policy, evidence, permissions, and Change cleanup as But Why behavior.

Do not remove a workaround only because the replacement has a similarly named feature.
First prove the required behavior through the applicable But Why domain seam.
