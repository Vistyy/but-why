# Implementation Advisor Spike

## Hypothesis

Pi can host a bounded Implementation Advisor inside an Implementer's Interactive Session without changing repository state or owning continuation.

The advisor can use a separately configured model and thinking level, inspect through read-only tools, emit host-validated structured advice, process requests asynchronously, suppress duplicates, and avoid waking an idle parent.

The four proposed semantic rules are promising enough for a visible v1 advisory pilot if every positive fixture is detected, citations are grounded, and false positives remain at or below one of four controls.

## Baseline

The canonical Implementation Advisor definition is in `docs/context/change-delivery/CONTEXT.md`.

Existing Agent Profiles configure model and thinking in `docs/public/config.md`, `src/contracts/agentConfig.ts`, and `src/agent/agentProfiles.ts`.

The Implementer host passes profile model and thinking settings to Pi in `src/change/herdrInteractiveSessionHost.ts`.

The existing `continue-change` extension uses `agent_settled`, so it remains the liveness owner.

The installed project Pi package was version `0.82.1`.

The one explicitly selected spike model was `openai-codex/gpt-5.6-sol` with `low` thinking.

No advisor implementation existed before the spike.

## Experiment

A throwaway TypeScript prototype used real Pi `createAgentSession` and `ModelRuntime` instances.

Each semantic case used a separate nested advisor session and temporary fixture root.

The advisor could use only `read`, `grep`, `find`, and `ls`, plus a terminating `emit_advice` custom tool.

The custom tool used a TypeBox schema with an exact union of the four allowed rule IDs.

The host validated the schema and every citation against an existing fixture file and line.

The prototype captured real `turn_end` events containing the completed message and tool results.

A separate harness exercised serialization, queued work, duplicate suppression, one-note output, and session caps.

The model was not compared with another model.

All throwaway spike code and fixture data were removed.

## Commands

```sh
git fetch origin main
just
node --version
pnpm --version
SPIKE_ROOT="$TMPDIR/advisor-run3" timeout 900 node_modules/.bin/tsx "$TMPDIR/advisor-spike.ts" > "$TMPDIR/advisor-run3.out" 2> "$TMPDIR/advisor-run3.err"
git diff --check -- plans/implementation-advisor-spike.md
just docs-check
```

The SDK probe exited with status `0`.

Node reported `v24.18.0`.

pnpm reported `10.28.0`.

## Semantic fixture matrix

| Fixture | Expected | Actual | Result |
| --- | --- | --- | --- |
| Proportional verification evidence | `verification.proportional-evidence` | Expected rule with grounded citations | Pass |
| Retry after uncertain external mutation | `external-mutation.reconcile-before-retry` | Expected rule with grounded citations | Pass |
| Retained explicitly retired concept | `current-system.remove-retired-concept` | Expected rule with grounded citations | Pass |
| Explicit authority conflict | `authority.explicit-conflict` | Expected rule with grounded citations | Pass |
| Low-risk proportional verification | No incident | No incident | Pass |
| Reconciled external mutation | No incident | `verification.proportional-evidence` | False positive |
| Removed retired concept | No incident | No incident | Pass |
| Consistent authority | No incident | No incident | Pass |

The positive hit rate was `4/4`.

The unsupported-citation count was `0`.

The false-positive count was `1/4`.

The semantic threshold passed, but it consumed the full false-positive budget.

## False-positive analysis

The reconciled external-mutation control observed authoritative remote status before deciding whether to retry.

Its test asserted only that status was called, not the already-target-present branch or exactly-one-retry branch.

The model emitted `verification.proportional-evidence` because it judged the verification evidence weaker than the branching and retry risk.

The note was schema-valid and citation-grounded, but it was a semantic false positive under the control definition.

The model did not emit `external-mutation.reconcile-before-retry` for this control.

The external-mutation rule therefore does not need refinement based on this result.

The approved `verification.proportional-evidence` rule requires a concrete Material Risk tied to an actual verification claim, changed verification evidence, or approved Task Verification Contract.
Missing branch coverage alone is not sufficient for advice.

## Technical observations

Pi created a nested Agent Session with an explicitly selected model and thinking level.

The nested session exposed only the approved read-only tools and terminating structured-output tool.

The host rejected an invalid rule ID through schema validation.

The idle delivery probe inserted one custom advisor message into session state and caused zero additional agent starts.

The active delivery probe used `deliverAs:"nextTurn"`, emitted no custom message during the current turn, and delivered the message after the next prompt without an immediate additional start.

The retained evidence did not record whether `triggerTurn` was explicitly set in the idle call.

Actual Herdr TUI rendering was not exercised.

The scheduler harness enforced one active request, suppressed duplicate notes, emitted one note per evaluation, and applied the session cap.

The scheduler harness retained only the latest queued delta rather than preserving and jointly evaluating all later qualifying deltas.

The required all-deltas accumulation behavior therefore remains unverified.

## Conclusion

The tested Pi session, model selection, tool restriction, structured-output, event, and SDK-level delivery mechanisms are supported.

End-to-end Herdr rendering and the required accumulated-delta scheduler behavior remain inconclusive.

The four-rule semantic hypothesis is provisionally supported for the tested eight-fixture corpus.

No tested mechanism was refuted.

The evidence is sufficient to continue planning a visible v1 advisory pilot, but it does not establish production-level semantic precision.

## Limitations

The spike used one model and one thinking level.

The corpus contained only one positive fixture per rule and four controls.

The spike did not establish broader recall or precision.

Provider failure, malformed output, and extension exceptions were not injected.

Process-restart persistence was not tested.

Real Change lifecycle wiring was not tested end to end.

Actual Herdr TUI rendering was not tested end to end.

Production `turn_end` qualification was not tested through a final extension.

The scheduler harness did not test the approved accumulated-delta behavior.

## Plan impact

Implement the advisor as a project-specific Pi extension loaded only by the Implementer profile.

Create one persistent nested advisor session per parent Pi session and Change.

Use a separately selected Agent Profile for its model and thinking level.

Observe only qualifying completed `turn_end` deltas.

Allow only `read`, `grep`, `find`, and `ls` for repository exploration.

Use a terminating TypeBox custom tool with host validation for one structured note.

Use an asynchronous one-active-request queue that preserves every later qualifying delta while busy and evaluates the accumulated set together.

Apply duplicate suppression, one-note-per-evaluation, and session caps.

Insert idle advice into context without triggering a turn and deliver active advice on the next model turn.

Keep `continue-change` as the sole liveness owner.

Make model, parsing, evidence, and delivery failures fail-open.

Apply the approved narrower verification-rule threshold during the pilot.
Record verification-rule false positives before expanding the rule set or claiming mature precision.
