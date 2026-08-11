# Task verification

Accepted intent defines the required result.
Implementation creates that result.
Verification establishes justified confidence that the Candidate satisfies it, and review independently judges the exact Candidate using the evidence required for that judgment.
A test is one possible source of evidence, not the default output.
Task Context has no required verification section or template.

## Philosophy

Start from the actual work rather than a preferred verification mechanism.
Consider what could materially be wrong and what observation would distinguish the accepted result from that failure.
Choose evidence after understanding the implementation, the boundaries on which its behavior depends, retained evidence, and mandatory gates.

Prefer evidence that observes the relevant behavior directly, would reveal the meaningful failure, and has proportionate creation and maintenance cost.
A broader, slower, or more durable mechanism is not inherently stronger.
Evidence establishes only what it actually observes.

When work changes an integration, run a normal operation through the changed boundary using the exact Candidate.
Do not replace that boundary with a test double.
Tests of components, interruption, cleanup, or failure behavior do not prove that the normal operation works.
If no supported operation can establish this, report the integration behavior that remains unverified.
Treat missing, malformed, unavailable, or ambiguous observations as unknown rather than success.

Use this reasoning to guide judgment.
Do not require a verification plan, inventory, or standard output structure unless the Operator requests one or software must parse it.

## Implementation verification

Read the accepted intent and applicable repository verification policy.
Do not strengthen the product guarantee merely to make verification easier or more comprehensive.
An Implementer may use any supported evidence that establishes the relevant behavior reliably.
Use a broader system boundary only when the behavior being established depends on that boundary.
When several mechanisms are credible, prefer the reliable one with lower execution, diagnosis, coupling, and maintenance cost.

During implementation, use focused verification to determine whether the exact Candidate is ready for Submission.
Treat resulting observations as development feedback, not as an acceptance evidence package.
Complete mandatory gates through their owning workflow instead of duplicating them manually.
If an evidence mechanism fails, report the failed mechanism and remaining uncertainty.
Do not interpret inability to collect evidence as either success or a Candidate failure.

## Review verification

Before implementation, review whether the accepted outcome is observable and whether any prescribed verification constraint is feasible and capable of observing that outcome.
The absence of a prescribed mechanism is not itself a problem.

After implementation, the Acceptance Reviewer independently establishes the evidence required to judge the exact Candidate against accepted intent.
The reviewer inspects relevant maintained verification and uses current Check Artifacts to confirm its execution instead of repeating the same broad Checks.
When inspection and existing evidence are insufficient, the reviewer designs and performs a proportionate targeted experiment through the exact Candidate.
The reviewer judges whether the evidence could distinguish a materially incorrect Candidate from the accepted result, observes the boundaries on which that judgment depends, and corresponds to the exact Candidate and relevant environment.
Do not reject sufficient evidence merely because another mechanism is more familiar or broader.
Report only material confidence gaps and state what remains unsupported.
Distinguish insufficient evidence from a tooling failure that prevents a trustworthy review.

## Durable regression coverage

Do not require a test by default.
Add durable automation when it can repeatedly reveal a plausible meaningful regression that other retained or proportionate one-time evidence would miss, and when that protection justifies its authoring and maintenance cost.
A requirement, branch, scenario, fixture, assertion, or changed line does not create that need by itself.
Prefer updating, reusing, consolidating, or removing retained coverage when that gives sufficient confidence at lower cost.

For a reproduced defect, demonstrating that a regression test fails against the defective behavior can strengthen the evidence when the supported environment makes that practical.
Do not require historical execution, mutation, or sensitivity experiments by convention.
Do not create durable evidence whose only purpose is to prove exact documentation wording or the absence of a retired concept unless that fact is itself an executable supported contract.
