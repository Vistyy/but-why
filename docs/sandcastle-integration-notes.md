# Sandcastle integration notes

Status: Current internal dependency assessment and deferred research record.

This document helps maintainers decide whether Sandcastle still earns its place in But Why.
It records investigation only and does not authorize replacement or implementation.
[ADR 0001](adr/0001-use-fixed-validation-gate-through-sandcastle.md) remains authoritative for the accepted dependency decision.
[Open Questions](open-questions.md) remains authoritative for unresolved product and architecture decisions.

## Summary

But Why currently uses Sandcastle for two jobs:

- Create and remove the disposable Git worktree used as a Validation Workspace.
- Run commands and Pi reviewers through one workspace handle.

But Why does not currently use Sandcastle for actual sandbox isolation.
Production passes `noSandbox()`, so preparation, Checks, and reviewers run as ordinary host processes in a disposable Git worktree.

Sandcastle does not run the Implementer or Herdr.
Herdr launches the Implementer directly.
Replacing Sandcastle therefore does not by itself change those paths or solve their usage accounting.

The smallest credible replacement is project-owned Git worktree lifecycle plus direct Pi SDK execution.
That replacement removes Sandcastle and its workarounds, but it preserves the current absence of security isolation.
Sandboxing should be a separate execution-provider decision rather than another workspace-library decision.

## What But Why uses

| Current use | But Why ownership | Sandcastle contribution |
| --- | --- | --- |
| Validation Workspace lifecycle | Temporary ref, exact Candidate SHA, dirty-workspace recovery, setup evidence, cleanup result | Creates the Git worktree, copies allowlisted files, exposes its path, and closes it |
| Preparation and Checks | Commands, ordering, findings, diagnostics, integrity checks | Runs shell commands through `Sandbox.exec()` |
| Pi reviewer execution | Profiles, prompts, output contract, correction attempt, Reviewer Session identity, persistence, and evidence | Builds and runs the Pi process, parses its stream, and exposes session resume |
| Process handle | Effect scope and cleanup policy | Provides `run()`, `exec()`, and `close()` on one handle |

The main integration points are `src/change/validation/createValidationWorkspace.ts` and `src/agent/reviewerAgentRuntime.ts`.
Validation phases receive only the small `exec` and `run` portions of Sandcastle's `Sandbox` type.
This narrow use means replacement does not require a Validation Gate redesign.

## What But Why does not use

But Why does not use these Sandcastle capabilities:

- Docker, Podman, Vercel, Daytona, or custom sandbox providers.
- Sandcastle's top-level orchestration, merge-back workflow, interactive agents, or multi-agent iteration loop.
- Non-Pi coding-agent providers.
- Hooks, completion signals, provider logging, or stream forwarding.
- Sandcastle structured output and structured-output retries.
- Sandcastle token or cost reporting.

The installed Sandcastle `0.12.0` declarations expose `Output.object()`, `Output.string()`, and retry configuration for the top-level `run()` interface.
They do not expose that output contract through the reusable `Sandbox.run()` interface that But Why uses for a shared Validation Workspace.
The current reviewer Adapter therefore performs its own tagged-output validation and one same-session correction, as recorded in [Open Questions](open-questions.md#should-sandcastle-own-structured-reviewer-retries).

Sandcastle's usage parser is implemented for Claude Code, not Pi.
It does not solve But Why's Pi usage requirement.

## Sandcastle agent responsibility

Sandcastle does not use the Pi SDK.
Its Pi Agent Provider builds a Pi CLI command, launches the command as a subprocess, parses line-oriented output, captures the session identifier, and manages Pi JSONL session files for resume.
Its Claude Code, Codex, Cursor, OpenCode, and Copilot providers follow the same command-and-parser model with harness-specific behavior.

The provider abstraction covers command construction, stdin, stream parsing, session storage, environment variables, cancellation, and any usage extraction that the provider supports.
This design gives Sandcastle broad CLI-harness coverage, but it cannot use Pi's in-process models, tools, resources, sessions, and usage APIs directly.

A future But Why replacement should remain Pi-specific until a second harness is an accepted requirement.
Validation needs only a stable reviewer-execution boundary and does not need a public generic harness interface now.
If another harness becomes necessary, its Adapter can satisfy the same domain outcomes through its own SDK or CLI mechanisms.
The shared contract should require a typed review result, Reviewer Session association, correction behavior, cancellation, diagnostics, and usage evidence or an explicit unknown value.
Pi-specific extensions, skills, tools, and model settings should remain inside the Pi implementation rather than force every harness into a lowest-common-denominator capability model.
A Factory could select implementations later, but the primary boundary would be a Port and Adapter or Strategy design.

## Orchestration model comparison

Sandcastle primarily orchestrates an agent that is expected to change a repository.
Its top-level loop resolves a prompt, creates a branch and worktree, creates a sandbox, runs hooks, launches an agent, observes completion, repeats iterations, collects commits or structured output, optionally resumes, merges changes, and cleans up.
This model provides reusable implementation-agent automation, several CLI harnesses, interactive execution, sandbox providers, and generic lifecycle customization.
Its costs for But Why are unused policy, CLI and session-file inference, weak Pi-native accounting, and branch or merge behavior that does not represent Validation.

But Why Validation evaluates an already-created Candidate against accepted intent.
Its loop binds a disposable Validation Workspace to the exact Candidate, prepares it, runs Checks and Specialists, records Findings, verifies Candidate integrity, makes a Validation Gate decision, and records cleanup evidence without merging reviewer changes.
This model provides explicit domain ownership, deterministic Candidate identity, and durable decision evidence.
Its cost is that But Why must own worktree, process, Pi runtime, and future sandbox integration rather than delegate those mechanisms to a generic orchestrator.

Sandcastle's generic hooks are more reusable and customizable than But Why's fixed named phases.
[Open Questions](open-questions.md#where-should-lifecycle-customization-use-hooks) records future research into generic hooks or additional named extension points without weakening Validation policy or evidence.

## Why container execution was removed

[PR 15](https://github.com/Vistyy/but-why/pull/15) defined the Agent Environment as a host command wrapper for Implementers and reviewers.
Docker and Podman reviewers did not receive that wrapper.

[PR 16](https://github.com/Vistyy/but-why/pull/16) added curated reviewer Pi extensions, skills, and context files.
Making those host resources available in Sandcastle containers required read-only mounts, synthesized parent context, staged extension dependencies, and Pi runtime dependency resolution.
Its tests verified provider options and mount lists, but they did not prove a real containerized reviewer.

[PR 17](https://github.com/Vistyy/but-why/pull/17) removed container execution because this compatibility path was not a maintained reviewer-environment contract.
No recorded Docker or Podman runtime failure triggered the removal.
The unresolved contract covered the image and toolchain, Pi resources and their dependencies, sessions, writable mounts, Git, credentials, networking, process ownership, cleanup, and resource limits.

Skills and context files are straightforward to copy into an isolated environment.
Extensions are harder because an extension can import local files, packages, and binaries that exist only in the host Pi installation.
A sandbox provider therefore needs a curated self-contained resource bundle, a declared portable extension contract, or actionable rejection of resources that cannot be transferred.
It must not mount the user's complete global Pi directory merely to make arbitrary resources work.

## Current costs and constraints

The historical integration experiments used the same pinned Sandcastle `0.12.0` version that remains installed.
They identified these current costs:

- `noSandbox()` does not transfer Pi sessions through Sandcastle's bind-mount path.
- But Why must configure both Pi's `--session-dir` and Sandcastle's parent session directory.
- But Why must locate the session JSONL itself because host-run results can omit its path.
- But Why rewrites the Pi session header before resume because a continued session retains the removed Validation Workspace path.
- Sandcastle host session lookup can select the first duplicate session ID rather than an authoritative file.
- Sandcastle `0.12.0` host cancellation can abandon an in-flight `noSandbox()` command without stopping its child process, so it does not prove that the complete Pi process tree stopped.
- But Why's executable entry does not translate host termination signals into Effect interruption, so scoped process cleanup is not guaranteed before exit.
- Sandcastle controls placement under `.sandcastle/worktrees/`, which requires repository-wide exclusions.
- `noSandbox()` workspace setup can add `safe.directory` entries to the user's global Git configuration.
- Sandcastle does not provide trustworthy Pi token or monetary usage.

These constraints are integration evidence, not reasons to weaken the Validation Workspace invariants that But Why owns.
A replacement must preserve exact Candidate binding, integrity checks, bounded cleanup evidence, and Reviewer Session continuity.

## Validation Workspace cleanup limits

But Why owns a finite 30-second limit for the original Sandcastle `Sandbox.close()` operation.
The Git Adapter uses the same finite limit for worktree removal and registration verification.
The limit is longer than the former five-second limit so a clean workspace that Sandcastle removes slowly can still complete cleanup.

The timeout does not cancel Sandcastle's promise.
A timed-out close can therefore finish in the background after But Why has recorded a Validation Tooling Failure.
But Why does not call `Sandbox.close()` again because Sandcastle makes later calls no-ops.
But Why does not start Git removal while the original close can still be running.

When the original close returns and leaves the workspace preserved, But Why may retry removal through Git.
That retry is allowed only after the original close has returned.
A timeout remains a tooling failure even when background completion later removes the workspace because completion was not proved within But Why's limit.

But Why reports a removed Validation Workspace only after it verifies both that the exact workspace path is absent and that Git's exact worktree registration is absent.
Filesystem absence alone is not sufficient evidence.
If Git worktree inspection cannot prove registration absence, cleanup fails closed and the Validation Run cannot pass.

## Deferred repository ignore ownership

Sandcastle currently requires But Why to manage a repository-root `.gitignore` block for `.sandcastle/` content.
When Sandcastle is removed and no replacement needs a repository-root ignore rule, But Why should stop changing the repository-root `.gitignore`.
If But Why still needs ignore rules, it should own them in `.but-why/.gitignore` without hiding tracked Repo Config or reviewer files.

## Replacement choices

| Choice | Fit | Main limitation |
| --- | --- | --- |
| Project-owned Git worktrees plus direct Pi SDK | Best replacement for what But Why actually uses today | Preserves host execution and provides no security isolation |
| Hardened Docker Engine container plus project-owned worktree | Most mature automatable local isolation option | But Why must own the image, mounts, credentials, network, resource limits, and container lifecycle |
| Docker Sandboxes (`sbx`) | Strong local microVM isolation, private Docker daemon, network policy, and credential proxy | No supported programmatic SDK was found, sign-in is required, and its persistent lifecycle does not match a disposable Validation Run directly |
| Sandcastle with its Docker provider | Fastest way to experiment with containers | Retains the dependency and does not resolve the Pi session and accounting ownership problems |
| E2B, Daytona, or Modal | Managed remote isolation with programmatic interfaces | Paid managed execution is outside the current investigation; it also adds remote code transfer, service availability, credentials, and data policy |
| Dev Containers | Good reproducible development environment | Not a security boundary for an autonomous agent |
| Raw gVisor or Firecracker | Strong lower-level isolation primitives | Requires substantially more orchestration than But Why currently needs |

Docker Sandboxes is promising, but it is not yet a battle-tested drop-in execution Adapter for But Why.
A first-class `sbx run pi` integration would require an official Pi template or a custom kit, but But Why does not need that interface.
But Why can create a generic shell sandbox and launch its controlled Pi command through `sbx exec`, using a project-owned template image when Pi and repository tools must be preinstalled.
The merged [OpenCode Forge sandbox migration](https://github.com/chriswritescode-dev/opencode-forge/pull/82) demonstrates this CLI-driver pattern with `sbx create shell`, `sbx exec`, and a custom template image.
It does not add Pi support to Docker Sandboxes or prove But Why's Pi session, extension, credential, cancellation, and cleanup requirements.

Docker Sandboxes clone mode gives stronger Git isolation, but official guidance says clone mode cannot start from a linked worktree.
Its direct mode can mount the host Validation Workspace, so the microVM protects the rest of the host but does not make the Candidate workspace immutable.
A focused Pi image and lifecycle spike is necessary before selecting it.

## Recommended direction

Replacing Sandcastle with current behavior requires this complete set:

1. A Validation Workspace Adapter creates the Git worktree on But Why's temporary ref, copies allowlisted files, returns its path, and removes it.
2. A Command Execution Adapter runs preparation, Checks, and Git integrity commands in that workspace, handles cancellation, and reports whether process termination is proved.
   The executable entry must translate supported host termination signals into Effect interruption so the Adapter can stop its supervised process group and complete scoped cleanup before exit.
3. A Pi Reviewer Adapter resolves the model and resources, starts or resumes one Change-owned session, collects the reviewer result, performs the correction attempt, and returns session and usage evidence.
4. The Validation Workspace scope composes those Adapters behind one `exec`, reviewer-run, and `close` handle so existing Validation Gate phases do not learn provider details.
5. Migration removes Sandcastle types, failure names, `.sandcastle` path assumptions, ignore rules, tests, documentation, and the package dependency after equivalent conformance tests pass.

Sandbox isolation is not required for behavioral parity because current production uses `noSandbox()`.
Including isolation adds one provider implementation of the Command Execution and Pi Reviewer interfaces, plus an image, workspace mounts or transfer, credentials, network policy, resource limits, process-tree termination, and environment cleanup.

Use Git itself for Validation Workspace creation and the installed Effect Scope and Effect Platform command facilities for acquisition, execution, interruption, timeout, process-group termination, and finalization.
Worktrunk, simple-git, execa, and zx do not remove But Why's Candidate, recovery, or evidence rules and would duplicate existing infrastructure.

Use the Pi SDK for reviewer sessions because it already owns Pi models, explicit resources, JSONL sessions, cancellation, and usage statistics.
A TypeBox `review_result` terminal tool can collect a typed result, and one second `session.prompt()` on the same session can implement the current correction attempt.
`SessionManager.open()` with a current-working-directory override can resume a Reviewer Session in a successor Validation Workspace without rewriting its JSONL header.

The Pi SDK cannot apply the configured Agent Environment around an in-process session.
The host implementation should therefore launch a small But Why-owned Pi worker through the existing Effect command Adapter and Agent Environment wrapper.
The same worker contract can later run through a sandbox provider.
The worker is project-specific glue, but another agent framework would not remove it while preserving Pi extensions, skills, sessions, and usage.

Then test sandbox providers behind the Command Execution and Pi Reviewer interfaces.
Start with one real Candidate fixture that proves workspace transfer, a curated self-contained Pi resource bundle, model authentication, session resume, network policy, process-tree termination, integrity detection, and cleanup.
Compare local sandbox candidates only when sandbox research resumes.
Paid managed providers such as Daytona and E2B are outside the current direction.
OpenShell is Alpha, Gondolin is experimental, and raw Firecracker requires But Why to build the missing control plane.

Do not move Herdr or the Implementer into this replacement by default.
Interactive hosting, visible terminal control, trusted Pi extensions, and unattended-agent isolation have different lifecycle requirements from disposable validation.

## Deferred reviewer session-prefix research

A future optimization could create one prepared reviewer-session prefix and fork specialized reviewers from it.
The prepared prefix could contain accepted intent, the changed-file inventory, and selected file contents collected through normal tools.
Standards and acceptance reviewers could then begin from the same repository evidence instead of repeating the same initial exploration.

This idea is not part of the Sandcastle replacement.
Research must establish whether Pi session forking preserves the exact provider cache prefix, whether the saved exploration exceeds the prefix construction cost, and whether the approach preserves independent reviewer judgment.
The prepared evidence must also remain bound to the exact Candidate and must not replace reviewer access to normal exploration tools.

## Usage and cost accounting

Usage accounting should be a But Why domain capability, not a Sandcastle feature.
Pi's SDK exposes session statistics for input, output, cache tokens, reported cost, and context usage.
The direct SDK reviewer can therefore produce Pi-native usage evidence.
An Implementer extension can observe the same Pi events or session records for the interactive session.

Record each agent invocation with these associations:

- Implementer usage belongs to its Change and Interactive Session.
- Reviewer usage belongs to its Change, Validation Run, and Reviewer Producer.
- A Task total is derived through its linked Change.
- Planning remains outside this total until its ownership is defined.

Store tokens and reported cost as evidence from one runtime invocation or model response, with a stable identity that prevents resumed-session totals from being counted twice.
Represent unavailable usage as unknown rather than zero.
Treat Pi's reported monetary cost as an estimate unless provider billing supplies an authoritative billed amount.
Spending limits require incremental usage events and a cancellation provider that proves the process stopped; end-of-session statistics alone can report cost but cannot enforce a hard limit.

## Indicative replacement effort

A properly designed host-only replacement is estimated at six to ten focused coding-agent working days, normally one to two calendar weeks with review and live-model verification.
This estimate includes architecture, bounded feasibility checks, project-owned worktrees, Effect command execution, a wrapped Pi SDK worker, reviewer output and session migration, usage evidence, Sandcastle removal, tests, documentation, and review fixes.
It does not authorize that work.

Production isolation and a portable Pi resource contract would add approximately five to ten focused coding-agent working days.
The combined replacement and isolation effort would likely require two to four calendar weeks.
A future second harness would require its own Adapter and conformance work after evidence establishes the shared interface.

## Replacement verification

A replacement is credible only when conformance tests prove:

- The Validation Workspace contains the exact Candidate SHA.
- Preparation, Checks, and reviewers share the intended workspace state.
- The Candidate integrity check detects reviewer or command writes.
- Reviewer Sessions resume in a successor disposable workspace without stale paths or duplicate authority.
- Cancellation terminates the owned process tree or reports that termination is unproved.
- Cleanup records the actual worktree and execution-environment outcome after success, failure, and interruption.
- Host Git configuration and credentials are not changed or exposed beyond the selected policy.
- Usage evidence does not turn missing values into zero or double-count resumed sessions.

## External references

- [Sandcastle](https://github.com/mattpocock/sandcastle)
- [Docker Sandboxes](https://docs.docker.com/ai/sandboxes/)
- [Docker Sandboxes architecture](https://docs.docker.com/ai/sandboxes/architecture/)
- [Docker Sandboxes usage and clone mode](https://docs.docker.com/ai/sandboxes/usage/)
- [Docker Sandboxes Pi support request](https://github.com/docker/sbx-releases/issues/34)
- [OpenCode Forge `sbx` CLI migration](https://github.com/chriswritescode-dev/opencode-forge/pull/82)
- [Docker Engine bind mounts](https://docs.docker.com/engine/storage/bind-mounts/)
- [Dev Containers](https://containers.dev/overview)
- [gVisor](https://gvisor.dev/docs/architecture_guide/intro/)
