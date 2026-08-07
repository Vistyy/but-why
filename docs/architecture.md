# Architecture

But Why is a repository-scoped validation workflow for agent-assisted code work.
It is task-based, not pipeline-based.

## Ownership

A Task owns requested intent, dependencies, and user-facing lifecycle.
A Change owns one code lineage, Managed Worktree, Candidates, Validation Runs, Findings, and an owned pull request.
A Change may link to one Task.

Task commands manage intent and lifecycle.
Change commands manage implementation, validation, delivery, and reconciliation.
Submission executes the fixed Validation Gate against a Candidate.

The source hierarchy follows these owners:

- `src/task/` owns Task records, lifecycle rules, identity, persistence interfaces, files, and composition.
- `src/change/` owns Change records, Candidates, Candidate capture, Validation Runs, validation phases, publication, submission, and composition.
- `src/change/interactiveSession/` owns Interactive Session launch preparation and host execution, including configuration resolution, resource validation, prompt construction, session naming, host invocation, and launch-result production. `ChangeUseCases.implement` retains Change lookup and open-state validation and delegates to `launchInteractiveImplementer.ts`. `InteractiveSessionHost` remains the only injected Interactive Session seam and `loadChangeUseCases.ts` selects `herdrInteractiveSessionHost.ts` as the default and only supported host.
- `src/change/packageAssetPath.ts` owns package-asset resolution and remains in its current location.
- `src/agent/` owns reviewer-agent execution Adapters and Agent Profile resolution.
- `src/cliCommandTree.ts` owns the Effect CLI command tree, routing, syntax, and generated help.
- `src/cli/` owns command Adapters, and `src/cli.ts` owns the executable entry boundary.
- `src/cli/change/implementerPromptFile.ts` owns Implementer Prompt file input handling and `src/cli/change/implementResult.ts` owns Change Implement result rendering.
- `src/contracts/` owns configuration, output, and shared error contracts.
- `src/init/` owns Local Repository initialization and repository-context Adapters.
- `src/output/` owns structured output codecs and serializers.
- `src/repositoryPreparation/` owns the shared Repository Preparation Adapter.
- `src/sqlite/` owns SQLite persistence Adapters.
- `src/submissionEnvironment/` owns Git and GitHub submission-environment Adapters.

CLI modules select operations and translate results.
They do not construct storage or coordinate persistence.
Task and Change modules own the narrow persistence operations that preserve their invariants.
Repository storage composition owns database lifecycle and constructs SQLite Adapters.

## Change workflow

`by change start [--task <task-id>] [--base <branch>]` fetches a publication-remote branch and creates a Managed Worktree.
Without `--base`, Change Start uses the remote default branch.
With `--base`, Change Start uses the named remote branch.
Local branches cannot supply a Change Base.

New Managed Worktrees use `<main-checkout-parent>/<main-checkout-name>-worktrees/but-why/<change-slug>`.
But Why resolves the root from the canonical main checkout, including when Change Start runs from a linked worktree.
Existing Changes retain their recorded absolute paths.
Change Start runs Repository Preparation in the new Managed Worktree.
A failed preparation attempt preserves the open Change and is recorded as the current preparation failure.
A Task-backed Change captures immutable Acceptance Context.
A taskless Change has no Acceptance Context.

When the Managed Worktree is missing or has a stale registration, a resumed Task Change Start or `by change prepare <change-id>` recovers the exact recorded Repository Branch at its current commit when the branch exists and is not attached elsewhere.
Recovery preserves every commit on the recorded branch and never resets, rebases, replaces, or guesses a commit.
A branch attached elsewhere, a missing recorded branch, or a managed path containing conflicting files stops with actionable identity and location facts, and conflicting files are never overwritten or removed.
The operator may recover the branch externally or cancel the Change or its linked Task.

`by change submit <change-id>` observes the current owned pull request before starting a new Submission.
A new Submission selects the Change from Shared Repository State, reads the Repo Config from the exact fetched Change Base as the non-review policy baseline, and captures a Candidate.
The caller checkout supplies only Local Repository identity, Shared Repository State, and Change selection.
The caller checkout's Repo Config is not a Change Submit policy source.
Submission reads the Candidate's tracked Repo Config after Candidate capture for reviewer policy and Repo Agent Profiles.
The Change Base Repo Config supplies Repository Preparation, Checks, Validation Workspace inputs, and the Agent Environment.
The Candidate Repo Config supplies reviewer selections and Repo reviewer profiles.
It resolves the complete Validation Policy from the baseline and Candidate reviewer configuration before validation starts.
The fetch updates only the remote-tracking ref.
It does not modify the Managed Worktree or Repository Branch.
Repo reviewer profiles and resources are resolved from the exact Candidate Validation Workspace during reviewer execution.

A Candidate is identified by its Change, `changeBaseSha`, and `headSha`.
Tracked-tree equality with the fetched Change Base returns `nothing_to_submit` after the ancestry check passes.
A changed Candidate passes through Repository Preparation, Checks, Acceptance Review when task-backed, configured Specialists, and publication policy.

Validation persistence owns one-active-run uniqueness and unresolved-Blocker rejection.
Validation admission refuses a Change with an unresolved Implementation Blocker, and each admitted Validation Run records the exact Candidate, Change Base, Validation Policy Snapshot (including the current Acceptance Context when present), Implementation Decision input, and the latest resolved Implementation Blocker identity at admission.
Validation Run reuse and publication require the exact stored Candidate identity, complete state, a passed outcome, and the current authority: the exact Change Base, current Acceptance Context when present, the resolved Validation Policy Snapshot, the current Implementation Decisions, and the same latest resolved Implementation Blocker identity.
A changed Candidate, Resolution, Acceptance Context, policy, or implementation input invalidates current validity without deleting historical evidence.
For a taskless Change, a later Resolution makes earlier Runs historical without creating Acceptance Context or Acceptance Review.
Fresh passing evidence for the same Candidate already on the owned pull request records the new Validation Run without artificial republication.
Change Submit performs no duplicate admission precheck and performs no transient Task state transitions.

`by change reconcile [<change-id>]` observes owned pull requests.
A merged owned pull request closes the Change and completes its linked Task only when its merged head matches the current publication facts.
A merged-head mismatch rejects reconciliation and preserves the Open Change.
Cleanup deletes a Remote Change Branch only when it still identifies the exact published Candidate head.
Submit, publication, cancellation, and reconciliation share one pure owned-pull-request identity classifier.
Submit passes an exact merged owned pull request to terminal completion and does not run full reconciliation or cleanup.

`by change reconcile <exact-change-id> --discard-work` authorizes one discard attempt for that exact terminal Change.
The flag is rejected without one exact Change ID and when the selected Change is open.
For that one attempt it may remove a dirty Managed Worktree, delete unique local Repository Branch work, and delete a changed Remote Change Branch using the exact head observed for that attempt.
Unreadable, mismatched, or changed-after-read remote facts stay pending and are never deleted.
The authorization is not persisted and ordinary reconciliation without the flag retains every preservation safeguard.

Completion, cancellation, repeated cancellation, and reconciliation run one Change-owned terminal cleanup operation.
Terminal state with cleanup pending is recorded before cleanup begins, and the operation retries idempotently when cleanup is already complete, a resource is already missing, or a prior attempt left cleanup pending.
For an exact owned open pull request, cancellation closes the pull request before the cleanup operation deletes the Remote Change Branch.
Completed and Cancelled Changes use the same cleanup scope and safeguards, covering the Managed Worktree, local Repository Branch, and Remote Change Branch.
Terminal cleanup first records one immutable Reviewer Transcript reference for every retained Reviewer Session JSONL file in the Change's per-producer storage, then removes active Reviewer Session records after successful transcript indexing without deleting the retained JSONL files or historical references.
When cleanup completes, the operation invokes the Reviewer Session and Artifact lifecycle owners for the exact terminal Change.
Dirty worktrees, unique local commits, changed Remote Change Branches, unreadable identities, and incomplete transcript indexing keep cleanup pending without undoing terminal truth.

## Storage

Shared Repository State lives under `<git-common-dir>/but-why/`.
SQLite, Artifacts, and other operational state are shared by linked worktrees.
SQLite Adapters strictly decode persisted structured values and required row fields at their owning read seams.
Malformed stored data returns `RepositoryPersistedDataInvalid` with the owning operation context and is never repaired, normalized, or replaced with fallback state.
Repo Config remains tracked at `.but-why/config.json`.

State databases initialize through immutable ordered Effect SQL migrations beginning with `0001_baseline`.
A schema change appends a new Migration Artifact instead of rewriting an applied migration.
The migration chain shipped in the first public release remains frozen after release.

## CLI and configuration

The public CLI is `by`.
It returns structured results on stdout.
TOON is the default format.
Callers that parse output request JSON with `--json`.
The output ownership and expansion rules are defined in [CLI output](cli-output.md).

Repo Config owns Repository Preparation, Checks, Validation Workspace inputs, review policy, Repo Agent Profiles, and the Agent Environment.
Global Config owns Global Agent Profiles, reviewer defaults, and Interactive Session preferences.
Change Submit resolves the non-review Repo Config baseline from the Change Base and reviewer Repo Config from the Candidate, then resolves Global Config from the configured user path.
It constructs one resolved Validation Policy before validation and reuses that policy for Validation Policy Snapshot evidence and eligible publication.
The public configuration contract is in [But Why Config](public/config.md).

Accepted decisions that constrain this design are recorded in [ADRs](adr/).
