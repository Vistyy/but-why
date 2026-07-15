# Validate with allowlisted local files

## Specification

- `docs/prds/change-centered-validation-prd.md`
- `CONTEXT.md`
- `docs/adr/0009-keep-needs-input-an-orchestration-owned-circuit-breaker.md`
- `docs/adr/0008-use-change-as-validation-and-delivery-owner.md`

## Behaviors owned

- Validation may copy explicitly configured local files that are inside the repository but not tracked by Git.
- Immutable identity is normalized path, raw-byte SHA-256, and executable bit.
- Each Attempt copies and verifies the exact expected identity without storing file contents in SQLite.
- One input race reselects automatically, while But Why? code records Needs Input after a second observation exhausts that recovery.

## What to build

Expand Run input selection and workspace construction to support ordinary untracked and ignored regular files safely.
Reject paths and file types that cannot provide stable repository-local identity.

## Primary verification seam

Local-file validation integration test with controlled file races.

## Acceptance criteria

- [ ] Configured paths normalize to unique repository-relative paths without traversal outside the repository.
- [ ] Tracked files, directories, symbolic links, missing paths, and non-regular files are rejected before Run creation.
- [ ] Ordinary untracked and ignored regular files are accepted.
- [ ] Selection records normalized path, raw-byte SHA-256, and executable bit as immutable Run input.
- [ ] Attempt construction copies from an opened source while hashing the copied bytes.
- [ ] Metadata checks before and after reading detect replacement or mutation during selection and copying.
- [ ] The copied workspace file has the expected bytes and executable bit.
- [ ] A first detected race reselects the complete file input set and selects a corresponding new Run automatically.
- [ ] A second detected change records Change-level Needs Input for unstable inputs.
- [ ] File contents are absent from SQLite and remain inspectable only through their live source and temporary workspace copy.
- [ ] A matching later request reuses the Run only when every configured file identity still matches.

## Open decisions to grill

- Maximum number and total size of copied files.
- Hard-link handling and platform-specific executable-bit behavior.
- Exact rejection, reselection, and Needs Input AXI schemas.

## Blocked by

- `docs/issues/085-recover-interrupted-standalone-validation.md`
