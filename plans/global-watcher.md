# Global Watcher planning record

Status: Paused pending the Task Intent extraction boundary.

The prior planning direction depends on repository-owned Task state, automatic Task selection, and atomic Task and Change completion.
Those assumptions are under reconsideration.
Do not use this plan as current planning direction or implementation authority.
No Task Recording, Task Submission, Change Start, or Implementation Authorization is granted by this file.

Removal condition: Remove this file after the accepted outcomes are recorded in the smallest applicable SQLite Tasks and all implemented behavior and architectural decisions are recorded in their authoritative artifacts.

## Deferral

The Global Watcher is not required for `0.1.0`.
The first stable release can use the current explicit repository-scoped workflow.
Revisit this plan after the first release has established the installed `by` executable, version, upgrade, and package verification contracts.
Candidate Publication and its Agent Session and Shared Repository State work can proceed independently of this plan.

## Outcome

One persistent user-level Global Watcher supervises trusted Local Repositories without owning their Task or Change workflow state.
It reconciles repository state, observes external pull request changes, and starts explicitly authorized Automatic Implementation through visible Herdr Interactive Sessions.

The normal experience is:

- `by init` automatically enrolls or refreshes the current Local Repository.
- `by watch` enables and starts the background Watcher.
- The Watcher continues after the terminal closes and starts when the user logs in.
- New enrollments become available without manual list editing or a Watcher reload.

## Ownership

The Global Watcher owns repository enrollment, durable wakes, scheduling, repository process isolation, worker health, restart recovery, and process coordination.
It does not own Tasks, Changes, Candidates, Validation Runs, Implementation Authorization, or publication facts.
Each Local Repository's Shared Repository State remains authoritative for its workflow state.

A user-local SQLite database is authoritative only for Watcher enrollment and latest useful health.
It must not copy repository workflow state.

## Storage layout

Use these existing or accepted ownership boundaries:

```text
<git-common-dir>/but-why/state.sqlite
  Repository-owned durable Task and Change state

~/.config/but-why/config.json
  User-authored Global Config

~/.local/state/but-why/watcher.sqlite
  Durable Watcher enrollment and latest health

$XDG_RUNTIME_DIR/but-why/watcher.sock
  Temporary live IPC endpoint
```

Use systemd's journal for Watcher logs.
Do not add a PID file, lock file, registry JSON file, durable worker queue, or separate Watcher log directory.

## Repository enrollment

`by init` automatically enrolls or refreshes the Local Repository after repository initialization succeeds.
Enrollment authorizes monitoring and reconciliation only.
It does not grant Implementation Authorization.

An enrollment stores only:

- The enrollment stores the canonical Git Common Directory.
- The enrollment stores the enrollment time.
- Last successful check time.
- Latest error when present.

Linked worktrees resolve to one enrollment through the Git Common Directory.
The Watcher uses no checkout path as enrollment state or executable authority.
A missing or inaccessible repository remains enrolled and is reported as unhealthy.
The Watcher does not scan the filesystem, guess a moved location, or silently delete an enrollment.
Repository relocation remains unsupported.

If repository initialization succeeds but enrollment fails, `by init` reports both outcomes and does not undo repository initialization.
Rerunning `by init` repairs enrollment idempotently.
Enrollment succeeds even when the Watcher is not enabled.

## Public commands

The intended public command surface is:

```text
by watch                 Enable and start the Watcher
by watch status          Show service and repository health
by watch stop            Stop and disable the Watcher
by watch remove [path]   Remove the current or specified enrollment
```

`by init` is the only enrollment command.
The optional removal path supports an unavailable repository.

`by watch status` combines:

- systemd enabled and running state;
- IPC responsiveness and Watcher version;
- enrolled repository health from `watcher.sqlite`.

Status is read-only and distinguishes a stopped service, an unresponsive process, and an unhealthy repository.

## Linux service lifecycle

The first supported Watcher service uses Linux `systemd --user` only.
`by watch` enables and starts the service for login-scoped persistence.
It does not enable systemd linger.
Unsupported operating systems return a clear error and do not start an unmanaged detached process.

The service runs the globally installed `by` executable.
When enabled, `by watch` records the caller's non-secret `PATH` in the systemd unit so repository workers can find required commands.
It does not source shell startup files or copy credentials.
Rerunning `by watch` refreshes the unit and its environment.

`by watch` reports success only after the Watcher answers an IPC readiness request.

## IPC

Use Node's local `node:net` support through the Unix socket under `$XDG_RUNTIME_DIR`.
Restrict the socket directory to the current user.
Processes running as the same operating-system user remain trusted under the current security boundary.
Do not add tokens or encryption.

The protocol has only two operations:

- `ping` reports readiness and Watcher version.
- `wake` requests an immediate check of one enrolled Local Repository.

IPC is a transient wake mechanism rather than authoritative state.
Repository and Watcher SQLite state allow recovery when a message is missed.

Enrollment operations update `watcher.sqlite` and then send a wake when the Watcher is available.
`by watch status` reads durable status directly and uses `ping` only for live process facts.
Service stop uses systemd rather than a generic IPC command.

## Repository workers

The Watcher starts one short-lived child process for each repository check using the installed `by` executable.
The worker validates the exact Local Repository, opens its Shared Repository State, invokes repository-owned operations, returns a bounded structured result, and exits.

Workers do not open `watcher.sqlite`.
The Watcher alone records enrollment health.
Herdr Interactive Sessions have an independent lifecycle and continue after a repository worker exits.

Never run two workers for the same Local Repository concurrently.
Combine duplicate wakes while a worker is running or already due.
Different repositories may run concurrently.

Global Config controls the global worker limit:

```json
{
  "watcher": {
    "maxWorkers": 4
  }
}
```

`maxWorkers` is a positive integer and defaults to `4`.
It is distinct from repository Automatic Implementation capacity.

A worker has a fixed five-minute timeout.
On timeout, terminate its process tree, mark the repository unhealthy, and reconcile repository state before a later retry.

## Wakes and recovery

Use a hybrid wake model:

- Local CLI changes send an immediate IPC wake.
- Healthy repositories are checked every 60 seconds.
- Repeated failures increase the delay up to 15 minutes.
- A new IPC wake bypasses failure backoff.

On Watcher startup, treat every enrollment as due.
Do not restore a durable worker queue.
Workers derive required actions from current repository-owned durable state.

During graceful shutdown, stop accepting new wakes and let active workers finish within their existing timeout.
Herdr Interactive Sessions continue independently.

## Repository check behavior

A repository worker performs one bounded advancement pass:

1. Validate the enrolled Local Repository identity.
2. Reconcile Open Changes with exact owned pull request facts.
3. Complete exact merged Candidates and linked Tasks through existing Change-owned operations.
4. Perform required terminal cleanup.
5. Ask the repository-owned Automatic Implementation operation whether authorized work can start.
6. Return bounded health and activity facts.

The Watcher must not reproduce Task eligibility, Change reconciliation, or terminal cleanup policy.

## Automatic Implementation

Automatic Implementation remains separate from Task Submission and Task Review.
Tracked Repo Config enables it and grants standing Implementation Authorization:

```json
{
  "automaticImplementation": {
    "maxConcurrency": 2
  }
}
```

`maxConcurrency` is a positive integer.
Repo Config and Git history are sufficient authorization representation and audit evidence.
Do not add an authorization snapshot, automatic label, claim record, scheduling lock, or separate audit record.

A Task is eligible when:

- it is Todo;
- every prerequisite is Done; and
- it has no linked Open Change.

Select eligible Tasks in this order:

1. Tasks that are direct prerequisites of at least one unfinished direct dependent in New or Todo.
2. Other eligible Tasks.
3. Lowest numeric Task ID within each group.

The direct-dependent preference is binary.
Do not add transitive weighting, priority scoring, or another scheduling model.

Capacity counts all implementing and validating Changes.
Ready, Blocked, and Closed Changes do not count.
If a Blocked Change resumes and temporarily exceeds `maxConcurrency`, do not pause or stop existing work.
Start no new Tasks until capacity is available.

Removing `automaticImplementation` prevents new automatic starts.
It does not interrupt existing Implementers, whose Implementation Authorization continues until a normal return condition.
No Implementation Budget is required.
Operator, Implementer, and reviewer authority separation remains deferred in `docs/open-questions.md`.

Automatic work uses visible, interactable Herdr Interactive Sessions.
The repository worker recalculates capacity after each confirmed launch and continues until capacity is full, no eligible Task remains, or a launch is uncertain.
After an uncertain launch, stop the repository pass and reconcile the Open Change and Herdr state before any retry.
An Open Change prevents a duplicate Task start.

Do not add an Automatic Implementation status concept unless later implementation evidence demonstrates a current user-facing need.

## Updates and migrations

IPC `ping` reports the Watcher version.
When a newer CLI detects an older Watcher, it refreshes the systemd unit with the current absolute executable path and `PATH`, requests graceful replacement, and lets systemd start the new version.
Herdr Interactive Sessions continue independently.

Before changing `watcher.sqlite`, stop the older Watcher cleanly.
The new Watcher applies ordered migrations during startup before serving requests.
Do not let old and new Watcher versions use the database during migration.

The exact update flow must align with the installed executable, `by --version`, and package upgrade contracts established by the released product.

## Implementation slices

The following are candidate Task boundaries for reconsideration after the first release.
They are not authorized Tasks.

1. Maintain the trusted repository inventory through `by init`, `by watch status`, and `by watch remove` without running a Watcher.
2. Enable a responsive Linux systemd user service with IPC readiness, status, and stop behavior without inspecting repositories.
3. Process an immediate wake through one isolated repository worker and persist its resulting health.
4. Add periodic checks, failure backoff, worker timeout, restart recovery, and graceful draining.
5. Reconcile owned pull requests and terminal Change cleanup during a repository check.
6. Run distinct repository workers concurrently under configurable `watcher.maxWorkers` while preserving per-repository exclusion.
7. Replace an older Watcher safely across installed CLI updates and `watcher.sqlite` migrations.
8. Start one authorized eligible Task and its visible Herdr Interactive Session during a repository check.
9. Fill all available Automatic Implementation capacity during one repository check.

Use the smallest supported, independently understandable, implementable, reviewable, and verifiable vertical slices when recording Tasks.
Reassess these boundaries against the released executable and current repository architecture rather than copying them mechanically.

## Dependencies on the released product

Before Task authoring, confirm:

- the globally installed executable contract;
- `by --version` and package-version authority;
- the supported package upgrade procedure;
- the current Global Config and Repo Config contracts;
- current Task, Change Activity, reconciliation, and Herdr behavior; and
- the current Linux support policy.

The Watcher does not depend on Candidate Publication, Publication Agent behavior, Agent Session generalization, or shared Review persistence unless the released architecture later creates a concrete dependency.
