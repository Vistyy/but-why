---
status: provisional
artifact_kind: working-plan
remove_when: approved work is recorded in SQLite Tasks and every remaining open point is transferred or rejected
---

# Runtime boundary decoding

> Non-authoritative working plan.
> This plan records decisions while the Operator evaluates the work.

## Problem

Some structured runtime values enter trusted domain state through unchecked assertions, partial validation, or repeated local guards.
The corrective work must prevent malformed values from entering trusted state without replacing direct code with unnecessary schema machinery.

## Settled decisions

### Complex persisted JSON

Use Effect Schema when a persisted JSON record is complex enough that manual validation would duplicate its structure.
The schema defines the persisted representation, decoding occurs at the SQLite read boundary, and TypeScript obtains the decoded representation type from the schema.
Map the decoded representation into a domain record when the persisted representation and domain record differ.

Do not require Effect Schema for every persisted JSON value.
Simple representations such as a string array may retain a focused direct decoder when that is clearer.
Domain and lifecycle rules remain with their current owners rather than moving into Effect Schema.
External transports such as GitHub and Herdr are not governed by this persisted-JSON mechanism decision.
For the Candidate Validation Policy Snapshot, validate its complete object structure, required fields, primitive types, fixed choices, and positive integer timeouts.
Do not repeat Repo Config path-confinement, file-existence, non-empty Check list, or cross-entry validation because decoded stored Snapshots are used only for inspection and exact policy comparison, not to execute commands or copy resources.
The Snapshot schema permits an empty `checks` array even though current Repo Config admission requires at least one Check.

### Incremental planning

Cancelled Tasks BY-154, BY-155, and BY-156 are historical evidence only.
They do not establish accepted scope, completed behavior, or a Task graph to restore.
Plan and hand off one independently verifiable problem at a time, then continue assessing the remaining problems.
Do not combine the prior cancelled scopes merely because they concern TypeScript trust boundaries.

The first proposed Task removes duplicated Agent Profile identity from Change-owned review policies and Validation Policy Snapshots.
The strict Candidate Validation Policy Snapshot decoder follows against that simplified contract.
Each will use a Task-backed Change after its complete Task is recorded and separately approved and implementation is authorized.

### Boundary validation rule

Treat validation at runtime boundaries as a repository architecture rule.
A value whose type is not established at runtime must be decoded by its owning boundary before it enters trusted domain state or controls safety-sensitive behavior.
The decoder should enforce only the representation and stable invariants that the boundary must establish; it should not repeat unrelated upstream validation.

The always-loaded global agent instructions state this validation rule for coding work across repositories.
Current But Why architecture documentation assigns boundary ownership but does not explicitly state the validation rule.
The plan must decide how implemented behavior and contributor checks will make the rule reliable before current-system documentation presents it as supported architecture.

### Decoder ownership

Use one repository rule with separate boundary-owned decoders.
Do not create one global decoder module.
Each untrusted representation has one decoder used by every read path at that boundary.
SQLite owns persisted-data decoding, the Herdr Adapter owns Herdr response decoding, the GitHub Adapter owns GitHub response decoding, Reviewer Session code owns its JSONL decoding, and CLI integration should preserve concrete framework types instead of reconstructing them from erased values.
Share a decoder only when callers consume the same representation with the same compatibility and failure contract.

### Validation Policy Snapshot schema ownership

Change Delivery owns the Validation Policy Snapshot schema because the Snapshot is Change-owned validation evidence.
SQLite invokes that schema when it reads the stored JSON and maps a decoding failure to the persisted-data error contract.
The Change-owned schema contains no SQLite-specific parsing or error behavior.

### Snapshot compatibility

ADR 0009 retains immutable ordered forward migrations but no longer requires compatibility for an explicitly retired pre-release representation.
Do not add Validation Policy Snapshot versioning, broad unknown-field preservation, or historical shape decoders without a current supported representation that requires them.
Read-only inspection of the current Shared Repository State found 898 stored Snapshots, including 51 with retired `sandboxMode` data and 110 with `profileSource` instead of the current required `profileScope`.
The pre-current `sandboxMode` and `profileSource` Snapshot representations are retired.
The strict current decoder rejects them, leaves their stored rows untouched, and adds no migration, deletion, version, or compatibility decoder.
Inspection of an affected historical Validation Run returns `RepositoryPersistedDataInvalid`.

### Decoder Task design

Define one Change-owned Effect Schema for the Validation Policy Snapshot and derive the Snapshot type from it.
The existing SQLite decoder parses the stored JSON and invokes that schema directly.
The decoded Snapshot is the domain value because the stored and domain shapes are currently identical.
Do not add a generic decoding service, a second persistence model, a mapping layer, a new error system, public schema diagnostics, or Snapshot versioning.
Malformed syntax or a malformed understood field stops the SQLite read through the existing `RepositoryPersistedDataInvalid` path.
SQLite paths that use the stored policy only as opaque text for exact comparison remain unchanged because a malformed or different value fails closed and never enters trusted domain state.
The read does not return an empty or partial policy and public output does not expose the malformed stored payload.

## Current inventory

### Confirmed persisted JSON work

- Candidate Validation Policy Snapshot uses an unchecked JSON assertion.
- Validation Run Implementation Decisions use an unchecked JSON assertion.
- Acceptance Context Snapshot validation can silently omit malformed `resolutions`.
- Change preparation failure is a complex persisted record with a separate handwritten structural decoder.

### Separate problems to assess

- Effect CLI command values lose their concrete types and are reconstructed from `Record<string, unknown>`.
- Reviewer Session JSONL headers use unchecked parsed-object assertions in two readers.
- Herdr responses repeat partial record and field checks across response families.
- GitHub CLI and API responses mix validated parsing, partial casts, aliases, and safety classifications.
- The portable `continue-change` extension owns local validation for CLI snapshots and persisted extension state.
- SQLite scalar, nullable-field, lifecycle, ordering, and identity values rely on declared row types and local checks with inconsistent runtime validation.
- A focused structural prevention rule may be needed to reject direct parsed-JSON assertions into trusted production types.

### ADR 0009 compatibility audit

No broad current compatibility layer is attributable only to ADR 0009 outside the immutable migration chain and its upgrade evidence.
The permissive Candidate Validation Policy Snapshot assertion predates ADR 0009 and accidentally accepts old shapes rather than intentionally decoding them.
Acceptance Context Snapshots still retain the retired Task Comment `comments` field through their type, encoder, decoder, and migration evidence; that retention also came from the explicit Task Comment retirement decision and is not solely an ADR 0009 consequence.
This initiative will assess that retained field separately and will not add it to the Agent Profile identity simplification or Candidate Validation Policy Snapshot decoder Task.
Validation Workspace optional fields still serve interrupted-run recovery as well as older rows, so they are not established compatibility-only code.
The `restored_transient_state` error path gives actionable failure for lifecycle values rejected by migration `0023`; it is tied to migration replay but does not make retired states compatible.
Other retired representations are handled only inside immutable migrations or have already had runtime compatibility removed.

### No current general remediation

- Repo Config, Global Config, reviewer output, and token usage already use Effect Schema at their runtime boundaries.
- Reviewer output wire parsing returns `unknown` and passes it to the owned schema decoder.
- The focused SQLite string-array decoder validates its complete representation directly.
- `isTaskState`, filesystem error predicates, URL predicates, and other local boolean predicates are not problems merely because their names begin with `is`.
- JSON serialization normalization in `src/output/structuredValue.ts` is not an input trust-boundary decoder.

### Approved structural prevention

After the production violations are resolved, add a narrow ast-grep contract for `src/` that rejects asserting `JSON.parse(...)` directly to a trusted type.
Parsing into `unknown` remains supported, and reviewed legitimate production transformations can use explicit file exceptions.
The rule does not apply to tests, where controlled structured command output is commonly asserted for inspection.
The repository already uses ast-grep and file-level exceptions for comparable syntax ownership contracts, so this prevention requires no new check system.

Current non-`unknown` production matches are the Candidate Validation Policy Snapshot, persisted Implementation Decisions, two Reviewer Session JSONL readers, and the intentional Structured Value serialization transform.
The Structured Value transform is the current candidate for an explicit legitimate exception.
The other matches must be resolved or separately classified before the rule is enabled.

Persisted Implementation Decisions will be a separate Task.
Change Delivery will define the strict current `choice` and `rationale` representation, and SQLite will decode the stored array before it enters a Validation Run.
Malformed or retired `content` representations will return `RepositoryPersistedDataInvalid` without compatibility mapping, migration, or stored-row rewriting.
Raw exact identity comparisons for Validation Run reuse and publication remain unchanged.
A read-only audit found 898 stored snapshots: 406 use the current representation and 492 use the retired representation, with every retired Snapshot belonging to a Closed Change.

## Constraints

- Preserve every valid current persisted encoding.
- SQLite Adapters own persisted representation decoding.
- Domain modules remain independent of SQLite encoding.
- Do not create one universal codec registry.
- Do not ban legitimate local predicates or all uses of `JSON.parse`.

## Proposed Task 1

### Title

Represent review Agent Profile identity once

### Outcome

Acceptance Review and Specialist Review policies use their resolved Agent Profile as the sole Agent Profile identity.
New Validation Policy Snapshots and their inspection output do not repeat the same Agent Profile name and scope outside that resolved profile.

### Acceptance criteria

- Acceptance Review and Specialist Review policy records obtain Agent Profile name and scope only from their resolved Agent Profile.
- Newly produced Validation Policy Snapshots omit the duplicate outer `agentProfile` and `profileScope` fields for Acceptance Review and Specialist Review entries.
- Reviewer execution, Reviewer Session identity, progress reporting, validation, and publication continue to use the same resolved Agent Profile values and behavior.
- Validation Run inspection of a newly recorded current Snapshot presents each review policy without duplicate Agent Profile identity fields.
- Snapshot persistence, exact Validation Run reuse, and publication evidence comparisons use the simplified current representation without a fallback, compatibility alias, mapping layer, or historical policy rewrite.
- Snapshots written with the duplicate representation do not equal the simplified current policy and therefore cannot be reused or used as publication evidence for that current policy; a fresh Validation Run is required.

### Verification

#### Material risks

- Removing duplicate fields can accidentally change the resolved Agent Profile used for reviewer execution or Reviewer Session compatibility.
- A caller or inspection view can continue depending on the removed outer fields and preserve two current policy representations.
- Exact persisted Snapshot identity can incorrectly reuse or publish evidence created under the duplicate representation.

#### Required claims

- Acceptance Review and Specialist Review behavior uses the same resolved Agent Profile after the duplicate fields are removed.
- Newly produced Validation Policy Snapshots and their inspection views contain one Agent Profile identity per review policy.
- No reviewer execution, Reviewer Session, or progress path reads the removed outer fields; resolver output, Snapshot persistence, and inspection output use only the nested resolved Agent Profile.
- A Snapshot written with the duplicate representation is not eligible for exact reuse or publication as the simplified current policy.

#### Required evidence

- Maintained evidence must cover policy resolution and representative Acceptance Review and Specialist Review execution, Reviewer Session identity, and progress because the nested resolved profile controls those behaviors.
- Maintained SQLite Adapter evidence must cover persistence and exact reuse for a simplified current Snapshot and rejection of the duplicate representation as a match.
- Maintained publication evidence must establish that a Snapshot written with the duplicate representation does not satisfy simplified current policy identity.
- Maintained Validation Run inspection evidence must show the simplified shape for a newly recorded current Snapshot because inspection is the supported interface that exposes the Snapshot.
- Type checking and focused source inspection must establish that current review policy and Snapshot types, producers, and consumers no longer contain the duplicate outer fields.
- Applicable mandatory repository gates must pass.

#### Not required

- Runtime decoding, historical Snapshot decoding or rewriting, other Agent Profile records, or general CLI output redesign are not required.

## Proposed Task 2

### Title

Safely decode persisted Validation Policy Snapshots

### Outcome

Every Candidate Validation Policy Snapshot read from SQLite is decoded against its Change-owned runtime contract before it enters a Validation Run.
Malformed stored policy data stops at the SQLite boundary as `RepositoryPersistedDataInvalid` instead of entering trusted Change state.

### Acceptance criteria

- Change Delivery defines one Effect Schema for the complete Candidate Validation Policy Snapshot structure and its fixed choices, and the Snapshot type is derived from that schema.
- The schema validates required and optional nested policy fields without repeating unrelated Repo Config source validation.
- Every SQLite path that returns a decoded Validation Run policy invokes the owned schema rather than asserting the result of `JSON.parse`.
- Current policy values written by But Why decode without changing their stored encoding or decoded meaning.
- Unknown fields and pre-current field names are rejected so a different stored policy cannot satisfy exact Validation Policy Snapshot identity after decoding.
- Malformed JSON syntax, container shape, required fields, fixed choices, or nested understood fields returns `RepositoryPersistedDataInvalid` through the owning SQLite operation.
- A failed decode never returns an empty or partial Validation Policy Snapshot and never exposes the malformed stored payload through public diagnostics.
- The implementation adds no Snapshot version, generic decoder service, parallel persistence model, or SQLite behavior to Change Delivery.

### Verification

#### Material risks

- The schema can reject a valid current Snapshot and make supported Validation Run history unreadable.
- The schema can accept a malformed nested policy value and allow invalid evidence into trusted Change state.
- Removing or ignoring unknown fields can accidentally make a different stored policy reusable as current validation evidence.
- A schema failure can escape as an unrelated defect or storage error instead of the established persisted-data failure.

#### Required claims

- Every policy produced by the current writer decodes to the same Validation Policy Snapshot.
- A different exact stored policy remains ineligible for reuse or publication after decoding.
- Malformed syntax or any malformed understood part of the Snapshot is rejected before a Validation Run is returned.
- Rejected policy data is reported as `RepositoryPersistedDataInvalid` through the owning SQLite operation without a fabricated policy.

#### Required evidence

- Maintained evidence through the real SQLite Adapter must observe a current policy round trip and representative malformed top-level and nested values because the claim includes SQLite error mapping and durable stored-data integrity.
- Maintained reuse and publication evidence must show that an unknown field or pre-current field name cannot make a different stored policy eligible as current evidence because incorrect reuse could publish a Candidate under the wrong Validation Policy Snapshot.
- Type checking and focused source inspection must establish that the Snapshot type comes from the Change-owned schema and that the SQLite read path no longer asserts parsed policy JSON.
- Applicable mandatory repository gates must pass.

#### Escalation

- Escalate if a current supported Snapshot requires a second shape or meaning, because that would require an explicit version or mapping decision.
- Escalate if the persisted representation and Change-owned Snapshot require different shapes, because that would require an explicit mapping decision.

#### Not required

- Validation Run Implementation Decision decoding, other persisted JSON records, SQLite scalar or lifecycle validation, external transport decoding, a repository-wide parser framework, and Snapshot versioning are not required.

## Proposed Task 3

### Title

Validate Reviewer Session JSONL records before use

### Outcome

Reviewer Session preparation and Reviewer Transcript discovery inspect Pi session JSONL only after establishing that each consumed entry is an object record.
Syntactically valid JSON primitives, arrays, and `null` cannot enter record handling through a type assertion.

### Acceptance criteria

- Both production Reviewer Session JSONL readers parse untrusted lines without asserting a trusted record type.
- Reviewer Session preparation requires every non-empty parsed JSONL entry to be an object before reading or spreading its fields.
- Reviewer Session preparation reports syntactically invalid or non-object entries with the existing `Reviewer Session JSONL is corrupt.` failure and classifies the resumed Reviewer Session as `unusable`.
- A matching session header still requires the expected session ID and a string working directory before its working directory is rewritten.
- Unknown fields and non-header object entries are preserved because Pi owns the complete JSONL format.
- Reviewer Transcript discovery uses a session header ID only after establishing an object with `type: "session"` and a non-empty string ID.
- A missing, malformed, or non-object transcript header retains the existing filename-based session-ID fallback and existing unidentified-session result when neither source identifies the session.
- The implementation adds no complete Pi JSONL schema, format copy, or generic JSON decoder framework.

### Verification

#### Material risks

- Record validation can reject or modify valid Pi JSONL that But Why does not own.
- A non-object value can still reach property access or object spread and cause an unclassified runtime failure.
- Transcript discovery can lose its supported filename fallback and prevent Terminal Cleanup.

#### Required claims

- Reviewer Session preparation reads and rewrites only validated object records while preserving unknown object content.
- Invalid syntax and non-object entries produce the established corrupt-session message and `unusable` classification instead of an unchecked runtime failure.
- Reviewer Transcript discovery retains header identification and filename fallback behavior while never asserting parsed JSON as a record.

#### Required evidence

- Maintained Reviewer Agent Runtime evidence must cover a valid header rewrite, preserved unknown content, and a `null` entry producing the established corrupt-session message and `unusable` classification because incorrect rewriting can corrupt a resumable Reviewer Session or prevent safe replacement.
- Maintained Reviewer Transcript discovery evidence must cover valid header identification and filename fallback for a non-object or malformed header because failure can block Terminal Cleanup.
- Type checking and focused source inspection must establish that both production JSONL readers validate parsed values before property access or spread.
- Applicable mandatory repository gates must pass.

#### Not required

- Validation of every Pi JSONL entry variant, changes to Pi's format, persisted Validation Run decoding, or a general parser framework are not required.

## Proposed Task 4

### Title

Safely decode persisted Implementation Decision Snapshots

### Outcome

Every Implementation Decision Snapshot returned in a decoded Validation Run is decoded against its Change-owned current runtime contract before it enters trusted Change state.
Malformed or retired stored decisions stop at the SQLite boundary as `RepositoryPersistedDataInvalid`, while raw exact-identity reads remain intentionally opaque and fail closed.

### Acceptance criteria

- Change Delivery defines an Effect Schema for the complete current Implementation Decision structure and derives the Implementation Decision type from it.
- The Snapshot decoder requires an array of current `id`, `changeId`, `sequence`, `recordedAt`, `choice`, and `rationale` values with their current primitive types.
- Unknown fields and the retired `content` representation are rejected.
- Every SQLite path that returns a decoded `CandidateValidationRunRecord` decodes its Implementation Decision Snapshot with the Change-owned schema instead of asserting `JSON.parse` output.
- Current Snapshots round trip without changing their stored encoding or decoded meaning.
- Malformed syntax, container shape, entries, or understood fields returns `RepositoryPersistedDataInvalid` through the owning SQLite operation without exposing stored payload content.
- Raw exact Snapshot comparisons for Validation Run reuse and publication remain unchanged.
- Retired rows remain stored without compatibility mapping, migration, deletion, or rewriting.

### Verification

#### Material risks

- The schema can reject current evidence or accept malformed decision rationale into trusted Validation Run state.
- Decoding or normalization can change exact Implementation Decision identity and make stale evidence reusable for publication.
- A decode failure can escape as an unrelated defect instead of the established persisted-data failure.

#### Required claims

- Current Implementation Decision Snapshots decode to the same ordered records.
- Malformed or retired entries are rejected before a Validation Run is returned.
- Rejected data reports `RepositoryPersistedDataInvalid` without a fabricated Snapshot or stored payload disclosure.
- Raw exact reuse and publication identity remain unchanged.

#### Required evidence

- Maintained evidence through the real SQLite Adapter must cover a current ordered Snapshot round trip and representative malformed and retired entries because the claim includes persisted-data integrity and SQLite error mapping.
- Maintained CLI result evidence must establish that a payload-bearing persisted-data decode failure reports only the owning operation and does not expose the stored payload.
- Retained reuse and publication evidence, plus focused inspection of their raw comparisons, must establish unchanged exact identity behavior.
- Type checking and focused source inspection must establish that the Change-owned type comes from the schema and the SQLite read path no longer asserts parsed decision JSON.
- Applicable mandatory repository gates must pass.

#### Escalation

- Escalate if more than one Implementation Decision representation must remain currently readable, because that requires an explicit version or compatibility decision.

#### Not required

- Rewriting historical rows, decoding the normalized `implementation_decisions` table, changing Implementation Decision identity, or decoding other persisted JSON is not required.

## Proposed Task 5

### Title

Prevent trusted assertions from parsed production JSON

### Outcome

The repository's structural checks reject new production code that asserts `JSON.parse` output directly to a trusted type.
Production parsing must retain `unknown` until the owning boundary establishes the runtime shape.

### Acceptance criteria

- An ast-grep contract applies to TypeScript production code under `src/` and rejects direct `JSON.parse(...) as TrustedType` and `<TrustedType>JSON.parse(...)` assertions to object, array, domain, or inline structural types, including parenthesized forms represented by the same syntax tree.
- Direct assertions to `unknown` remain supported in either TypeScript assertion form.
- `src/output/structuredValue.ts` is the sole explicit production exception because its immediately preceding JSON serialization establishes exactly the `StructuredValue` representation.
- The diagnostic states why the assertion is prohibited and directs contributors to parse into `unknown` and use the owning boundary's focused decoder or schema.
- Structural rule examples establish representative prohibited `as` and angle-bracket assertions, supported unknown parsing, and the reviewed Structured Value exception.
- The owning contributor tooling documentation lists the new ast-grep contract and its supported replacement.
- Tests remain outside this structural contract.
- No new lint system, generic decoder framework, or blanket prohibition on `JSON.parse`, local predicates, or type assertions is added.

### Verification

#### Material risks

- The rule can miss common assertion forms and allow the defect class to recur.
- The rule can reject legitimate production parsing or test code and create suppression churn.
- A broad exception can conceal future unsafe assertions.

#### Required claims

- Representative direct trusted assertions in `src/` fail the structural check.
- Parsing into `unknown`, ordinary validated parsing, tests, and the one reviewed serialization transform remain supported.
- The exception is limited to the exact output-owned file and does not exempt another boundary.

#### Required evidence

- Maintained ast-grep rule examples must demonstrate representative valid and invalid `as`, angle-bracket, and parenthesized syntax because syntax detection is the supported behavior.
- Running `just ast-grep-check` must establish that current production source satisfies the contract, and the applicable documentation check must pass for the contributor guidance update.
- Focused source inspection must establish that the exception list contains only `src/output/structuredValue.ts` and that the diagnostic names the supported replacement.
- Applicable mandatory repository gates must pass.

#### Not required

- Semantic TypeScript analysis, test-code enforcement, banning all type assertions, or banning `JSON.parse` is not required.

## Proposed Task graph

1. `BY-158 - Represent review Agent Profile identity once` has no dependency and establishes the one-identity current Snapshot shape.
2. `BY-159 - Safely decode persisted Validation Policy Snapshots` depends on `BY-158` because its strict schema must encode that final current shape rather than the duplicate representation being retired.
3. `Validate Reviewer Session JSONL records before use` has no dependency because it owns a separate external file boundary.
4. `Safely decode persisted Implementation Decision Snapshots` has no dependency because the current Implementation Decision contract is already established independently of the Validation Policy Snapshot.
5. `Prevent trusted assertions from parsed production JSON` depends on `BY-159` and Tasks 3 and 4 because its structural check cannot pass until every unsafe production match is resolved; `BY-158` is already a transitive prerequisite through `BY-159`.

Each decoder Task delivers independently observable boundary behavior and error handling.
The final prevention Task adds only the approved repository structural contract after the production source has a coherent supported replacement at each affected boundary.

## Open points

- Whether the retained Acceptance Context `comments` representation still has a current supported purpose or should be removed in a later Task.
- Whether other persisted JSON and scalar boundaries require separately approved work after this prevention chain.
