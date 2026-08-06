---
status: proposed-for-operator-approval
artifact_kind: working-plan
remove_when: the approved migration is complete, the final scheduling decisions are recorded in VERIFICATION.md, and verification-portfolio-redesign.md is removed
---

# Complete verification portfolio allocation

> This proposal is not approved implementation intent.
> It replaces open-ended local duplicate discovery with one finite portfolio disposition.

## Outcome

Every maintained test and check must establish one approved Verification Claim or one named operational contract through the cheapest reliable required seam.
The approved migration must remove obsolete and duplicate evidence, close identified evidence gaps, settle scheduling controls, and leave no unallocated retained evidence.

## Material Risks

- **MR1 Approved-intent identity loss:** But Why can act on unapproved, incomplete, or later-mutated intent.
- **MR2 Candidate or Validation identity loss:** But Why can judge, reuse, publish, complete, or clean up the wrong Candidate or Validation evidence.
- **MR3 External-target identity loss:** But Why can mutate the wrong repository, branch, pull request, or commit.
- **MR4 Durable-state inconsistency:** Concurrency, interruption, malformed data, or uncertain external mutation can make durable facts inconsistent.
- **MR5 Destructive cleanup loss:** Recovery or cleanup can delete unique work or required retained evidence.
- **MR6 False terminal result:** But Why can complete or cancel work without authoritative terminal facts.

## Refreshed finite Verification Claims

### Approved intent

- **C01 Task intent mutation:** Task creation, Context changes, comments, approval, dependencies, and cancellation preserve the exact requested intent and reject invalid lifecycle or dependency mutations without changing the Task graph.
- **C02 Change Start authority:** Change Start links only an approved Task whose dependencies are satisfied and captures that exact Task Context as Acceptance Context.
- **C03 Captured review authority:** Acceptance Review uses the captured Acceptance Context and does not substitute later mutable Task text.

### Candidate, worktree, validation, and reviewer identity

- **C04 Candidate capture:** Candidate capture identifies the exact fetched Change Base and Repository Branch head and rejects dirty, unsafe, or invalid ancestry facts.
- **C05 Managed Worktree identity:** Change Start and recovery provision or reattach only the exact recorded Repository Branch in a safe Managed Worktree without overwriting, guessing, resetting, or attaching another Change's work.
- **C06 Validation Gate completion:** A passed Validation Run represents completion of every required Validation Gate producer against one fresh exact-Candidate Validation Workspace.
- **C07 Validation Policy authority:** Validation Policy resolves Repository Preparation and Checks from the Change Base, reviewer configuration from the Candidate, Global Config, Acceptance Context, and Implementation Decisions from their accepted authorities.
- **C08 Validation evidence reuse:** Reuse and publication require the same Candidate, Change Base, current Acceptance Context, Validation Policy Snapshot, Implementation Decisions, and latest resolved Implementation Blocker identity.
- **C09 Reviewer judgment and continuity:** A reviewer judges the exact Candidate, and a resumed Reviewer Session uses the same Change, producer, compatible fingerprint, and preserved usability classification.
- **C10 Reviewer runtime isolation:** Reviewer Agent Runtime supplies only the resolved Agent Environment and curated Pi resources and reports launch, output, or usability uncertainty truthfully.
- **C11 Implementer handoff:** An Implementer handoff starts only for the exact recorded Change and Managed Worktree, and missing, mismatched, active, or indeterminate bindings do not start another Change's work.
- **C12 Blocker authority:** An unresolved Implementation Blocker prevents authoritative Validation, and an accepted Resolution makes earlier evidence historical whenever current authority requires fresh Validation.

### Publication, reconciliation, and terminal behavior

- **C13 Owned pull request identity:** Publication and reconciliation accept an owned pull request only when repository, base branch, head branch, state, head commit, Candidate, Validation Run, and pull request identity match recorded facts.
- **C14 Remote Change Branch mutation:** Remote Change Branch creation, update, and cleanup act only on the expected exact commit or report an unavailable, uncertain, or changed fact without claiming success.
- **C15 Active Validation Run uniqueness:** Shared Repository State admits at most one Active Validation Run for a Change and interruption recovery abandons only the exact Run and workspace.
- **C16 Atomic terminal writes:** Change completion or cancellation and its linked Task terminal update commit atomically or leave both lifecycle records unchanged.
- **C17 Migration preservation:** Forward migrations preserve supported current facts and reject restored transient lifecycle states or malformed consequential data without creating valid-looking work.
- **C18 Shared-state snapshot:** Snapshot creates one independently readable coherent Shared Repository State copy without overwriting an earlier snapshot or mutating source state.
- **C19 Persisted-data truthfulness:** Malformed consequential persisted data produces `persisted_data_invalid`, while unavailable storage and restored transient states remain distinct actionable results.
- **C20 Ordinary recovery preservation:** Ordinary recovery and cleanup preserve dirty work, unique local commits, advanced Repository Branches, changed Remote Change Branch heads, and unrelated shared state.
- **C21 Artifact Content lifecycle:** Terminal Cleanup removes all and only the exact Closed Change's Artifact Content, keeps Artifact metadata and another Change's active content, and remains pending after removal failure.
- **C22 Reviewer Transcript lifecycle:** Terminal Cleanup indexes every exact Reviewer Transcript before removing active Reviewer Session records, keeps retained transcript files and historical references, and retries without duplication.
- **C23 Explicit discard:** `--discard-work` applies only to one exact terminal Change for one attempt and does not bypass repository, branch, or Remote Change Branch identity checks.
- **C24 Exact merged completion:** Only exact merged-Candidate observation completes a Change and its linked Task.
- **C25 No-Change truthfulness:** `nothing_to_submit` keeps the Change and Task open and does not create Validation evidence or infer cancellation.
- **C26 Cancellation authority:** Cancellation requires explicit operator authority, closes only the exact owned open pull request when applicable, and updates only the selected Change and any Task that Change owns.

### Interfaces and repository runtime

- **C27 Mutation result truthfulness:** A successful CLI mutation returns sufficient committed supported facts, while invalid, unavailable, blocked, or uncertain operations return distinct actionable results without terminal-looking success.
- **C28 Inspection truthfulness:** Task, Change, Finding, Validation Run, Artifact, Blocker, and Decision inspection report only current durable or explicitly historical facts with the command needed for omitted detail.
- **C29 Repository initialization:** Initialization creates or repairs required Local Repository artifacts at the Git root and Git Common Directory without replacing valid configured policy.
- **C30 Runtime-fact rejection:** Initialization and repository entry reject invalid repository identity, configuration, restored lifecycle, and state-store facts with truthful actionable results.

Together these 30 Claims are finite for the current supported product.
A new product behavior requires an explicit Claim change rather than an implicit new test category.

## Named non-product evidence owners

- **O01 CLI process contract:** The built CLI owns executable loading, native argument parsing, TOON and JSON envelope parity, one trailing line feed, piped stdin, version output, and interruption behavior that cannot be established in-process.
- **O02 Portable package contract:** The packed package owns its allow-listed contents, bundled CLI loading, portable extensions, and portable skill behavior.
- **O03 Source Checkout Guard:** The linked-worktree sentinel owns Trusted But Why Executable selection until first-release executable selection replaces it.
- **O04 Contributor tooling contracts:** Fallow, ast-grep, type checking, lint, formatting, documentation, and build checks own their named structural or reader-visible contracts.
- **O05 Test-operation contract:** Capacity locking, process-tree supervision, temporary-workspace isolation, SQLite execution locking, and test cleanup own reliable execution of maintained evidence.
- **O06 External host contract:** Captured Herdr behavior owns launch classification and recovery, while a real Herdr smoke check is manual and non-blocking.
- **O07 Reviewer protocol contract:** Reviewer structured output, token usage, prompts, and runtime adapter documentation own the protocol consumed by validation.
- **O08 Configuration schema contract:** Configuration decoders own accepted current fields, unknown-field rejection, and actionable diagnostics without preserving retired field names.

## Primary evidence owners

Each Claim has one lead owner.
A listed supporting owner proves only a different required seam or command mapping and does not duplicate the lead proof.

| Claim | Lead owner and required focused support | Required seam |
| --- | --- | --- |
| C01 | Lead: `task-persistence-policy.test.ts`; support: `task-dependency-persistence.test.ts` and focused `task-cli.test.ts` mapping | SQLite plus in-process CLI |
| C02 | `change-start-managed-worktree.boundary.test.ts` | SQLite and Git |
| C03 | `candidate-acceptance-review.boundary.test.ts` | SQLite, filesystem, and captured reviewer |
| C04 | `change-candidate-capture.boundary.test.ts` | Git |
| C05 | `change-start-managed-worktree.boundary.test.ts` | SQLite, Git, and filesystem |
| C06 | Lead: `candidate-validation.boundary.test.ts`; support: `validation-check-round.test.ts` | Git, SQLite, filesystem, and one real Check command |
| C07 | `candidate-validation-policy.test.ts` | Captured configuration Adapters |
| C08 | `change-submit-orchestration.test.ts` | Captured domain Adapters, with SQLite only for stored equality |
| C09 | Lead: `candidate-acceptance-review.boundary.test.ts`; support: `reviewer-session.test.ts` | SQLite and filesystem |
| C10 | `reviewer-agent-runtime.test.ts` | One real reviewer process plus captured runtime variations |
| C11 | Lead: `portable-implementer-session.test.ts`; support: `change-implement.boundary.test.ts` | Filesystem and one built-process sentinel |
| C12 | `change-submit-orchestration.test.ts` | Captured domain Adapters and focused SQLite admission |
| C13 | Lead: `owned-pull-request-classifier.test.ts`; support: `publication-policy.boundary.test.ts` | Captured GitHub facts and SQLite publication state |
| C14 | `github-pull-request-gateway.test.ts` | Captured GitHub commands and exact Git commit facts |
| C15 | `candidate-validation-inspection.boundary.test.ts` | SQLite and filesystem |
| C16 | Lead: `change-reconciliation.test.ts`; support: `change-cancellation.test.ts` and rollback triggers in `repository-storage.boundary.test.ts` | Real SQLite |
| C17 | Migration cases in `repository-storage.boundary.test.ts` | Real SQLite |
| C18 | `shared-state-snapshot.boundary.test.ts` | Real SQLite, Git worktree, and filesystem |
| C19 | `repository-storage.boundary.test.ts` with command-local result mappings | Real SQLite plus in-process CLI |
| C20 | `change-cleanup-git.boundary.test.ts` | Git and filesystem |
| C21 | `artifact-lifecycle.boundary.test.ts` | SQLite and filesystem |
| C22 | `reviewer-transcript.test.ts` | SQLite and filesystem |
| C23 | `change-reconcile-discard.boundary.test.ts` plus pure CLI result mapping | Git, filesystem, and in-process CLI |
| C24 | `change-reconciliation.test.ts` | SQLite and captured exact GitHub facts |
| C25 | `change-submit-orchestration.test.ts` | Captured Candidate and Validation Adapters |
| C26 | `change-cancellation.test.ts` | SQLite and captured GitHub facts |
| C27 | The command test owned by each mutating capability | In-process CLI unless OS process behavior is required |
| C28 | Lead: `change-inspection.boundary.test.ts`; support: `task-cli.test.ts` and `candidate-validation-inspection.boundary.test.ts` | SQLite plus in-process CLI |
| C29 | `cli.test.ts` initialization cases | Git and filesystem |
| C30 | `init-edge-cases.test.ts` and focused CLI error mapping | Git, filesystem, SQLite, and in-process CLI |

## Complete test-file allocation

This table allocates every current test case by allocating every current test file.
Unless an action below names an exact exception, every case in a `Retain` row remains allocated to the listed Claim or operational owner because its test title identifies the distinct rejected input, lifecycle branch, integration failure, or recovery outcome.
A parameterized case remains one maintained mechanism when the cases share setup and decision logic.

### Agent and reviewer tests

| File | Allocation | Disposition |
| --- | --- | --- |
| `test/agent/agent-profile.test.ts` | C07, C10, C11 | Retain current profile precedence, resource resolution, and typed failure cases. |
| `test/agent/continue-change-extension.test.ts` | O02, C11, C12, C26 | Retain as the portable continuation state-to-action contract. |
| `test/agent/continue-change.test.ts` | C03, C08, C11, C12, C13 | Retain as the pure continuation decision owner. |
| `test/agent/herdr-interactive-session-host.test.ts` | C11, O06 | Retain captured host launch, active-session, retryable, and indeterminate classifications. |
| `test/agent/herdr-smoke.test.ts` | O06 | Remove the environment-skipped test from maintained evidence and document the existing environment-gated operation as a manual diagnostic. |
| `test/agent/reviewer-agent-runtime.test.ts` | C10 | Retain one real-process isolation sentinel and captured launch, output, and session-file variations. |
| `test/agent/reviewer-output-contract.test.ts` | O07, C27 | Retain current structured-output acceptance and rejection variants. |
| `test/agent/reviewer-prompts.test.ts` | C03, C09, O07 | Retain current authority and historical-evidence distinctions. |
| `test/agent/runtime-adapter-docs.test.ts` | O04, O07 | Retain the public setup-to-adapter synchronization check. |

### Change tests

| File | Allocation | Disposition |
| --- | --- | --- |
| `test/change/artifact-lifecycle.boundary.test.ts` | C21 | Retain as the Artifact Content primary owner. |
| `test/change/blocker-input.test.ts` | C12, C27 | Retain shared long-text validation at the in-process seam. |
| `test/change/change-cancellation.test.ts` | C16, C24, C26, C27 | Retain cancellation authority, pull-request closure ordering, active-run rejection, and the two CLI mappings preserved by BY-137. |
| `test/change/change-candidate-capture.boundary.test.ts` | C04 | Retain real-Git identity, ancestry, and unsafe-workspace cases. |
| `test/change/change-candidate-capture-orchestration.test.ts` | C04 | Retain supplied-interface sequencing only. |
| `test/change/change-cleanup-git.boundary.test.ts` | C14, C20, C22 | Retain real-Git preservation and exact-remote-head cases. |
| `test/change/change-implement-main-checkout-failure.test.ts` | C11, O03 | Retain the Trusted Executable failure sentinel and isolate it in the complete evidence schedule. |
| `test/change/change-implement-process.boundary.test.ts` | C11, O01 | Retain one canonical linked-checkout process launch and one piped-input sentinel, and move equivalent parser variations in-process. |
| `test/change/change-implement.boundary.test.ts` | C11, C27 | Retain exact binding and captured host classifications; move the shared file-not-found, non-regular-file, size, encoding, and empty-input taxonomy to `text-input.test.ts`, while retaining one command-local mapping for each distinct Implementer Prompt result code. |
| `test/change/change-inspection.boundary.test.ts` | C19, C28 | Retain durable inspection ordering, derived activity, and invalid-data mappings. |
| `test/change/change-reconcile-discard.boundary.test.ts` | C20, C23 | Retain exact terminal scoping and work-preservation differences with and without authority. |
| `test/change/change-reconcile-discard.cli.test.ts` | C23, C27 | Retain only missing exact Change ID and actionable retry output, as established by BY-130. |
| `test/change/change-reconciliation.test.ts` | C13, C16, C24 | Retain exact merged completion, stale publication rejection, taskless completion, and cleanup retry delegation. |
| `test/change/change-start-managed-worktree.boundary.test.ts` | C02, C05 | Retain approved-Task, dependency, branch, worktree, recovery, and preparation outcomes that require Git or SQLite. |
| `test/change/change-submit-orchestration.test.ts` | C07, C08, C12, C13, C24, C25 | Retain captured orchestration variations, but make it the explicit owner for policy failure before Validation and exact reuse equality. |
| `test/change/implementer-prompt-file.test.ts` | C11, C27 | Retain optional prompt-file input behavior. |
| `test/change/owned-pull-request-classifier.test.ts` | C13 | Retain all pure identity classifications. |
| `test/change/reviewer-session.test.ts` | C09 | Retain the pure fingerprint and session-reference owner. |
| `test/change/reviewer-transcript.test.ts` | C22 | Retain transcript discovery, indexing, idempotence, and invalid-file classifications. |
| `test/change/submit-progress.test.ts` | O01, O07 | Retain the documented stderr progress contract. |
| `test/change/terminal-cleanup.test.ts` | C20, C21, C22 | Retain cleanup composition, ordering, pending state, and retry delegation without duplicating lower-owner content or Git variations. |

### CLI and host-command tests

| File | Allocation | Disposition |
| --- | --- | --- |
| `test/cli/change-reconcile-result.test.ts` | C23, C27 | Retain pure result serialization. |
| `test/cli/change-submit-errors.test.ts` | C27 | Replace the two real-Git policy-error cases with exact pure result serialization and captured orchestration evidence, then retain remote mismatch, local head mismatch, bounded publication recovery, and policy-invalid result families at cheap seams. |
| `test/cli/cli-task-id.test.ts` | C27 | Retain command-selection Task ID parsing. |
| `test/cli/cli.test.ts` | C27, C29, C30, O01 | Retain native parsing, output, initialization, and current error mappings; remove the two durable tests for the retired `--output` and `-o` selectors. |
| `test/cli/contract-diagnostics-output.test.ts` | C27, O08 | Retain actionable diagnostic rendering. |
| `test/cli/recording-text.test.ts` | C01, C27 | Retain byte limits and input behavior not owned by the shared reader. |
| `test/cli/storage-error-mapping.test.ts` | C19, C27 | Retain one mapping for each distinct shared-state error class. |
| `test/cli/text-input.test.ts` | C01, C12, C27 | Retain the shared UTF-8 file and stdin reader owner. |
| `test/command/host-command.test.ts` | O01, O05 | Retain process-tree interruption and command-result behavior. |

### Configuration tests

| File | Allocation | Disposition |
| --- | --- | --- |
| `test/config/acceptance-review-config.test.ts` | C07 | Retain acceptance reviewer precedence and default resolution. |
| `test/config/candidate-validation-policy.test.ts` | C07 | Retain complete policy authority and missing-resource classification. |
| `test/config/config-contracts.test.ts` | O08, C30 | Retain current schema and diagnostics matrices; remove the named retired `validation.sandbox` case because unknown-field rejection already owns the current contract. |
| `test/config/specialist-review-config.test.ts` | C07 | Retain specialist precedence, disabling, and invalid-selection cases. |
| `test/config/submit-config.test.ts` | C07 | Retain Check normalization and duplicate-ID rejection. |
| `test/config/token-usage-contract.test.ts` | O07 | Retain canonical usage decoding and invalid-count classes. |

### Publication tests

| File | Allocation | Disposition |
| --- | --- | --- |
| `test/publication/github-pull-request-gateway.test.ts` | C13, C14, C27 | Retain captured command, response, redaction, and uncertain-mutation classifications. |
| `test/publication/github-target.test.ts` | C13, C27 | Retain supported remote forms, target selection, and malformed-target failures. |
| `test/publication/local-candidate-publication-git.test.ts` | C13, C27 | Retain commit-history title and tooling-failure behavior. |
| `test/publication/publication-policy.boundary.test.ts` | C08, C13, C14 | Retain current publication state-machine and exact reuse evidence at the publication seam. |

### Repository and operational tests

| File | Allocation | Disposition |
| --- | --- | --- |
| `test/repository/cli-loading.boundary.test.ts` | O01, O02 | Retain literal dynamic-target build inspection without repeating installed-package execution. |
| `test/repository/gitignore.test.ts` | C29 | Retain required local-state ignore behavior. |
| `test/repository/init-edge-cases.test.ts` | C29, C30 | Retain Git-root, common-directory, existing-state, and restored-state outcomes. |
| `test/repository/module-seams.test.ts` | O04 | Retain named architecture ownership checks. |
| `test/repository/node-sqlite-client.test.ts` | O05 | Retain the SQLite client Adapter contract required by all real-SQLite evidence. |
| `test/repository/package-contents.test.ts` | O02 | Retain the single installed-package process sentinel and package allow-list owner established by BY-135. |
| `test/repository/portable-but-why-skill.test.ts` | O02 | Retain model-visible portable workflow behavior without repeating package installation. |
| `test/repository/portable-implementer-session.test.ts` | C11, O02 | Retain exact Change and Managed Worktree preflight plus one portable launch sentinel. |
| `test/repository/process-isolation.boundary.test.ts` | O05 | Retain temporary-storage and process-isolation operation. |
| `test/repository/public-command-docs.test.ts` | O04 | Retain public command documentation synchronization. |
| `test/repository/quality-interface.boundary.test.ts` | O05 | Retain capacity-lock, interruption, descendant, and reentrancy contracts while those controls remain. |
| `test/repository/repository-storage.boundary.test.ts` | C01, C08, C12, C15, C16, C17, C19, C22, C24 | Retain only real-SQLite equality, atomicity, migration, malformed-data, and rollback evidence after BY-134. |
| `test/repository/shared-state.boundary.test.ts` | C19, C29, C30 | Retain repository identity and common-directory sharing evidence. |
| `test/repository/shared-state-snapshot.boundary.test.ts` | C18 | Retain immutable coherent snapshot evidence. |
| `test/repository/source-workflow-isolation.boundary.test.ts` | O03 | Retain until first-release executable selection replaces the Source Checkout Guard. |
| `test/repository/sqlite-execution-lock.test.ts` | O05 | Retain the execution-lock primitive required by concurrent SQLite evidence. |
| `test/repository/sqlite-json-string-array.test.ts` | C17, C19 | Retain strict structured-data persistence decoding. |
| `test/repository/test-workspace-lifecycle.test.ts` | O05 | Retain test-workspace acquisition, cleanup, and interruption behavior. |
| `test/repository/tooling-diagnostics.boundary.test.ts` | O04 | Retain actionable repository-authored structural diagnostics. |
| `test/repository/tooling-exclusions.boundary.test.ts` | O04 | Retain explicit tooling exclusions required by supported generated and fixture paths. |

### Task tests

| File | Allocation | Disposition |
| --- | --- | --- |
| `test/task/task-cli-process.boundary.test.ts` | O01, C01, C27 | Retain root/group/leaf loading, one shared recording-help representative, envelope, version, stdin, and invalid-encoding sentinels; remove the retired `--description-file` case. |
| `test/task/task-cli.test.ts` | C01, C27, C28 | Retain current Task command parsing, output, draft, comment, list, and actionable error mappings after BY-137. |
| `test/task/task-dependencies.test.ts` | C01 | Retain pure dependency graph and command mapping behavior. |
| `test/task/task-dependency-persistence.test.ts` | C01 | Retain real-SQLite unchanged-graph evidence. |
| `test/task/task-id.test.ts` | C01 | Retain Task identity parsing and formatting. |
| `test/task/task-lifecycle.test.ts` | C01 | Retain the current four-state vocabulary owner. |
| `test/task/task-persistence-policy.test.ts` | C01, C16 | Retain terminal policy and bounded list persistence behavior. |
| `test/task/task-state-help.test.ts` | C27, C28 | Retain current lifecycle help selection. |

### Validation tests

| File | Allocation | Disposition |
| --- | --- | --- |
| `test/validation/candidate-acceptance-review.boundary.test.ts` | C03, C06, C08, C09, C12 | Retain Acceptance and Specialist judgment, correction, session, and evidence-history branches at their owning seam. |
| `test/validation/candidate-validation.boundary.test.ts` | C04, C06, C07 | Retain exact workspace, preparation, Check, and Candidate-integrity sentinels. |
| `test/validation/candidate-validation-inspection.boundary.test.ts` | C08, C15, C28 | Retain Active Run, abandonment, history, and evidence inspection. |
| `test/validation/validation-artifact-files.test.ts` | C21 | Retain bounded Artifact Content storage. |
| `test/validation/validation-check-round.test.ts` | C06 | Retain Check continuation, timeout, Candidate integrity, and literal marker behavior. |
| `test/validation/validation-run-abandonment.test.ts` | C15 | Retain exact injected cleanup and cleanup-failure classifications. |
| `test/validation/validation-workspace-lifecycle.test.ts` | C06, C15 | Retain clean reuse, dirty replacement, identity rejection, partial acquisition, and interruption cleanup. |

## Contributor check allocation

| Check | Owner | Disposition |
| --- | --- | --- |
| `just typecheck` | O04 TypeScript contract | Retain in routine and complete quality. |
| `just lint` | O04 Biome lint contract | Retain as a contributor command; routine and complete quality execute the applicable lint contract through private `_biome-check`. |
| `just format-check` | O04 formatting contract | Retain as a contributor command; routine and complete quality execute the applicable format contract through private `_biome-check`. |
| `just docs-check` | O04 reader-visible link and anchor contract | Retain in routine and complete quality. |
| `just ast-grep-check` | O04 named structural syntax contracts | Retain in routine and complete quality. |
| `just fallow-check` | O04 dead-code and architecture contracts | Retain as a contributor command; routine and complete quality execute the blocking dead-code portion through private `_fallow-routine-check`, while coverage health remains advisory. |
| `just build` | O01 and O02 production buildability | Retain in routine and complete quality. |
| `just quality` | Maintained blocking aggregate | Retain as Change Submit Check. |
| `just full-quality` | Complete selected evidence aggregate | Retain as diagnostic and final migration gate. |
| `just coverage` | Advisory measurement | Keep outside blocking portfolio. |
| `just health` | Advisory health measurement | Keep outside blocking portfolio. |
| `just cli-loading-benchmark` | One-time performance investigation | Keep outside blocking portfolio. |
| `just pack` | O02 package production helper | Keep as a helper exercised by the package owner, not a separate gate. |

## Proposed migration sequence

The following list is complete for this portfolio revision.
No additional removal may be added during implementation without an approved Acceptance Context change.
An implementation escalation may retain evidence when its proposed replacement does not establish the same Claim.

1. Remove durable tests whose only purpose is to prove absence of retired `--output`, `-o`, `--description-file`, and `validation.sandbox` vocabulary.
2. Consolidate the four built-process shared recording-input help cases into one representative built-process case.
Add in-process generated-help assertions to `task-cli.test.ts` for Task create and comment and to `blocker-input.test.ts` for Blocker raise and resolve before removing their built-process variants.
3. Replace the two real-Git `change-submit-errors.test.ts` policy-error cases with a pure `submitResult` owner for exact `validation_policy_invalid` code, supplied message, path, diagnostics, and help.
Add a captured Submit-orchestration case that produces `MissingAgentProfile`, proves the exact constructed missing-profile message, and proves that no Validation Run starts.
Add a captured malformed-Global-Config case that proves path and diagnostics propagation without real Git.
4. Consolidate `change-implement-process.boundary.test.ts` and `change-implement.boundary.test.ts` so only process loading, canonical checkout selection, and piped input cross the OS process boundary.
Move the shared file-not-found, non-regular-file, size, encoding, and empty-input taxonomy to `text-input.test.ts`, and keep command-local result-code mappings in the Change Implement owner.
5. Remove the environment-skipped `herdr-smoke.test.ts` from maintained blocking evidence and document its environment-gated command as a manual diagnostic if the command remains supported.
6. Run every modified focused owner and commit the exact migrated evidence Candidate without manually duplicating a broad configured Check.
7. Against that exact committed Candidate, have the main operator run `just full-quality` as a non-blocking diagnostic and repeat the recorded locked and isolated unlocked three-workload protocol with one, two, and three workers without first changing suffix scheduling, the lock, or the worker limit.
8. Retain or change the capacity lock and worker limit only from that result, and record the decision and limitations in `VERIFICATION.md`.
9. After the measurement decision, replace generic `.boundary.test.ts` scheduling with an explicit complete-evidence file list when no measured setup or scheduling requirement still requires the category.
Rename affected files to capability names without changing their evidence ownership only when the category is removed.
10. Update `VERIFICATION.md` only with accepted recurring risks, non-obvious sentinels, and final controls that close a durable cross-work knowledge gap.
Do not copy the product-behavior Claim inventory into strategy when current contexts and this one-time migration already supply it.
11. Run a final search and allocation audit that reports zero unallocated retained test files, checks, retired-vocabulary tests, and unjustified generic boundary scheduling dependencies, then commit the evidence, scheduling, and strategy revision.
12. Have the main operator run `just full-quality` against that exact committed revision.
13. After the passing result is recorded, remove this allocation and `verification-portfolio-redesign.md`, then use Change Submit for the final plan-removal Candidate.

## Retained integration sentinels

- Real SQLite remains required for atomic writes, migration preservation, snapshots, malformed persisted data, and stored reuse equality.
- Real Git remains required for Candidate capture, Managed Worktree identity, ancestry, work preservation, and exact branch-head mutation.
- One real Check command remains required for fresh exact-Candidate Validation Workspace execution.
- One real reviewer process remains required for Reviewer Agent Runtime isolation.
- One installed-package process remains required for the portable CLI, bundled extensions, and portable skill layout.
- One portable Implementer process remains required for exact handoff preflight.
- One linked-worktree process remains required for the Source Checkout Guard while that temporary boundary exists.
- Focused command processes remain required for executable loading, piped stdin, output envelopes, and descendant interruption.
- Live GitHub and live Herdr repositories are not required for maintained blocking evidence.

## Final measurement protocol

Use three detached linked worktrees at the exact migrated revision.
Install dependencies from the shared locked pnpm store.
Measure one locked three-worker `just quality` baseline.
Measure unlocked one-, two-, and three-worker scenarios with distinct `TMPDIR`, `TEMP`, and `TMP` per workload.
Start three `just quality` workloads together for each scenario.
Record pass or failure, failing evidence, total wall-clock, per-workload wall-clock, and sampled process-tree resident memory.
Do not remove the lock unless one unlocked scenario passes every workload, improves total throughput, and does not materially increase individual workflow cost or create an intermittent failure.
If no scenario satisfies those conditions, retain the lock and the fastest valid single-workload worker limit with the measurement limitations recorded.
Remove the boundary filename category only after the measurement when no measured setup or scheduling requirement justifies retaining it.
If the category remains, record its exact operational owner and removal condition rather than treating its suffix as evidence ownership.

## Closure criteria

- Every retained test file and contributor check remains allocated by this artifact or an approved replacement map.
- Every retained test case has a documented distinct regression in its owning file allocation or is consolidated or removed.
A title alone does not establish distinctness.
- Every Claim has its named primary owner and sufficient required-seam evidence.
- Every named non-product contract has one owner and a current retention boundary.
- The complete approved migration list is executed without unapproved additional deletion.
- Focused owner evidence and `just full-quality` pass at the exact evidence, scheduling, and strategy revision.
- The final plan-removal Candidate passes the configured `just quality` gate through Change Submit.
- The final concurrency measurement has an authoritative lock and worker disposition.
- `VERIFICATION.md` records only the accepted durable strategy and controls.
- The Source Checkout Guard has an explicit temporary retention boundary.
- The manual Herdr diagnostic and advisory health, coverage, and benchmark operations are not blocking evidence.
- Both working plans are removed after the accepted strategy and implementation evidence make them obsolete.

## Proposed single migration Task Context

### Title

Complete the risk-driven verification portfolio migration.

### Description

Execute the complete operator-approved allocation in `plans/verification-portfolio-allocation.md`.
Give every retained product test and operational check one named owner at its cheapest reliable required seam.
Remove only the allocation's approved obsolete or duplicate evidence.
Close the migration by replacing generic boundary scheduling, running the final scheduling experiment, recording the accepted controls and strategy, and removing the obsolete working plans.

### Acceptance criteria

- All 13 approved migration actions are complete.
- Every retained test file and contributor check has one allocation to an approved Verification Claim or named non-product owner.
- No durable test exists only to preserve retired `--output`, `-o`, `--description-file`, or `validation.sandbox` vocabulary.
- `validation_policy_invalid` result serialization and pre-Validation rejection remain proven after the real-Git duplicate cases are removed.
- Real integration remains only for the retained SQLite, Git, Check, reviewer, package, Implementer, Source Checkout Guard, and command-process sentinels.
- Test scheduling no longer derives complete evidence from the `.boundary.test.ts` suffix, or the retained category has one recorded operational owner and removal condition.
- The final three-workload measurement determines and records the capacity-lock and worker-limit disposition.
- `VERIFICATION.md` records the accepted durable portfolio strategy and temporary controls.
- `plans/verification-portfolio-allocation.md` and `plans/verification-portfolio-redesign.md` are removed only after all closure criteria pass.

### Verification Contract

The affected Material Risks are all six recurring portfolio risks because incorrect evidence removal can permit false approved-intent, Candidate, external-target, durable-state, cleanup, or terminal claims.
The required Claim is that the exact migrated portfolio still establishes C01 through C30 through their required seams and that every retained operational check owns O01 through O08 as applicable.
Focused verification must run every modified primary owner before Submission.
The Implementer must not run `just quality`, `just full-quality`, or the concurrent workload experiment manually.
After the evidence migration is committed and focused evidence passes, the Implementer must raise an Implementation Blocker requesting the main operator to run `just full-quality` and the final measurement protocol against that exact committed Candidate.
The Blocker Resolution must record the observed result and the approved lock, worker, and boundary-category disposition.
The Implementer must then apply that disposition, update strategy, run focused evidence for the scheduling change and allocation audit, and commit the evidence, scheduling, and strategy revision.
The Implementer must raise a second Implementation Blocker requesting the main operator to run `just full-quality` against that exact committed revision.
After the second Resolution records a passing result, the Implementer must remove both working plans, commit the plan-removal Candidate, and use Change Submit for the configured `just quality` gate.
An allocation audit and targeted retired-vocabulary search must report no unallocated retained evidence or durable tests for retired concepts.
Stop and retain a proposed removal when its replacement does not establish the same result details and required seam.
Raise an additional Implementation Blocker if the approved allocation omits a current supported behavior, requires contradictory primary owners, or cannot produce a truthful final scheduling decision.
Do not add product behavior, change the Source Checkout Guard boundary, introduce live GitHub or Herdr dependencies, or remove a retained integration sentinel to make the migration pass.

### Dependencies

The proposed migration has no Task Dependency.
The operator-approved allocation is Acceptance Context for this one Task rather than a separate implementation Task.
