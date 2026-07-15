# Harden the automatic code-writing sandbox

## Specification

- `docs/prds/change-centered-validation-prd.md`
- `CONTEXT.md`
- `docs/adr/0015-harden-sandcastle-containers-for-v1-automatic-writing.md`

## Behaviors owned

- Every unattended Implementer and Fixer uses a fixed Sandcastle Docker or rootless Podman environment.
- The agent runs non-root with an explicit environment and mount boundary.
- GitHub credentials, host credentials, extra mounts, groups, devices, and Docker socket access are unavailable.
- Stronger isolated Sandcastle providers remain later security work.

## What to build

Create one enforced sandbox profile for automatic code-writing and route existing unattended Pi executions through it.
Reject automation when the configured provider cannot prove the profile.

## Primary verification seam

Adversarial automatic-writing sandbox integration test.

## Acceptance criteria

- [ ] Automatic code-writing rejects `none` and any unrecognized sandbox mode.
- [ ] Docker uses a fixed reviewed image, and Podman additionally proves rootless operation.
- [ ] The container process runs as the configured non-root UID and GID.
- [ ] Environment variables come from an explicit allowlist that excludes GitHub tokens, SSH agent sockets, cloud credentials, and unrelated host secrets.
- [ ] Only the managed workspace and required Git metadata are mounted.
- [ ] No extra host mounts, supplementary groups, host devices, privileged mode, or Docker socket are available.
- [ ] CPU, wall-clock, output, and supported runtime resource limits are enforced.
- [ ] Cancellation terminates the container and late output cannot write accepted domain results.
- [ ] A malicious fixture cannot read representative host credentials or invoke a GitHub push.
- [ ] The resulting clean commit remains exportable for Candidate capture by But Why.
- [ ] Repo Config cannot weaken the mandatory automatic-writing profile through repository-controlled settings.
- [ ] But Why? code applies a conservative fixed Sensitive Change classifier, and ambiguity matches a code-owned Needs Input reason.

## Open decisions to grill

- Fixed image ownership, digest pinning, updates, and supply-chain verification.
- Exact environment allowlist needed for Pi model access.
- Docker versus rootless Podman availability and setup errors.
- Network posture accepted for v1 and diagnostics shown to opt-in users.

## Blocked by

- `docs/issues/091-fix-check-findings-with-pi.md`
- `docs/issues/108-implement-one-eligible-afk-task.md`
