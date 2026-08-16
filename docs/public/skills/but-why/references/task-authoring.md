# Task authoring

Use this guidance to compose or revise proposed Tasks before recording them.
A Task is the durable record of one requested outcome, its approved intent, dependencies, and user-facing progress.
Task authoring must preserve the complete approved outcome while dividing the work into coherent supported results.

## Preserve the approved outcome

Start from the Operator-approved outcome and its applicable authority.
Do not infer approval from brainstorming, provisional plans, examples, or implementation preferences.
Ask the Operator when unresolved intent could change observable behavior, Task boundaries, or the complete result.

Ensure that the complete proposed Task set covers the approved outcome without omitting or weakening any required behavior.
Do not reduce the outcome to the subset that is easiest to implement, observe, or verify.
When required behavior is difficult to verify, identify the missing observation or unresolved assumption instead of removing that behavior.
Verifiability constrains the evidence used to judge a result; it does not redefine the approved result.

A plan can propose Tasks and implementation mechanisms, but it does not prove that the proposed Tasks cover the approved outcome or that a mechanism exists.
Use repository evidence and applicable authority to establish consequential premises.
Do not require a requirement allocation matrix, complete graph, or standard planning format when the proposed Tasks otherwise communicate complete coverage clearly.

## Resolve consequential uncertainty

Inspect the current repository and supported tools before retaining a consequential technical assumption.
When inspection cannot resolve a feasibility, integration, or performance hypothesis that could materially change a Task boundary or readiness, recommend a bounded spike.
State the decision-driving falsifiable hypothesis and the smallest real-system experiment that could support or refute it.
State which result would support, refute, or leave the hypothesis unresolved.
Do not use a spike when repository evidence already resolves the question or when the result cannot affect the decision.
Do not treat plans, intuition, test doubles, or unverified external claims as confirmation of real-system behavior.

A spike supplies evidence for authoring decisions; it does not silently replace approved implementation work.
Obtain the applicable approval before an experiment mutates repository or external state, introduces material risk, or incurs material cost.
Remove experiment-owned state afterward unless production implementation is separately authorized.

## Compose individual Tasks

Choose the smallest coherent vertical Tasks that each leave the repository safe and supported.
Each Task must be independently understandable, implementable, assessable, and verifiable by one agent while preserving the complete approved outcome across the Task set.
A Task need not deliver standalone end-user value when it is independently acceptable progress toward the approved outcome.

Split separable behavior when narrower results remain supported and the combined work would require materially independent implementation, failure-handling, or verification reasoning.
Signals for inspection include separate observable behaviors, external integrations, lifecycle or recovery rules, durable state changes, or materially different verification environments.
These signals do not require a split by themselves.
Do not combine separable behavior only because it contributes to one product outcome or appears together in a plan.

Keep work together when a narrower result would leave the repository unsafe or unsupported, require temporary duplicated interfaces without independently verifiable behavior, or fail to produce an independently acceptable result.
Do not split or combine work based only on files, modules, layers, test categories, implementation steps, line count, estimated effort, difficulty, or the number of affected areas.
A large mechanical change can remain one Task when its reasoning stays coherent.
A smaller change can require splitting when it contains materially independent supported results.

## Define Task Dependencies

Add a Task Dependency only when the dependent Task cannot be implemented or verified until the prerequisite Task is Done.
Confirm that the prerequisite outcome actually supplies the required capability through a supported path.
The existence of implementation ingredients or a proposed procedure does not by itself establish a supported operation that supplies the required capability.
Related work, shared files, likely conflicts, priority, preferred sequence, and relative importance do not establish a Task Dependency.

## Handle migrations

Use expand-contract only when evidence shows that old and new forms must coexist while supported callers move.
Expand introduces the new form while the old form remains supported, migration moves callers while both remain supported, and contract removes the old form after no supported caller requires it.
The phases do not require separate Tasks.
Choose Task boundaries only when a phase or caller population leaves an independently acceptable supported result.
When coexistence is unnecessary, complete the replacement as one result instead of introducing migration stages.

## Describe each Task

Describe the requested outcome and consequential constraints clearly enough that implementation does not need to invent product intent.
Before recording a proposed requirement, trace its normal path and material failure or recovery consequences.
Surface requirements that would introduce open-ended parsing, classification, compatibility, recovery, or exceptional-case behavior beyond the approved outcome, and ask the Operator to bound or remove them.
Do not silently weaken approved intent or remove necessary safety and reliability.

Make the outcome observable enough to distinguish a materially incorrect implementation.
Do not prescribe tests, a verification inventory, an implementation plan, or an exact file forecast by default.
State a special verification constraint only when it is already part of approved intent.
Otherwise, leave proportionate verification-mechanism selection to implementation and review.

Task authoring is sufficient when the proposed Task set preserves the complete approved outcome, each Task communicates one coherent supported result, consequential technical assumptions are established or explicitly unresolved, and every proposed dependency is a real prerequisite.
