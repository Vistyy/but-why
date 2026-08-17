# Post-baseline hardening plan

**Status:** Active investigation plan.
BY-275 completed the Agent Session design prerequisite for the direct BY-274 baseline.
This plan records concerns and decision work discovered during the first-release baseline cutover.
It is not implementation authority and is not a substitute for SQLite Tasks.

**Removal condition:** Remove this file after the first-release baseline is established and every retained concern has been converted into an approved Task or explicitly rejected.

## Purpose

BY-269 completed the Task and Change coordination direction, BY-271 completed the internal numeric identity and operational naming direction, and BY-275 completed the Agent Session design prerequisite.
BY-274 is the one remaining direct first-release baseline and operational cutover.
BY-274 does not import or convert old data, and it retains working internal code unless the final schema, retired representation removal, or supported behavior requires a change.
This plan owns the post-baseline hardening concerns that do not belong in that direct cutover, including Adapter relocation, SQL ownership enforcement, and general cleanup.
Creating durable follow-up Tasks against transient structures before the baseline would create avoidable rework.
This plan preserves the concerns until they can be reinspected against the final baseline.

This plan does not authorize implementation.
It does not extend the accepted scope of an active Change.
Current-Change corrections belong in that Change rather than in this plan.

## Reconciliation procedure

After BY-274 is accepted:

1. Inspect each concern against the resulting code, schema, and ownership boundaries.
2. Remove concerns that the cutover resolved or made obsolete.
3. Bound each retained concern by outcome, authoritative evidence, affected owner, and verification method.
4. Create separate Tasks when concerns have independent outcomes or can be accepted independently.
5. Record explicit rejection for concerns that do not justify work.
6. Remove this plan after all retained concerns have an authoritative disposition.

Observed rule counts and locations in this plan are investigation snapshots.
Rerun the applicable searches before using them as Task evidence.

## 1. Enforce source and SQL ownership after the baseline

### Concern

BY-269 and BY-271 exposed repeated uncertainty about whether Task-owned and Change-owned knowledge is confined to the owning modules.
Source placement helps human review, but it does not by itself prevent a later Adapter from reading or writing another owner's tables.

BY-274 retains working Adapter placement while it replaces the migration history.
Adapter relocation and SQL ownership enforcement therefore remain post-baseline decisions, and an ownership rule written before those decisions would encode transient paths and schema details.

### Investigation outcome

After BY-274, define the final owner zones for Task, Change, and any shared coordination capability.
Then test whether automated checks can reject SQL access outside those zones without requiring a general SQL analysis platform.

Migrations and explicitly shared infrastructure will need deliberate treatment because their authority differs from ordinary production adapters.
The checker must not infer ownership from a guessed file-name convention when the final architecture defines a different boundary.

### Candidate static checker

A bounded static checker could:

1. Find SQL issued by production TypeScript adapters.
2. Parse SQL with a maintained SQLite-capable parser such as `node-sql-parser`.
3. Extract the tables read or mutated by each statement.
4. Compare those tables with an explicit owner-zone policy.
5. Exempt migrations and other accepted privileged locations.
6. Fail closed when production SQL cannot be classified safely.

The expected custom part is a small repository-specific extraction and policy layer rather than a new SQL parser.
A spike should establish whether the parser supports the repository's actual SQLite statements before any implementation commitment.

A successful spike must demonstrate:

- correct classification of representative reads, writes, joins, common table expressions, and transactions;
- actionable diagnostics that identify the source location, table, and expected owner;
- explicit handling of interpolated or dynamically assembled SQL;
- no reliance on generated output or migration history as the ordinary adapter policy;
- a maintenance cost proportionate to the ownership failures it prevents.

### Candidate runtime checker

Node's SQLite binding exposes `DatabaseSync#setAuthorizer`, which can reject operations at SQLite execution time.
This approach can observe SQL that a static extractor cannot understand.
It only checks executed paths, and it would require a trustworthy way to associate each operation with its owner across shared connections and transactions.

The runtime approach should remain an alternative until a spike shows that owner context cannot leak across concurrent or nested operations.
It should not replace static architecture checks merely because it sees dynamic SQL.

### Decision needed

Choose the smallest mechanism that reliably protects the final ownership boundary.
Do not add both static and runtime enforcement unless each covers a demonstrated material gap that the other cannot cover.

## 2. Enforce structural TypeScript boundaries

### Concern

The completed BY-269 boundary revealed structural patterns that let one owner expose or coordinate more knowledge than a caller needs:

- broad completion ports that expose unrelated owner operations;
- composition by spreading broad ports into new objects;
- exported boundary inputs derived through positional types such as `Parameters<typeof operation>[3]`.

These patterns make authority hard to see and let unrelated signature changes propagate through public contracts.

### Candidate checks

Investigate syntax-aware rules that detect:

- an owner service accepted where one exact operation is sufficient;
- a returned or injected port assembled by spreading a broader owner port;
- `Parameters<typeof ...>[n]` in exported or domain-facing boundary contracts.

The preferred correction is a named owner operation or a named boundary input that states the accepted variants directly.
The rule should not prohibit local utility types or all uses of `Parameters` when they do not define an architectural boundary.

Do not create generic prohibitions for aliases, `null`, `undefined`, `Pick`, or nested calls.
Those forms are evidence only when a specific boundary gives them harmful meaning.

### Decision needed

Reinspect the final owner interfaces after BY-274.
Adopt only rules whose violation corresponds to a stable architectural fact and whose diagnostic can identify a concrete correction.

## 3. Improve boundary-changing Task authoring

When a Task changes an ownership boundary, investigate whether the accepted intent should state:

- the owner of each affected concept and relationship;
- the required operation chain;
- the transaction owner;
- the exact owner operations that another module may use;
- the behavior for absent, valid, and representable-invalid relationship states;
- the representations that must move or be removed;
- any temporary staging and its removal condition.

These facts should be included only when the required outcome or a material recovery path depends on them.
The authoring guidance must not turn every Task into a speculative architecture inventory.

## 4. Simplify persisted-value decoding

### Current evidence

A repository snapshot found decoding terminology in 58 production TypeScript files, including 34 files under `src/sqlite`.
It found 106 decode-named function declarations, including 71 in SQLite modules, but only 23 direct `Schema.decodeUnknown*` calls.
The dominant pattern is handwritten row, JSON, and relationship mapping rather than Effect Schema decoding.

The count does not establish that all handwritten decoding is wrong.
It indicates that trust-boundary knowledge may be duplicated and named inconsistently.

### Vocabulary to test

Use the following distinctions when inspecting the final baseline:

- **parse** converts text or wire syntax into an untrusted value;
- **decode** converts an untrusted or serialized value into a trusted owner value;
- **validate** checks an identity, relationship, or invariant not already guaranteed by the runtime boundary;
- **map** or **to** transforms an already typed value;
- **encode** converts a trusted value into storage or wire representation.

The repository should validate only facts that the runtime boundary does not guarantee.
For example, SQLite column types and foreign keys can make some corruption checks unnecessary, while JSON text and historical representations can still require decoding.

### Concrete consolidation candidates

#### Reviewer configuration

`changes.reviewer_configuration` parsing or decoding appears in:

- `src/sqlite/sqliteChangeReadModel.ts`;
- `src/sqlite/sqliteChangeStartPersistence.ts`;
- `src/sqlite/sqliteChangeSubmissionPersistence.ts`;
- `src/sqlite/sqliteChangeReviewerSessionPersistence.ts`.

At least one path directly casts parsed JSON.
Investigate one Change-owned persisted-value decoder and one encoding path rather than parallel local interpretations.

#### Agent Invocation projections

Agent Invocation projection decoding appears in:

- `src/sqlite/sqliteAgentSessionPersistence.ts`;
- `src/sqlite/sqliteTaskReviewPersistence.ts`;
- `src/sqlite/sqliteValidationEvidenceStorage.ts`.

Investigate whether Agent Session storage should own the common projection while Task Review and Validation Evidence add only their owner-specific links and policy fields.
Do not introduce a shared abstraction unless the final data model confirms a stable common value.

#### Naming

Rename trivial decode-named mappers opportunistically when their inputs are already trusted and they only reshape data.
Do not perform a repository-wide decode rename.
The useful outcome is concentrated trust-boundary ownership, not vocabulary churn.

### Decision needed

After the baseline, identify the small number of persisted or wire values that genuinely cross an untrusted boundary.
Assign each decoder to the owner of the trusted result and remove only demonstrated duplicate interpretations.

## 5. Evaluate anti-slop rules against repository evidence

### Source and tool constraints

The rule source was inspected from `dmmulroy/anti-slop` at commit `446268e5d15baa968eaec669ff65358d36ae6259`.
That snapshot identifies itself as version `0.1.0` and contains 15 Oxlint JavaScript plugin rules.
Its package uses Oxlint and `@oxlint/plugins` version `1.78.0`.

But Why currently uses Biome and ast-grep rather than Oxlint.
Biome cannot directly load an Oxlint JavaScript plugin.
The anti-slop project also describes vendoring and adaptation as an expected use, while Oxlint JavaScript plugins remain an alpha capability.

Simple syntax rules can usually be expressed as ast-grep rules or Biome GritQL checks.
Rules that depend on lexical scope, alias resolution, control flow, or neighboring comments require Oxlint or a custom TypeScript-aware analyzer to preserve their exact behavior.

The upstream snapshot lacks focused tests for some rules, including chained type assertions, shape names, and unknown parameters.
Before adopting a rule, add repository-owned examples for the behavior that But Why intends to enforce rather than relying only on the upstream implementation.

### Adoption criteria

For each rule, decide:

1. What repository failure does the rule prevent?
2. Does the rule detect that failure rather than merely a correlated syntax form?
3. Are current matches defects, deliberate boundary code, or both?
4. Is there a clearer replacement that does not move knowledge elsewhere?
5. Can the repository implement the intended semantics with its current tools?
6. Is the migration and ongoing exception cost proportionate to the evidence?

A zero-match rule can still be useful as a low-cost preventive check.
A high match count is not evidence that a rule is unsuitable, but it requires classification before global enforcement.

### 5.1 `no-chained-type-assertions`

**Upstream behavior:** The rule reports the outermost nested `as` or angle-bracket assertion, including assertions separated by parentheses.
It permits a chain only when every assertion is `const`.
It has no configuration options.

**Repository evidence:** A snapshot found five chains, including production uses in `src/sqlite/nodeSqliteClient.ts` and `src/cliCommandTree.ts` and partial Pi host mocks in tests.
The production cases appear to bridge library typing or generic adapter gaps rather than decode untrusted data.

**Interpretation:** Chained assertions erase two layers of evidence and make the actual unsupported step difficult to identify.
The correct replacement may be a typed adapter operation, a generic that carries the real type, a typed test factory, or a validated value followed by one localized assertion.

**Tool fit:** The basic nested-assertion pattern is portable to ast-grep or GritQL.
Exact handling of the outermost chain and all-`const` exception is easier in Oxlint.

**Candidate disposition:** Consider a narrow preventive rule after the production cases are understood and corrected.
Do not require safety comments as a substitute for removing an unnecessary chain.

### 5.2 `no-conditional-empty-object-spread`

**Upstream behavior:** The rule reports an object spread whose argument is a conditional expression with an empty object literal on either branch.
It recommends separate statements that add the property only when present.
It has no configuration options.

**Repository evidence:** A broad snapshot found approximately 347 uses across production, tests, and scripts.
Representative production uses construct exact-optional output values, option objects, and domain results in modules such as `src/agent/reviewerAgentRuntime.ts`, `src/cliResults.ts`, and `src/repositoryRuntime/repositoryContext.ts`.

**Interpretation:** The pattern can hide object-shape changes inside an expression and can become difficult to scan when repeated.
Its prevalence does not prove that it is acceptable, but explicit mutation is not automatically clearer or safer.
The alternatives include explicit branches, named constructors, or a builder owned by the resulting contract.

**Tool fit:** The syntax is directly portable to ast-grep or GritQL.

**Candidate disposition:** Run a focused migration study by use class before deciding on global enforcement.
Adopt only if the preferred replacements improve clarity without introducing generic builders or mutable assembly everywhere.

### 5.3 `no-known-value-widening`

**Upstream behavior:** The rule tracks syntactically known literals, arrays, objects, functions, classes, `new` expressions, and stable `const` aliases.
It reports flows into `unknown`, `object`, inline nonempty object types, and dictionary types across declarations, assignments, fields, returns, and assertions.
It allows an empty object used as a dictionary accumulator.

The implementation resolves only limited aliases, treats every `Record` as dictionary-like, and can flag explicit anonymous return contracts.
It has no configuration options.

**Repository evidence:** A snapshot found 30 matches, including 26 in production.
Hotspots include `src/agent/adapters/piReviewerProcessExecutor.ts`, `src/submissionEnvironment/adapters/localGitHubPullRequestGateway.ts`, `src/change/implementationDecision.ts`, and `src/cli/task/commands/cancel.ts`.
Several matches appear to be intentional explicit return contracts or finite-key maps rather than accidental evidence loss.

**Interpretation:** Widening a known value can discard useful compiler evidence, but an explicit owner contract can intentionally hide representation details.
Useful replacements include inference, `satisfies`, or a named owner contract.

**Tool fit:** Exact alias and flow tracking favors Oxlint or a custom TypeScript-aware check.
A narrow syntactic subset could be ported, but it would enforce a different rule.

**Candidate disposition:** Do not adopt the upstream rule unchanged.
Any repository variant should distinguish explicit boundary contracts and finite-key records from open dictionaries.

### 5.4 `no-module-mocking`

**Upstream behavior:** The rule reports `mock`, `doMock`, and `unstable_mockModule` calls on recognized Vitest `vi` and Jest `jest` objects.
It recognizes imported and global test objects, dot and computed properties, and uses scope resolution to avoid shadowed names.

**Repository evidence:** The snapshot found no `vi.mock` or `jest.mock` use.
The repository already prefers explicit Effect services, Layers, and injected adapters.

**Interpretation:** Module mocking bypasses the project's designed seams and can make ownership and lifecycle behavior implicit.
A zero-match rule would protect an established testing constraint at low migration cost.

**Tool fit:** Direct call forms are easy to prohibit with ast-grep.
Exact imported, global, computed, and shadowing semantics favor Oxlint.

**Candidate disposition:** This is a strong preventive candidate.
Prefer a small repository rule for the call forms the repository could realistically introduce unless exact scope behavior justifies adopting Oxlint.

### 5.5 `no-object-parameters`

**Upstream behavior:** The rule reports parameters typed as `object` across function, method, signature, constructor, rest, default, property, union, and top-level alias forms.
It avoids lexical generic shadowing and permits generic constraints such as `T extends object`.

**Repository evidence:** The snapshot found no matches.

**Interpretation:** A parameter typed only as `object` gives the callee no usable contract.
A named shape or `unknown` followed by a boundary decoder usually preserves more evidence.

**Tool fit:** Direct annotations are easy to detect with current syntax tools.
Alias and shadowing fidelity favors Oxlint.

**Candidate disposition:** This is an optional low-cost preventive rule, but there is no demonstrated repository failure requiring it.

### 5.6 `no-reflect-apply`

**Upstream behavior:** The rule reports global `Reflect.apply` through dot or computed access and ignores a lexically shadowed `Reflect`.

**Repository evidence:** The snapshot found no matches.

**Interpretation:** `Reflect.apply` can bypass typed call signatures and receiver contracts.
A direct typed call or a named dynamic-dispatch interface is normally clearer.

**Tool fit:** The direct global pattern is easy to prohibit with ast-grep.
Exact shadowing behavior favors Oxlint.

**Candidate disposition:** This is a strong zero-migration preventive candidate that can probably be implemented with a simple repository rule.

### 5.7 `no-reflect-get`

**Upstream behavior:** The rule reports global `Reflect.get` through dot or computed access and ignores a lexically shadowed `Reflect`.

**Repository evidence:** The snapshot found 11 matches, including `scripts/run-health-report.mjs`, `extensions/continue-change.ts`, and quality or tooling tests.
The uses generally inspect values at untyped extension, script, or test boundaries.

**Interpretation:** Dynamic property access can be necessary before a boundary value is decoded, but `Reflect.get` can let untyped access spread beyond that boundary.
Possible replacements include a strict decoder, a validated record followed by indexed access, or a typed environment interface.

**Tool fit:** Direct syntax is easy to prohibit with ast-grep.
Exact shadowing behavior favors Oxlint.

**Candidate disposition:** Inspect and replace the production extension and script uses before deciding.
Do not exempt all tests automatically if typed fixtures would provide a simpler contract.

### 5.8 `no-runtime-typeof`

**Upstream behavior:** The rule reports every unary `typeof` expression.
Its `allowInTypeGuards` option permits `typeof` inside the nearest function when that function has a TypeScript type-predicate return type.
The option defaults to false.

**Repository evidence:** An exact-plugin snapshot found approximately 76 uses.
Representative uses occur in JSONL and transcript parsing, reviewer process events, SQLite persisted-value decoding, configuration decoding, and error guards.

**Interpretation:** Many uses are legitimate first checks at untrusted boundaries.
Their distribution may nevertheless show that decoding knowledge is spread across callers rather than concentrated in named boundary decoders.
Effect Schema, named type guards, or owner-owned decoders are possible replacements.

**Tool fit:** A blanket syntax ban is easy with current tools.
Recognizing the containing type guard reliably is easier with Oxlint or a TypeScript-aware custom check.

**Candidate disposition:** Do not enable this rule before the decoding consolidation investigation.
If adopted later, prefer a policy that permits named type guards and keeps runtime inspection at explicit trust boundaries.

### 5.9 `no-shape-in-symbol-names`

**Upstream behavior:** The rule reports every identifier, private identifier, or JSX identifier whose case-insensitive text contains the substring `shape`.
It has no semantic or contextual exceptions.

**Repository evidence:** Meaningful current uses include expected-shape diagnostics in `src/contracts/contractDiagnostics.ts`, public Task ID shape language in `src/task/taskId.ts`, and an Effect diagnostic fixture.

**Interpretation:** In these contexts, `shape` communicates an actual representation or diagnostic distinction.
The substring rule is a vocabulary preference rather than a reliable detector of lost type evidence.

**Tool fit:** The rule is easy to port.

**Candidate disposition:** Reject this rule.
Do not rename truthful domain or diagnostic terms merely to avoid a substring.

### 5.10 `no-unknown-parameters`

**Upstream behavior:** The rule reports parameters annotated exactly as `unknown`, including rest, default, and parameter-property forms.
It permits only a parameter literally named `cause`.
It does not resolve aliases or unions and has no configuration options.

**Repository evidence:** A snapshot found 69 matches, including 55 in production.
They are concentrated in parsers, persisted-value decoders, error guards, and configuration boundaries such as `src/agent/piJsonl.ts`, `src/sqlite/sqliteChangeValueDecoders.ts`, and `src/contracts/*Config.ts`.

**Interpretation:** `unknown` is the correct input type when a boundary has not established a stronger contract.
Renaming an `error` parameter to `cause` would evade the rule without improving safety.
The defect to prevent is allowing an unknown value to escape decoding, not receiving it at the first trust boundary.

**Tool fit:** The exact annotation is easy to detect with current syntax tools.

**Candidate disposition:** Reject global adoption.
Use local review or a boundary-specific rule only where a stronger enforced input contract already exists.

### 5.11 `no-unknown-returns`

**Upstream behavior:** The rule reports explicit `unknown`, unions containing `unknown`, `Promise` or `PromiseLike` of `unknown`, and limited top-level aliases.
It accounts for lexical generic shadowing.

**Repository evidence:** A snapshot found 11 matches, including nine in production.
Several are valid raw boundaries in reviewer wire decoding, GitHub response parsing, and historical migration handling.
Some callback returns in host interruption or best-effort output handling may be more accurately typed as `void`.

**Interpretation:** Returning `unknown` is appropriate when the function's purpose is to expose an undecoded boundary value to the owner that will decode it.
It is unnecessary when a callback result is intentionally ignored or when the function already knows a stronger contract.

**Tool fit:** Direct return annotations are portable.
Alias and generic fidelity favors Oxlint.

**Candidate disposition:** Do not adopt globally.
Correct the callback subset independently and retain `unknown` where it accurately marks a raw boundary.

### 5.12 `no-unknown-type-aliases`

**Upstream behavior:** The rule reports a top-level type alias that resolves recursively through unparameterized aliases to `unknown`.

**Repository evidence:** The snapshot found no matches.

**Interpretation:** An alias that only renames `unknown` usually adds vocabulary without adding a contract.
However, the repository has no current evidence that this causes confusion.

**Tool fit:** A direct alias is easy to detect.
Recursive alias-chain behavior favors Oxlint.

**Candidate disposition:** Defer or adopt only as an inexpensive preventive rule if the tool choice makes it nearly free.

### 5.13 `no-unsafe-dictionary-type`

**Upstream behavior:** The rule reports dictionary value types of `unknown`, `any`, `object`, empty `{}`, and unions or aliases that resolve to those forms.
It handles `Record`, index signatures, mapped types, generic substitutions, and wrappers such as `Readonly`, `Partial`, `Required`, `NonNullable`, `Pick`, and `Omit`.
It permits nested unknown values such as `{ payload: unknown }` and does not target `Map`.

**Repository evidence:** A snapshot found 22 matches, including ten in production.
Examples occur in Pi JSONL parsing, process-event parsing, SQLite migration or persisted JSON representations, and contract diagnostics.
The repository already enables `noUncheckedIndexedAccess`.

**Interpretation:** `Record<string, unknown>` is often the honest representation immediately after establishing that an untrusted value is an object.
It becomes harmful when that raw dictionary is treated as an owned domain value or escapes the decoder.

**Tool fit:** A direct `Record<string, unknown>` check is portable.
The upstream rule's recursive alias, mapped-type, and wrapper semantics favor Oxlint.

**Candidate disposition:** Reject the global upstream rule.
Investigate a narrower rule that prevents raw dictionaries from escaping boundary modules if concrete escapes are found.

### 5.14 `no-widen-then-assert`

**Upstream behavior:** The rule tracks immutable `const` values with known evidence that are widened to `any`, `unknown`, `object`, or a broad record and later asserted to a narrower type in the same function or module.
It does not fully track mutable variables, properties, calls, imported values, function aliases, or named object types.

**Repository evidence:** The snapshot found no matches.
The upstream test coverage for this rule is limited.

**Interpretation:** Widening and then asserting narrower can erase evidence and recreate it without validation.
The rule is conceptually sound, but its current implementation observes only a subset of possible flows.

**Tool fit:** The flow and reference tracking requires Oxlint or another TypeScript-aware analyzer.

**Candidate disposition:** Defer until repository evidence justifies the analyzer and the intended flow boundary is specified more precisely.

### 5.15 `require-safety-comment-for-type-assertion`

**Upstream behavior:** The rule requires a preceding comment containing `SAFETY:` for every `as` or angle-bracket assertion except `as const`.
It also inspects enclosing nodes for comments.
It checks only for the marker, not the truth, precision, or adjacency of the explanation, and assertion chains can receive duplicate reports.

**Repository evidence:** A snapshot found 181 assertions, including 94 in production.
Hotspots include SQLite and wire decoders, `nodeSqliteClient`, `cliCommandTree` generic bridges, tests, and structured-value serialization.

**Interpretation:** A comment can preserve an invariant that TypeScript cannot express, but mandatory marker comments can legitimize assertions without removing them.
The first correction should be inference, a typed adapter, an Effect Schema decoder, or a more accurate contract.
A retained narrowing assertion should explain the specific external guarantee that makes it safe.

**Tool fit:** Reliable comment ownership is not a good fit for a simple ast-grep or GritQL pattern.
It favors Oxlint or a token-aware custom check.

**Candidate disposition:** Do not enable globally.
Consider a scoped policy only after deciding how to treat `as unknown`, test doubles, serialization boundaries, and assertions required by external library typing gaps.

### Rule groups under investigation

The following grouping is an investigation aid rather than an adoption decision.

**Strong preventive candidates with little or no current migration:**

- `no-module-mocking`;
- `no-reflect-apply`;
- possibly `no-object-parameters`.

**Candidates that need focused repository migration evidence:**

- `no-chained-type-assertions`;
- `no-conditional-empty-object-spread`;
- `no-reflect-get`.

**Candidates that need a narrower repository-specific meaning:**

- `no-known-value-widening`;
- `no-runtime-typeof`;
- `no-unknown-returns`;
- `no-unsafe-dictionary-type`;
- `require-safety-comment-for-type-assertion`.

**Candidates to reject or defer without new evidence:**

- reject `no-shape-in-symbol-names`;
- reject global `no-unknown-parameters`;
- defer `no-unknown-type-aliases`;
- defer `no-widen-then-assert`.

## 6. Explicitly deferred or rejected generalizations

Do not create work solely for:

- a generic type-alias cleanup;
- a generic loader abstraction;
- N+1 query removal without measurement;
- missing linked-Change corruption handling when the final schema enforces the relationship with a foreign key;
- a repository-wide decode rename;
- a blanket prohibition on `unknown`, `typeof`, assertions, `null`, or `undefined` without a trust-boundary policy;
- durable absence checks whose only purpose is to prove that retired concepts are gone.

A later Task may include one of these forms only when authoritative evidence connects it to a required outcome.

## Possible post-baseline Task boundaries

These are candidate boundaries for later authoring, not Tasks and not implementation authorization:

1. Enforce final Task and Change source and SQL ownership contracts.
2. Enforce narrow TypeScript owner-operation boundaries.
3. Concentrate persisted and wire decoding in the owner of each trusted result.
4. Calibrate complete-Candidate review against adjudicated Candidate history.
5. Adopt approved low-migration anti-slop preventive rules.
6. Migrate and enforce one approved high-match rule family after a focused study.

Keep these separate when they have independent outcomes or acceptance decisions.
Combine them only when the final architecture creates a real dependency that requires one coordinated change.
