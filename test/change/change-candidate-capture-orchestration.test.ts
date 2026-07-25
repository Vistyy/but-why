import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { describe } from "vitest";

import { openCandidateCapture } from "../../src/change/candidateCapture/captureLocalCandidate.js";
import type {
  CandidateCaptureChange,
  CandidateCapturePersistence,
} from "../../src/change/candidateCapture/candidateCapturePersistence.js";
import type { CandidateCaptureGit } from "../../src/change/candidateCapture/candidateCaptureGit.js";

const now = "2026-07-12T10:00:00.000Z";

describe("Change Candidate capture orchestration", () => {
  it.effect("captures through supplied persistence and Git interfaces", () =>
    Effect.gen(function* () {
      const events: string[] = [];
      const persistence: CandidateCapturePersistence = {
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
              baseRef: "refs/heads/main",
              changeBaseSha: "fetched-target",
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
      const git: CandidateCaptureGit = {
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
        resolveLocalBranch: () => Effect.die("The fetched Change Base must remain exact"),
        containsCommit: () => Effect.succeed(true),
        trackedTreeMatches: () => Effect.succeed(false),
      };
      const capture = openCandidateCapture({ persistence, git });

      const result = yield* capture.capture({
        cwd: "/repo/worktree",
        now,
        changeBaseSha: "fetched-target",
      });

      expect(result).toEqual({
        ok: true,
        changeId: "change-1",
        candidateId: "candidate-1",
        branchRef: "refs/heads/feature",
        changeBaseSha: "fetched-target",
        headSha: "head",
        trackedTreeMatchesChangeBase: false,
      });
      expect(events).toEqual(["read_workspace", "read_change", "commit_capture"]);
    }),
  );

  it.effect("captures tracked-tree equality against the fetched Change Base", () =>
    Effect.gen(function* () {
      let committedHead: string | undefined;
      const persistence: CandidateCapturePersistence = {
        getChangeById: () =>
          Effect.succeed({
            id: "change-1",
            repositoryCommonDirectory: "/repo/.git",
            branchRef: "refs/heads/feature",
            baseRef: null,
            state: "open" as const,
          }),
        getChangeByRepositoryBranch: () =>
          Effect.succeed({
            id: "change-1",
            repositoryCommonDirectory: "/repo/.git",
            branchRef: "refs/heads/feature",
            baseRef: null,
            state: "open" as const,
          }),
        commitCapture: (input) =>
          Effect.sync(() => {
            committedHead = input.headSha;
            expect(input.changeBaseSha).toBe("base");
            return {
              ok: true as const,
              changeId: "change-1",
              candidateId: "candidate-no-change",
              reused: false,
            };
          }),
      };
      const git: CandidateCaptureGit = {
        readWorkspace: () =>
          Effect.succeed({
            ok: true as const,
            facts: {
              repositoryCommonDirectory: "/repo/.git",
              primaryRoot: "/repo",
              branchRef: "refs/heads/feature",
              headSha: "different-commit-with-same-tree",
            },
          }),
        localBranchExists: () => Effect.succeed(true),
        recordedRemoteDefaultLocalBranches: () => Effect.succeed(["refs/heads/main"]),
        resolveLocalBranch: () => Effect.succeed("base"),
        containsCommit: () => Effect.succeed(true),
        trackedTreeMatches: (_cwd, commit) => Effect.succeed(commit === "base"),
      };

      const result = yield* openCandidateCapture({ persistence, git }).capture({
        cwd: "/repo/worktree",
        now,
        changeId: "change-1",
      });

      expect(result).toEqual({
        ok: true,
        changeId: "change-1",
        candidateId: "candidate-no-change",
        branchRef: "refs/heads/feature",
        changeBaseSha: "base",
        headSha: "different-commit-with-same-tree",
        trackedTreeMatchesChangeBase: true,
      });
      expect(committedHead).toBe("different-commit-with-same-tree");
    }),
  );

  it.effect("rejects unsafe base selection, Change rebinding, and Candidate provenance", () =>
    Effect.gen(function* () {
      const openChange: CandidateCaptureChange = {
        id: "change-1",
        repositoryCommonDirectory: "/repo/.git",
        branchRef: "refs/heads/original",
        baseRef: null,
        state: "open",
      };
      const destination: CandidateCaptureChange = {
        ...openChange,
        id: "change-2",
        branchRef: "refs/heads/feature",
      };
      const workspace = {
        repositoryCommonDirectory: "/repo/.git",
        primaryRoot: "/repo",
        branchRef: "refs/heads/feature",
        headSha: "head",
      };

      for (const testCase of [
        { code: "missing_remote_default", remoteDefaults: [] },
        {
          code: "ambiguous_remote_default",
          remoteDefaults: ["refs/heads/main", "refs/heads/trunk"],
        },
        { code: "local_base_unavailable", remoteDefaults: ["refs/heads/main"], baseExists: false },
        { code: "invalid_base_ref", input: { baseRef: "main" } },
        {
          code: "change_from_different_repository",
          input: { changeId: openChange.id },
          change: { ...openChange, repositoryCommonDirectory: "/other/.git" },
        },
        {
          code: "change_rebind_not_authorized",
          input: { changeId: openChange.id },
          change: openChange,
        },
        { code: "rebind_requires_change_id", input: { allowRebind: true } },
        {
          code: "destination_branch_has_history",
          input: { changeId: openChange.id, allowRebind: true },
          change: openChange,
          destination,
        },
        {
          code: "conflicting_branch_facts",
          input: { changeId: openChange.id, allowRebind: true },
          change: openChange,
          renameFromRef: "refs/heads/other",
        },
      ] as const) {
        let commitCalls = 0;
        const persistence: CandidateCapturePersistence = {
          getChangeById: () => Effect.succeed("change" in testCase ? testCase.change : undefined),
          getChangeByRepositoryBranch: (_repository, branchRef) =>
            Effect.succeed(
              "destination" in testCase && branchRef === workspace.branchRef
                ? testCase.destination
                : undefined,
            ),
          commitCapture: () => {
            commitCalls += 1;
            return Effect.succeed({
              ok: true,
              changeId: "change-1",
              candidateId: "candidate-1",
              reused: false,
            } as const);
          },
        };
        const git: CandidateCaptureGit = {
          readWorkspace: () =>
            Effect.succeed({
              ok: true,
              facts: {
                ...workspace,
                ...(testCase.renameFromRef === undefined
                  ? {}
                  : { renameFromRef: testCase.renameFromRef }),
              },
            }),
          localBranchExists: () =>
            Effect.succeed("baseExists" in testCase ? testCase.baseExists : true),
          recordedRemoteDefaultLocalBranches: () =>
            Effect.succeed(
              "remoteDefaults" in testCase ? testCase.remoteDefaults : ["refs/heads/main"],
            ),
          resolveLocalBranch: () => Effect.succeed("base"),
          containsCommit: () => Effect.succeed(true),
          trackedTreeMatches: () => Effect.succeed(false),
        };

        const result = yield* openCandidateCapture({ persistence, git }).capture({
          cwd: "/repo/worktree",
          now,
          ...("input" in testCase ? testCase.input : {}),
        });

        expect(result).toEqual({ ok: false, code: testCase.code });
        expect(commitCalls).toBe(0);
      }
    }),
  );
});
