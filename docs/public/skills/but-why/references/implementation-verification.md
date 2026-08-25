# Implementation verification

The Change's current implementation direction defines the required result.
For a Change linked to a Task, that direction is its current Acceptance Context.
For a Change without a Task, it is the authorized outcome established in the current session or supplied through the Implementer Prompt.
Implementation creates that result.
Implementation verification establishes whether the exact Candidate is ready for Submission.
A test is one possible source of evidence, not the default output.

## Select implementation evidence

Start from the actual work rather than a preferred verification mechanism.
Consider what could materially be wrong and what observation would distinguish the accepted result from that failure.
Choose evidence after understanding the implementation, the boundaries on which its behavior depends, retained evidence, and mandatory gates.

Prefer evidence that observes the relevant behavior directly, would reveal the meaningful failure, and has proportionate creation and maintenance cost.
A broader, slower, or more durable mechanism is not inherently stronger.
Evidence establishes only what it actually observes.

When work changes an integration, run a normal operation through the changed boundary using the exact Candidate.
Do not replace that boundary with a test double.
Tests of components, interruption, cleanup, or failure behavior do not prove that the normal operation works.
If no supported operation can establish the integration, report the behavior that remains unverified.
Treat missing, malformed, unavailable, or ambiguous observations as unknown rather than success.

Read the current implementation direction and applicable repository verification policy.
Do not strengthen the product guarantee merely to make verification easier or more comprehensive.
Use a broader system boundary only when the behavior being established depends on that boundary.
When several mechanisms are credible, prefer the reliable one with lower execution, diagnosis, coupling, and maintenance cost.

During implementation, use focused verification to determine whether the exact Candidate is ready for Submission.
Treat resulting observations as development feedback, not as an acceptance evidence package.
Complete mandatory gates through their owning workflow instead of duplicating them manually.
If an evidence mechanism fails, report the failed mechanism and remaining uncertainty.
Do not interpret inability to collect evidence as either success or a Candidate failure.

## Durable regression coverage

Do not require a test by default.
Add durable automation when it can repeatedly reveal a plausible meaningful regression that other retained or proportionate one-time evidence would miss, and when that protection justifies its authoring and maintenance cost.
A requirement, branch, scenario, fixture, assertion, or changed line does not create that need by itself.
Prefer updating, reusing, consolidating, or removing retained coverage when that gives sufficient confidence at lower cost.

For a reproduced defect, demonstrating that a regression test fails against the defective behavior can strengthen the evidence when the supported environment makes that practical.
Do not require historical execution, mutation, or sensitivity experiments by convention.
Do not create durable evidence whose only purpose is to prove exact documentation wording or the absence of a retired concept unless that fact is itself an executable supported contract.
