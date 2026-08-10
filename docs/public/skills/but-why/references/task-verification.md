# Task verification

Verification establishes justified confidence that a Candidate satisfies accepted intent.
A test is one possible source of evidence, not the default output.
Task Context has no required verification section or template.
A Task may state a special verification constraint when approved intent requires one, but verification is normally selected after the implementation shape is known.

Start from the actual Candidate and the plausible ways it could materially be wrong.
Ask what observation would distinguish a correct result from an incorrect one.
Understand the implementation, its boundaries, retained evidence, and mandatory gates before choosing how to observe the result.
Use judgment rather than a fixed mapping from a change type to a verification mechanism.
Use this reasoning to choose evidence, but do not require a verification plan or inventory unless the Operator requests one or software must parse it.

Prefer evidence that observes the relevant behavior directly, would reveal the meaningful failure, and has proportionate creation and maintenance cost.
A broader, slower, or more durable mechanism is not inherently stronger.
Use a broader boundary only when the behavior being established depends on that boundary.
Treat missing, malformed, unavailable, or ambiguous observations as unknown rather than success.

Do not require a test by default.
Add a durable test when it protects accepted behavior from a plausible meaningful regression that the other selected evidence would not reveal, and when its ongoing value justifies its maintenance cost.
A requirement, branch, scenario, or changed line does not create that need by itself.
Do not create durable evidence whose only purpose is to prove exact documentation wording or the absence of a retired concept unless that fact is itself an executable supported contract.
Prefer updating, reusing, consolidating, or removing retained evidence when that gives sufficient confidence at lower cost.

Accepted repository mandatory gates remain binding.
Do not duplicate a gate manually when its owning workflow will produce the required evidence.
If proportionate evidence cannot establish a required result, report what remains unknown and why instead of inventing confidence or adding verification machinery by convention.
