# Add automatic Change and Candidate capture

## Parent

`docs/prds/change-centered-validation-prd.md`

## What to build

Build one internal application capability that turns clean committed local work into a captured Candidate.
The capability finds or creates the correct Change, chooses and saves its base, captures the exact comparison, and returns the result to its caller.
Later validation, submission, Task, PR, and background-worker flows use this capability instead of implementing their own discovery or capture logic.

## Acceptance criteria

- [ ] An optional caller-supplied Change ID takes precedence, while standalone work resolves the Change from the Local Repository and full local branch ref.
- [ ] Supplying a Change ID selects the expected Change but does not by itself authorize rebinding it to another branch.
- [ ] A branch with no Change history creates a Change, while an existing open binding reuses its Change.
- [ ] A closed Change, ambiguous binding, conflicting branch facts, detached head, unborn branch, or dirty work rejects capture without changing Git or durable state.
- [ ] Linked worktrees identify one Local Repository through the canonical Git common directory and share its Changes and Candidates.
- [ ] A new Change uses a caller-supplied base when present, otherwise the unambiguous remote default branch recorded by local Git.
- [ ] Every base resolves to an existing full local `refs/heads/*` ref; a recorded remote default is usable only when its matching local branch exists.
- [ ] A missing, ambiguous, or unavailable local base rejects capture without fetching, guessing a conventional branch name, or changing Git state.
- [ ] Issue 051 extends the Change schema and store contract with an optional base ref.
- [ ] The chosen base is stored on the Change as a full local branch ref when its first Candidate is captured.
- [ ] Later captures reuse the Change's saved base; a supplied base must match it, while deliberate PR retargeting is handled by the later reconciliation flow.
- [ ] A Candidate stores the selected base ref, its resolved target SHA, the exact comparison-base SHA, and the head SHA.
- [ ] Repeated capture of the same comparison and matching base facts reuses the existing Candidate.
- [ ] Conflicting base facts for an existing Candidate identity return a typed rejection without changing history.
- [ ] Only an exact Git reflog rename record in the same Local Repository automatically moves an open Change to a renamed branch.
- [ ] When Git cannot prove a rename, the caller may explicitly allow rebinding the supplied Change ID to the current branch; rebind authorization without a supplied Change ID is rejected.
- [ ] A confirmed rebind accepts only an open Change from the same Local Repository.
- [ ] A rename or confirmed rebind rejects a destination branch with any Change history.
- [ ] Resolving or creating the Change, setting its first base, applying an authorized rebind, and capturing or reusing the Candidate commit as one atomic storage operation.
- [ ] The application result identifies the Change ID, Candidate ID, full branch ref, selected base ref and source, resolved target SHA, comparison-base SHA, and head SHA.

## Blocked by

- `docs/issues/050-expand-storage-with-change-and-candidate.md`
