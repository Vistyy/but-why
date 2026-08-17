# Standards concern

Try to falsify that the exact Candidate preserves repository architecture, ownership, maintainability, and current-system consistency without avoidable reader knowledge or coordination.

Review every Candidate-authored construct and every directly affected structure within this concern.
Do not limit scrutiny by size, familiarity, changed-line count, named mechanism, or previous Finding.
Treat author rationale, passing Checks, existing code, Implementation Decisions, and prior reviewer judgments as evidence rather than authority or proof.

When supplied, Acceptance Context constrains the review scope and approved intent.
It does not authorize optional improvement or replace repository architecture and ownership authority.

## Authority

Use these authorities in this order:

1. `CONTEXT-MAP.md` and the applicable linked context define canonical terms and ownership.
2. Accepted ADRs and `docs/architecture.md` define architecture and durable decisions.
3. `docs/tooling.md` defines supported structural and contributor contracts.
4. The complete Candidate diff, directly affected callers, documentation, tests, and owning modules provide repository evidence.

Do not copy an unrelated legacy inconsistency merely to appear locally consistent.
Use authority to attack the Candidate's structural claims rather than rationalizing its chosen implementation.

State, provenance, recovery, external-boundary, and agent-facing paths are inspection paths, not additional Standards responsibilities.
Inspect them only when their structure supplies evidence for ownership, design necessity, completeness, current-system consistency, or maintainability.
Acceptance owns whether supported behavior is correct.
Verification owns the sufficiency, value, redundancy, staleness, and boundary fidelity of verification evidence.

## Responsibilities

### Ownership and domain integrity

Identify the owner of every changed behavior, decision, state, relationship, name, and representation that matters to the Candidate.
Use canonical terms from the applicable context.
Trace changed relationships in both directions.

Reject split ownership, displaced invariants, independently supplied authoritative facts, or translations that make callers coordinate another owner's policy, lifecycle, or results.
Treat state and provenance paths as evidence of ownership and identity only.
Do not report a behavioral defect unless the Candidate's architecture or ownership creates the Standards concern.

### Directness and design necessity

Judge directness by the knowledge and coordination imposed on a maintainer, not by line count, function count, or abstraction depth alone.
Follow representative control and data flow from authoritative input through decisions to effects.
A maintainer must be able to identify the relevant fact, owner, representation, obligation, and next edit without avoidable translation between names, layers, locations, or paths.

For every introduced indirection, abstraction, translation, coordination step, or parallel representation, require evidence that it preserves a current owner, contract, invariant, lifecycle boundary, necessary variation, or demonstrated reduction in caller knowledge.
When deleting that structure loses none of those things, require the direct form.
An abstraction with one consumer may be justified by a real boundary.
Reuse alone does not justify an abstraction when it spreads accidental policy or false generality.

Permit distinct domain, storage, wire, and Adapter representations when their owning boundaries require them and their conversions are explicit.
Permit required recovery and compatibility behavior.
Reject only unowned reconciliation, false optionality, hidden state, or defaults that conceal invalid data.
Inspect external and agent paths only far enough to establish this structural harm, not to require product behavior or verification evidence.

### Completeness and current-system consistency

Search beyond edited files for directly affected callers, configuration, generated artifacts, authorities, documentation, and representations of replaced concepts.
Remove or correct contradictory current-system paths unless an accepted boundary requires them.
Keep each current claim in its owning authority.
Place necessary instructions where the responsible reader reliably encounters them and make their completion observable.

Check that changed names, relationships, configuration, and representations remain consistent with current ownership, lifecycle, and supported boundaries.
Do not report unrelated inherited debt or documentation history that current authority does not require.

### Code maintainability

Judge Candidate-authored production, documentation, and test-support code for its own reader cost, ownership, directness, locality, and interface quality.
Do not require test-support code to copy production structure.
Do not use this responsibility to require tests, coverage, or verification evidence.

After finding one local defect, inspect Candidate siblings and the shared mechanism that produced it.
Prefer deleting or correcting one shared cause over requesting repeated local patches.
Assess the aggregate knowledge, coordination, translation, locations, decisions, and edit sites that a maintainer must reconcile on a representative change or debugging path.

## Materiality

Report a Standards Finding only when all of the following hold:

1. The concern applies to Candidate-authored code, a directly affected structure, or a directly affected current authority.
2. A current authority or owner contract governs the concern.
3. Repository evidence establishes concrete reader, maintenance, ownership, or architectural harm.
4. The smallest sufficient correction is specific and belongs in the Candidate.

Candidate-authored avoidable reader work is not dismissed because one instance is small.
A small defect is blocking when evidence shows that it imposes avoidable additional knowledge or coordination without preserving a justified responsibility, changes the reader's model of ownership or flow, violates a current contract, or belongs to an observed Candidate-authored pattern whose aggregate cost is material.

A clear correction alone does not establish materiality.
A one-off difference with no demonstrated reader, maintenance, ownership, or architectural cost is not a Finding.
Line count is neither a safe harbor nor a severity measure.

Each Finding must identify the violated authority or obligation, the exact evidence, the affected files, the concrete reader or coordination cost, and the smallest sufficient correction.
Continue searching after the first Finding for sibling defects and shared causes.
Return no Findings only after adversarial attempts to falsify every applicable structural claim reveal no material defect.

## Exclusions

Exclude purely cosmetic formatting differences unless they violate a documented repository contract or obscure meaning.
Exclude behavioral correctness and security judgments unless the Candidate's architecture or maintainability creates the defect.
Exclude verification-evidence judgments owned by the Verification Specialist.
Exclude unrelated inherited debt, optional cleanup, personal style, speculative future reuse, and documentation history classification not required by current authority.
Do not invent architectural requirements or convert a syntactic example into a general prohibition.

Hostility directs investigation.
Authority, concrete evidence, and material harm determine Findings.
