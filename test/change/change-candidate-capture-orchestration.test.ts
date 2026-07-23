import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { describe } from "vitest";

import { openChangeCandidateCapture } from "../../src/changeCandidateCapture/captureLocalCandidate.js";
import type { ChangeCandidateCapturePersistence } from "../../src/changeCandidateCapture/changeCandidateCapturePersistence.js";
import type { ChangeCandidateCaptureGit } from "../../src/changeCandidateCapture/changeCandidateCaptureGit.js";

const now = "2026-07-12T10:00:00.000Z";

describe("Change Candidate capture orchestration", () => {
  it.effect("captures through supplied persistence and Git interfaces", () =>
    Effect.gen(function* () {
      const events: string[] = [];
      const persistence: ChangeCandidateCapturePersistence = {
        getChangeById: () => Effect.succeed(undefined),
        getChangeByRepositoryBranch: () =>
          Effect.sync(() => {
            events.push("read_change");
            return undefined;
          }),
        commitCapture: (input) =>
          Effect.sync(() => {
            events.push("commit_capture");
            expect(input).toMatchObject({
              repositoryCommonDirectory: "/repo/.git",
              branchRef: "refs/heads/feature",
              selectedBaseRef: "refs/heads/main",
              resolvedTargetSha: "base",
              comparisonBaseSha: "base",
              headSha: "head",
            });
            return {
              ok: true as const,
              changeId: "change-1",
              candidateId: "candidate-1",
              reused: false,
            };
          }),
      };
      const git: ChangeCandidateCaptureGit = {
        readWorkspace: () =>
          Effect.sync(() => {
            events.push("read_workspace");
            return {
              ok: true as const,
              facts: {
                repositoryCommonDirectory: "/repo/.git",
                primaryRoot: "/repo",
                branchRef: "refs/heads/feature",
                headSha: "head",
              },
            };
          }),
        localBranchExists: () => Effect.succeed(true),
        recordedRemoteDefaultLocalBranches: () => Effect.succeed(["refs/heads/main"]),
        resolveLocalBranch: () => Effect.succeed("base"),
        findComparisonBase: () => Effect.succeed("base"),
      };
      const capture = openChangeCandidateCapture({ persistence, git });

      const result = yield* capture.capture({ cwd: "/repo/worktree", now });

      expect(result).toEqual({
        ok: true,
        changeId: "change-1",
        candidateId: "candidate-1",
        branchRef: "refs/heads/feature",
        selectedBaseRef: "refs/heads/main",
        baseSource: "remote_default",
        resolvedTargetSha: "base",
        comparisonBaseSha: "base",
        headSha: "head",
      });
      expect(events).toEqual(["read_workspace", "read_change", "commit_capture"]);
    }),
  );
});
