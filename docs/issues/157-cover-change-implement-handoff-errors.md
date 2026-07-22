# Cover Change Implement handoff errors

## Status

Done.

## Specification

- [Taskless Changes and worktree handoff](../specs/taskless-changes-and-worktree-handoff.md)
- [Launch a Task implementer in Herdr](130-launch-task-implementer-in-herdr.md)

## Behaviors owned

- Change Implement maps every invalid handoff file to its existing structured CLI usage error.
- Invalid handoff input prevents Interactive Session launch and preserves Change state.
- A valid handoff remains unchanged when Change Implement supplies it to the Interactive Session Host.

## What was built

Change Implement now has public CLI coverage for every handoff-file rejection.
The existing error codes, paths, messages, details, and help remain unchanged.

## Primary verification seam

Change Implement CLI JSON results demonstrate every handoff-file rejection and confirm that the Interactive Session Host does not launch.

## Acceptance criteria

- [x] Change Implement covers missing, unreadable or non-regular, oversized, invalid UTF-8, and empty handoff files.
- [x] Every rejection preserves its current error code, path, message, details, and help.
- [x] Invalid handoff input prevents Interactive Session Host launch and repository-state mutation.
- [x] Standard input remains rejected with `unsupported_stdin_handoff_file`.
- [x] Valid non-empty UTF-8 handoffs up to 256 KiB continue unchanged to the Interactive Session Host.
- [x] The Change Implement handoff error health finding is resolved without new quality findings.
- [x] Focused Change Implement tests and the repository quality gate pass.

## Scoped implementation record

- Baseline: `d66c10ab85769d3f9b153097e4594f1494692b9b`.
- Spec review source: this task document.
- Normative traceability: `docs/specs/taskless-changes-and-worktree-handoff.md`, section `Herdr implementation handoff`.
- Primary public test seam: `test/change-implement.test.ts` through the in-process Change Implement CLI with JSON output.

| Acceptance criterion | Implementation target | Public test seam | Verification target |
| --- | --- | --- | --- |
| Invalid handoff classes are rejected | `src/change/handoffFile.ts` and `src/cli/change/changeCli.ts` | Parameterized Change Implement CLI tests | Focused Change Implement tests |
| Structured error contracts are preserved | `src/cli/change/changeCli.ts:handoffFileError` | Exact JSON result assertions | Focused Change Implement tests and `just quality` |
| Invalid input does not launch or mutate state | `src/cli/change/changeCli.ts:runImplement` | Host launch spy and `by change show` state inspection | Focused Change Implement tests |
| Standard input remains rejected | `src/cli/change/changeCli.ts:runImplement` | Existing standard-input CLI test | Focused Change Implement tests |
| Valid handoffs are forwarded unchanged through 256 KiB | `src/change/handoffFile.ts` and `src/cli/change/changeCli.ts` | Host forwarding test at the 256 KiB boundary | Focused Change Implement tests and handoff file tests |
| Handoff error health is resolved | `src/cli/change/changeCli.ts:handoffFileError` | Public tests cover every mapping branch | `just quality` and Fallow health output |
| Focused tests and quality pass | Test and quality recipes | Repository test and quality commands | `just test test/change-implement.test.ts test/handoff-file.test.ts` and `just quality` |

## Required validation

- `just test test/change-implement.test.ts test/handoff-file.test.ts`
- `just quality`

## Decision ledger

- Preserve the existing explicit handoff error mapping because the approved task requires the current structured error contract and public coverage removes the health finding.
- Classification: `local`.

## Completion

Implementation commits:

- `0e45ed83e958f7127620d93f37d8a4ba55855d46` - cover Change Implement handoff errors.
- `f2c65a93e1102c3058dbe00d3847131e503d267d` - remove the completed task from the issue graph.

Verification:

- Focused tests passed: 20 tests across `test/change-implement.test.ts` and `test/handoff-file.test.ts`.
- Full quality passed: 378 tests passed, 1 intentional test skipped, static checks passed, Fallow passed, and the build passed.
- The handoff error health finding is resolved.

Review status:

- Spec: `APPROVED` and latched.
- Standards: `APPROVED WITH REQUIRED COMMENTS` and latched after correcting the independent 256 KiB contract boundary and documenting completion evidence.

## Blocked by

None - can start immediately.
