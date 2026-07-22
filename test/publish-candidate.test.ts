import { spawnSync } from "node:child_process";
import { it as effectIt } from "@effect/vitest";
import { Effect } from "effect";
import { describe, expect } from "vitest";

import type {
  CandidateValidationRunRecord,
  CompleteCandidateValidationRunInput,
  StartCandidateValidationRunInput,
} from "../src/candidateValidation/candidateValidationRunStore.js";
import type { ChangePersistence } from "../src/change/changePersistence.js";
import { openCandidatePublication as openPersistentCandidatePublication } from "../src/publication/candidatePublication.js";
import { openSqliteCandidateStore } from "../src/sqlite/sqliteCandidateStore.js";
import { openSqliteChangeStartStore } from "../src/sqlite/sqliteChangeStartStore.js";
import { openSqliteChangeStore } from "../src/sqlite/sqliteChangeStore.js";
import { openSqliteTaskStore } from "../src/sqlite/sqliteTaskStore.js";
import { publicTaskId } from "../src/task/taskId.js";
import {
  candidateReadyRepo,
  candidateSqliteInput,
  commonDirectory,
} from "./support/candidateReadyRepo.js";

const now = "2026-07-22T10:00:00.000Z";
const policy = {
  sandboxMode: "none" as const,
  checks: [],
  copyFiles: [],
  specialistReviews: [],
};

describe("Candidate publication", () => {
  effectIt.effect("publishes one passing taskless Candidate with deterministic metadata", () =>
    Effect.gen(function* () {
      const fixture = publicationFixture();
      const requests: unknown[] = [];
      const publication = openCandidatePublication({
        changeStore: fixture.changeStore,
        candidateStore: fixture.candidateStore,
        validationRunStore: fixture.validationRunStore,
        git: {
          readBranchHead: () => fixture.candidate.headSha,
          readFirstNonMergeCommitSubject: () => ({ ok: true, subject: "Add taskless publication" }),
        },
        github: {
          findPullRequests: () => [],
          getPullRequest: () => undefined,
          createPullRequest: (request) => {
            requests.push(request);
            return {
              ok: true,
              pullRequest: {
                number: 42,
                url: "https://github.com/acme/widgets/pull/42",
                baseBranch: request.baseBranch,
                headBranch: request.headBranch,
                headSha: request.expectedHeadSha,
              },
            };
          },
          updatePullRequest: () => {
            throw new Error("Unexpected PR update");
          },
        },
      });

      expect(
        yield* publication.publish({
          changeId: fixture.changeId,
          candidateId: fixture.candidate.id,
          validationRunId: fixture.validationRunId,
          policy,
          target: { owner: "acme", repo: "widgets", baseBranch: "main", remoteName: "origin" },
          now,
        }),
      ).toEqual({
        ok: true,
        created: true,
        pullRequest: {
          number: 42,
          url: "https://github.com/acme/widgets/pull/42",
        },
      });
      expect(requests).toEqual([
        {
          owner: "acme",
          repo: "widgets",
          remoteName: "origin",
          baseBranch: "main",
          headBranch: "feature",
          branchRef: "refs/heads/feature",
          expectedHeadSha: fixture.candidate.headSha,
          title: "Add taskless publication",
          body: `Change: ${fixture.changeId}\nCandidate: ${fixture.candidate.id}\nValidation Run: ${fixture.validationRunId}`,
        },
      ]);
      expect(fixture.changeStore.getChangeById(fixture.changeId)).toMatchObject({
        publication: {
          candidateId: fixture.candidate.id,
          validationRunId: fixture.validationRunId,
          expectedHeadSha: fixture.candidate.headSha,
          pullRequest: { number: 42, url: "https://github.com/acme/widgets/pull/42" },
        },
      });
    }),
  );

  effectIt.effect(
    "recovers a PR created before its response was lost without creating a duplicate",
    () =>
      Effect.gen(function* () {
        const fixture = publicationFixture();
        const remotePullRequests: {
          number: number;
          url: string;
          baseBranch: string;
          headBranch: string;
          headSha: string;
        }[] = [];
        let createCalls = 0;
        const publication = openCandidatePublication({
          changeStore: fixture.changeStore,
          candidateStore: fixture.candidateStore,
          validationRunStore: fixture.validationRunStore,
          git: {
            readBranchHead: () => fixture.candidate.headSha,
            readFirstNonMergeCommitSubject: () => ({
              ok: true,
              subject: "Add taskless publication",
            }),
          },
          github: {
            findPullRequests: () => remotePullRequests,
            getPullRequest: () => remotePullRequests[0],
            createPullRequest: (request) => {
              createCalls += 1;
              remotePullRequests.push({
                number: 42,
                url: "https://github.com/acme/widgets/pull/42",
                baseBranch: request.baseBranch,
                headBranch: request.headBranch,
                headSha: request.expectedHeadSha,
              });
              return { ok: false, code: "remote_response_lost" };
            },
            updatePullRequest: () => {
              throw new Error("Unexpected PR update");
            },
          },
        });
        const input = {
          changeId: fixture.changeId,
          candidateId: fixture.candidate.id,
          validationRunId: fixture.validationRunId,
          policy,
          target: { owner: "acme", repo: "widgets", baseBranch: "main", remoteName: "origin" },
          now,
        };

        expect(yield* publication.publish(input)).toMatchObject({
          ok: true,
          created: true,
          pullRequest: { number: 42 },
        });
        expect(yield* publication.publish(input)).toMatchObject({
          ok: true,
          created: false,
          pullRequest: { number: 42 },
        });
        expect(createCalls).toBe(1);
      }),
  );

  effectIt.effect(
    "updates the owned PR only from its expected current head for a newer passing Candidate",
    () =>
      Effect.gen(function* () {
        const fixture = publicationFixture();
        const next = capturePassingCandidate(fixture, "newer-head", "2026-07-22T10:05:00.000Z");
        let branchHead = fixture.candidate.headSha;
        let remote = {
          number: 42,
          url: "https://github.com/acme/widgets/pull/42",
          baseBranch: "main",
          headBranch: "feature",
          headSha: fixture.candidate.headSha,
        };
        const updates: unknown[] = [];
        const publication = openCandidatePublication({
          changeStore: fixture.changeStore,
          candidateStore: fixture.candidateStore,
          validationRunStore: fixture.validationRunStore,
          git: {
            readBranchHead: () => branchHead,
            readFirstNonMergeCommitSubject: () => ({
              ok: true,
              subject: "Add taskless publication",
            }),
          },
          github: {
            findPullRequests: () => [],
            getPullRequest: () => remote,
            createPullRequest: (request) => ({
              ok: true,
              pullRequest: {
                ...remote,
                baseBranch: request.baseBranch,
                headBranch: request.headBranch,
                headSha: request.expectedHeadSha,
              },
            }),
            updatePullRequest: (request) => {
              updates.push(request);
              remote = { ...remote, headSha: request.expectedHeadSha };
              return updates.length === 1
                ? { ok: false, code: "push_failed" }
                : { ok: true, pullRequest: { ...remote, number: 43 } };
            },
          },
        });
        const initial = publicationInput(fixture);

        expect(yield* publication.publish(initial)).toMatchObject({ ok: true, created: true });
        branchHead = next.candidate.headSha;
        expect(
          yield* publication.publish({
            ...initial,
            candidateId: next.candidate.id,
            validationRunId: next.validationRunId,
          }),
        ).toMatchObject({ ok: true, created: false, pullRequest: { number: 42 } });
        expect(updates).toEqual([
          expect.objectContaining({
            number: 42,
            expectedCurrentHeadSha: fixture.candidate.headSha,
            expectedHeadSha: next.candidate.headSha,
          }),
        ]);

        const third = capturePassingCandidate(fixture, "third-head", "2026-07-22T10:10:00.000Z");
        branchHead = third.candidate.headSha;
        expect(
          yield* publication.publish({
            ...initial,
            candidateId: third.candidate.id,
            validationRunId: third.validationRunId,
          }),
        ).toEqual({ ok: false, code: "publication_remote_mismatch" });
        expect(fixture.changeStore.getChangeById(fixture.changeId)?.publication).toMatchObject({
          pullRequest: { number: 42 },
          expectedHeadSha: next.candidate.headSha,
        });
      }),
  );

  effectIt.effect("does not update an owned PR whose remote head is no longer expected", () =>
    Effect.gen(function* () {
      const fixture = publicationFixture();
      const next = capturePassingCandidate(fixture, "newer-head", "2026-07-22T10:05:00.000Z");
      let branchHead = fixture.candidate.headSha;
      let remote = {
        number: 42,
        url: "https://github.com/acme/widgets/pull/42",
        baseBranch: "main",
        headBranch: "feature",
        headSha: fixture.candidate.headSha,
      };
      const publication = openCandidatePublication({
        changeStore: fixture.changeStore,
        candidateStore: fixture.candidateStore,
        validationRunStore: fixture.validationRunStore,
        git: {
          readBranchHead: () => branchHead,
          readFirstNonMergeCommitSubject: () => ({ ok: true, subject: "Add taskless publication" }),
        },
        github: {
          findPullRequests: () => [],
          getPullRequest: () => remote,
          createPullRequest: (request) => ({
            ok: true,
            pullRequest: {
              ...remote,
              baseBranch: request.baseBranch,
              headBranch: request.headBranch,
              headSha: request.expectedHeadSha,
            },
          }),
          updatePullRequest: () => {
            throw new Error("Must not update an unexpected remote head");
          },
        },
      });
      const initial = publicationInput(fixture);

      expect(yield* publication.publish(initial)).toMatchObject({ ok: true, created: true });
      branchHead = next.candidate.headSha;
      remote = { ...remote, headSha: "unowned-remote-head" };
      expect(
        yield* publication.publish({
          ...initial,
          candidateId: next.candidate.id,
          validationRunId: next.validationRunId,
        }),
      ).toEqual({ ok: false, code: "publication_remote_mismatch" });
    }),
  );

  effectIt.effect(
    "falls back to the short Change ID when taskless commit history has no non-merge commit",
    () =>
      Effect.gen(function* () {
        const fixture = publicationFixture();
        const { publication, requests } = publicationWithSuccessfulCreate(fixture, () => ({
          ok: true,
          subject: undefined,
        }));

        expect(yield* publication.publish(publicationInput(fixture))).toMatchObject({
          ok: true,
          created: true,
        });
        expect(requests).toEqual([expect.objectContaining({ title: "Change e9af559b" })]);
      }),
  );

  effectIt.effect(
    "does not replace unavailable taskless commit history with a fallback title",
    () =>
      Effect.gen(function* () {
        const fixture = publicationFixture();
        const publication = openCandidatePublication({
          changeStore: fixture.changeStore,
          candidateStore: fixture.candidateStore,
          validationRunStore: fixture.validationRunStore,
          git: {
            readBranchHead: () => fixture.candidate.headSha,
            readFirstNonMergeCommitSubject: () => ({ ok: false }),
          },
          github: noRemoteMutationGateway(),
        });

        expect(yield* publication.publish(publicationInput(fixture))).toEqual({
          ok: false,
          code: "commit_history_unavailable",
        });
      }),
  );

  effectIt.effect("generates Task-backed metadata from immutable Task and validation facts", () =>
    Effect.gen(function* () {
      const fixture = publicationFixture({ taskBacked: true });
      const { publication, requests } = publicationWithSuccessfulCreate(fixture, () => {
        throw new Error("Task-backed metadata must not read commit history");
      });

      expect(yield* publication.publish(publicationInput(fixture))).toMatchObject({
        ok: true,
        created: true,
      });
      expect(requests).toEqual([
        expect.objectContaining({
          title: "Publish exact Candidate",
          body: `Task: BY-1\nCandidate: ${fixture.candidate.id}\nValidation Run: ${fixture.validationRunId}`,
        }),
      ]);
    }),
  );

  effectIt.effect("refuses remote publication when the Change branch moved after validation", () =>
    Effect.gen(function* () {
      const fixture = publicationFixture();
      const publication = openCandidatePublication({
        changeStore: fixture.changeStore,
        candidateStore: fixture.candidateStore,
        validationRunStore: fixture.validationRunStore,
        git: {
          readBranchHead: () => "newer-head",
          readFirstNonMergeCommitSubject: () => ({ ok: true, subject: "Add taskless publication" }),
        },
        github: {
          findPullRequests: () => {
            throw new Error("Unexpected PR lookup");
          },
          getPullRequest: () => {
            throw new Error("Unexpected PR read");
          },
          createPullRequest: () => {
            throw new Error("Must not create a PR from a moved branch");
          },
          updatePullRequest: () => {
            throw new Error("Unexpected PR update");
          },
        },
      });

      expect(
        yield* publication.publish({
          changeId: fixture.changeId,
          candidateId: fixture.candidate.id,
          validationRunId: fixture.validationRunId,
          policy,
          target: { owner: "acme", repo: "widgets", baseBranch: "main", remoteName: "origin" },
          now,
        }),
      ).toEqual({ ok: false, code: "current_head_mismatch" });
      expect(fixture.changeStore.getChangeById(fixture.changeId)?.publication).toBeNull();
    }),
  );

  effectIt.effect("releases an unpushed reservation after an exact push failure", () =>
    Effect.gen(function* () {
      const fixture = publicationFixture();
      const publication = openCandidatePublication({
        changeStore: fixture.changeStore,
        candidateStore: fixture.candidateStore,
        validationRunStore: fixture.validationRunStore,
        git: {
          readBranchHead: () => fixture.candidate.headSha,
          readFirstNonMergeCommitSubject: () => ({ ok: true, subject: "Add taskless publication" }),
        },
        github: {
          findPullRequests: () => {
            throw new Error("Must not recover when GitHub was never called");
          },
          getPullRequest: () => undefined,
          createPullRequest: () => ({ ok: false, code: "push_failed" }),
          updatePullRequest: () => {
            throw new Error("Unexpected PR update");
          },
        },
      });

      expect(yield* publication.publish(publicationInput(fixture))).toEqual({
        ok: false,
        code: "publication_tooling_failed",
      });
      expect(fixture.changeStore.getChangeById(fixture.changeId)?.publication).toBeNull();
    }),
  );

  effectIt.effect("requires passing evidence for the exact resolved policy", () =>
    Effect.gen(function* () {
      const fixture = publicationFixture();
      const publication = openCandidatePublication({
        changeStore: fixture.changeStore,
        candidateStore: fixture.candidateStore,
        validationRunStore: fixture.validationRunStore,
        git: {
          readBranchHead: () => fixture.candidate.headSha,
          readFirstNonMergeCommitSubject: () => ({ ok: true, subject: "Add taskless publication" }),
        },
        github: noRemoteMutationGateway(),
      });

      expect(
        yield* publication.publish({
          changeId: fixture.changeId,
          candidateId: fixture.candidate.id,
          validationRunId: fixture.validationRunId,
          policy: { ...policy, checks: [{ id: "new", command: "true", timeoutSeconds: 1 }] },
          target: { owner: "acme", repo: "widgets", baseBranch: "main", remoteName: "origin" },
          now,
        }),
      ).toEqual({ ok: false, code: "validation_evidence_invalid" });
    }),
  );
});

describe("Candidate publication persistence", () => {
  effectIt.effect("releases a publication reservation after a push failure", () =>
    Effect.gen(function* () {
      const fixture = publicationFixture();
      const publication = openPersistentCandidatePublication({
        changePersistence: effectChangePersistence(fixture.changeStore),
        validationPersistence: {
          getCandidateById: (candidateId) =>
            Effect.sync(() => fixture.candidateStore.getCandidateById(candidateId)),
          getRunById: (validationRunId) =>
            Effect.sync(() => fixture.validationRunStore.getRunById(validationRunId)),
        },
        git: {
          readBranchHead: () => fixture.candidate.headSha,
          readFirstNonMergeCommitSubject: () => ({ ok: true, subject: "Publish safely" }),
        },
        github: {
          findPullRequests: () => [],
          getPullRequest: () => undefined,
          createPullRequest: () => ({ ok: false, code: "push_failed" }),
          updatePullRequest: () => {
            throw new Error("Unexpected PR update");
          },
        },
      });

      expect(yield* publication.publish(publicationInput(fixture))).toEqual({
        ok: false,
        code: "publication_tooling_failed",
      });
      expect(fixture.changeStore.getChangeById(fixture.changeId)?.publication).toBeNull();
    }),
  );
});

const openCandidatePublication = (input: {
  readonly changeStore: ReturnType<typeof openSqliteChangeStore>;
  readonly candidateStore: ReturnType<typeof openSqliteCandidateStore>;
  readonly validationRunStore: ReturnType<typeof inMemoryValidationRuns>;
  readonly git: Parameters<typeof openPersistentCandidatePublication>[0]["git"];
  readonly github: Parameters<typeof openPersistentCandidatePublication>[0]["github"];
}) => {
  const publication = openPersistentCandidatePublication({
    changePersistence: effectChangePersistence(input.changeStore),
    validationPersistence: {
      getCandidateById: (candidateId) =>
        Effect.sync(() => input.candidateStore.getCandidateById(candidateId)),
      getRunById: (validationRunId) =>
        Effect.sync(() => input.validationRunStore.getRunById(validationRunId)),
    },
    git: input.git,
    github: input.github,
  });
  return publication;
};

const effectChangePersistence = (
  store: ReturnType<typeof openSqliteChangeStore>,
): ChangePersistence => ({
  getChangeById: (changeId) => Effect.sync(() => store.getChangeById(changeId)),
  getChangeByTaskId: (taskId) => Effect.sync(() => store.getChangeByTaskId(taskId)),
  listChanges: (input) => Effect.sync(() => store.listChanges(input)),
  listChangesForReconciliation: (commonDirectory) =>
    Effect.sync(() => store.listChangesForReconciliation(commonDirectory)),
  completeMergedChange: (input) => Effect.sync(() => store.completeMergedChange(input)),
  recordCleanup: (input) => Effect.sync(() => store.recordCleanup(input)),
  beginPublication: (input) => Effect.sync(() => store.beginPublication(input)),
  releasePendingPublication: (input) => Effect.sync(() => store.releasePendingPublication(input)),
  recordPublishedPullRequest: (input) => Effect.sync(() => store.recordPublishedPullRequest(input)),
});

const publicationFixture = (options: { readonly taskBacked?: boolean } = {}) => {
  const root = candidateReadyRepo();
  const database = candidateSqliteInput(root);
  const changeStartStore = openSqliteChangeStartStore(database);
  const changeStore = openSqliteChangeStore(database);
  const taskStore = openSqliteTaskStore({ ...database, taskPrefix: "BY" });
  const candidateStore = openSqliteCandidateStore(database);
  const validationRunStore = inMemoryValidationRuns();
  const startingCommit = git(root, "rev-parse", "refs/heads/main");
  const headSha = git(root, "rev-parse", "refs/heads/feature");
  const changeId = "e9af559b-5d22-4f22-a965-03c6e7af0938";
  const taskId = options.taskBacked === true ? createApprovedTask(taskStore) : undefined;
  const started = changeStartStore.create({
    id: changeId,
    repositoryCommonDirectory: commonDirectory(root),
    branchRef: "refs/heads/feature",
    baseRef: "refs/heads/main",
    startingCommit,
    worktreePath: root,
    ...(taskId === undefined ? {} : { taskId }),
    now,
  });
  if (!started.ok) throw new Error("Could not create Change");
  const captured = candidateStore.captureCandidate({
    changeId,
    selectedBaseRef: "refs/heads/main",
    resolvedTargetSha: startingCommit,
    comparisonBaseSha: startingCommit,
    headSha,
    now,
  });
  if (!captured.ok) throw new Error("Could not capture Candidate");
  const startedRun = validationRunStore.startOrReuse({
    candidateId: captured.candidate.id,
    headSha,
    policy,
    now,
  });
  if (startedRun.reused) throw new Error("Expected a new Validation Run");
  validationRunStore.complete({
    validationRunId: startedRun.validationRunId,
    outcome: "passed",
    now,
  });

  return {
    changeId,
    candidate: captured.candidate,
    validationRunId: startedRun.validationRunId,
    changeStore,
    candidateStore,
    validationRunStore,
  };
};

const publicationInput = (fixture: ReturnType<typeof publicationFixture>) => ({
  changeId: fixture.changeId,
  candidateId: fixture.candidate.id,
  validationRunId: fixture.validationRunId,
  policy,
  target: { owner: "acme", repo: "widgets", baseBranch: "main", remoteName: "origin" },
  now,
});

const publicationWithSuccessfulCreate = (
  fixture: ReturnType<typeof publicationFixture>,
  readFirstNonMergeCommitSubject: () =>
    | { readonly ok: true; readonly subject: string | undefined }
    | { readonly ok: false },
) => {
  const requests: unknown[] = [];
  return {
    requests,
    publication: openCandidatePublication({
      changeStore: fixture.changeStore,
      candidateStore: fixture.candidateStore,
      validationRunStore: fixture.validationRunStore,
      git: {
        readBranchHead: () => fixture.candidate.headSha,
        readFirstNonMergeCommitSubject,
      },
      github: {
        findPullRequests: () => [],
        getPullRequest: () => undefined,
        createPullRequest: (request) => {
          requests.push(request);
          return {
            ok: true as const,
            pullRequest: {
              number: 42,
              url: "https://github.com/acme/widgets/pull/42",
              baseBranch: request.baseBranch,
              headBranch: request.headBranch,
              headSha: request.expectedHeadSha,
            },
          };
        },
        updatePullRequest: () => {
          throw new Error("Unexpected PR update");
        },
      },
    }),
  };
};

const capturePassingCandidate = (
  fixture: ReturnType<typeof publicationFixture>,
  headSha: string,
  candidateNow: string,
) => {
  const captured = fixture.candidateStore.captureCandidate({
    changeId: fixture.changeId,
    selectedBaseRef: "refs/heads/main",
    resolvedTargetSha: fixture.candidate.resolvedTargetSha,
    comparisonBaseSha: fixture.candidate.comparisonBaseSha,
    headSha,
    now: candidateNow,
  });
  if (!captured.ok) throw new Error("Could not capture newer Candidate");
  const started = fixture.validationRunStore.startOrReuse({
    candidateId: captured.candidate.id,
    headSha,
    policy,
    now: candidateNow,
  });
  if (started.reused) throw new Error("Expected a new Validation Run");
  fixture.validationRunStore.complete({
    validationRunId: started.validationRunId,
    outcome: "passed",
    now: candidateNow,
  });
  return { candidate: captured.candidate, validationRunId: started.validationRunId };
};

const inMemoryValidationRuns = () => {
  const runs = new Map<string, CandidateValidationRunRecord>();
  return {
    startOrReuse: (input: StartCandidateValidationRunInput) => {
      const validationRunId = `validation-run-${runs.size + 1}`;
      runs.set(validationRunId, {
        id: validationRunId,
        candidateId: input.candidateId,
        policy: input.policy,
        state: "running",
        outcome: null,
        createdAt: input.now,
        updatedAt: input.now,
      });
      return { reused: false as const, validationRunId };
    },
    complete: (input: CompleteCandidateValidationRunInput) => {
      const run = runs.get(input.validationRunId);
      if (run === undefined) throw new Error("Validation Run was not found");
      runs.set(input.validationRunId, {
        ...run,
        state: "complete",
        outcome: input.outcome,
        updatedAt: input.now,
      });
    },
    getRunById: (validationRunId: string) => runs.get(validationRunId),
  };
};

const createApprovedTask = (taskStore: ReturnType<typeof openSqliteTaskStore>) => {
  const task = taskStore.createTask({
    title: "Publish exact Candidate",
    description: "Publish the validated Candidate.",
    now,
  });
  const taskId = publicTaskId(task.id);
  const approved = taskStore.approveTask({ taskId, now });
  if (!approved.ok) throw new Error("Could not approve Task");
  return taskId;
};

const noRemoteMutationGateway = () => ({
  findPullRequests: () => {
    throw new Error("Unexpected PR lookup");
  },
  getPullRequest: () => {
    throw new Error("Unexpected PR read");
  },
  createPullRequest: () => {
    throw new Error("Unexpected PR creation");
  },
  updatePullRequest: () => {
    throw new Error("Unexpected PR update");
  },
});

const git = (cwd: string, ...args: readonly string[]): string => {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr);
  return result.stdout.trim();
};
