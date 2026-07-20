import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

import { openCandidatePublication } from "../src/publication/publishCandidate.js";
import { openSqliteCandidateStore } from "../src/sqlite/sqliteCandidateStore.js";
import { openSqliteCandidateValidationRunStore } from "../src/sqlite/sqliteCandidateValidationRunStore.js";
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
  it("publishes one passing taskless Candidate with deterministic metadata", () => {
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
      publication.publish({
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
  });

  it("recovers a PR created before its response was lost without creating a duplicate", () => {
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
        readFirstNonMergeCommitSubject: () => ({ ok: true, subject: "Add taskless publication" }),
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

    expect(publication.publish(input)).toMatchObject({
      ok: true,
      created: true,
      pullRequest: { number: 42 },
    });
    expect(publication.publish(input)).toMatchObject({
      ok: true,
      created: false,
      pullRequest: { number: 42 },
    });
    expect(createCalls).toBe(1);
  });

  it("updates the owned PR only from its expected current head for a newer passing Candidate", () => {
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

    expect(publication.publish(initial)).toMatchObject({ ok: true, created: true });
    branchHead = next.candidate.headSha;
    expect(
      publication.publish({
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
      publication.publish({
        ...initial,
        candidateId: third.candidate.id,
        validationRunId: third.validationRunId,
      }),
    ).toEqual({ ok: false, code: "publication_remote_mismatch" });
    expect(fixture.changeStore.getChangeById(fixture.changeId)?.publication).toMatchObject({
      pullRequest: { number: 42 },
      expectedHeadSha: next.candidate.headSha,
    });
  });

  it("does not update an owned PR whose remote head is no longer expected", () => {
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

    expect(publication.publish(initial)).toMatchObject({ ok: true, created: true });
    branchHead = next.candidate.headSha;
    remote = { ...remote, headSha: "unowned-remote-head" };
    expect(
      publication.publish({
        ...initial,
        candidateId: next.candidate.id,
        validationRunId: next.validationRunId,
      }),
    ).toEqual({ ok: false, code: "publication_remote_mismatch" });
  });

  it("falls back to the short Change ID when taskless commit history has no non-merge commit", () => {
    const fixture = publicationFixture();
    const { publication, requests } = publicationWithSuccessfulCreate(fixture, () => ({
      ok: true,
      subject: undefined,
    }));

    expect(publication.publish(publicationInput(fixture))).toMatchObject({
      ok: true,
      created: true,
    });
    expect(requests).toEqual([expect.objectContaining({ title: "Change e9af559b" })]);
  });

  it("does not replace unavailable taskless commit history with a fallback title", () => {
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

    expect(publication.publish(publicationInput(fixture))).toEqual({
      ok: false,
      code: "commit_history_unavailable",
    });
  });

  it("generates Task-backed metadata from immutable Task and validation facts", () => {
    const fixture = publicationFixture({ taskBacked: true });
    const { publication, requests } = publicationWithSuccessfulCreate(fixture, () => {
      throw new Error("Task-backed metadata must not read commit history");
    });

    expect(publication.publish(publicationInput(fixture))).toMatchObject({
      ok: true,
      created: true,
    });
    expect(requests).toEqual([
      expect.objectContaining({
        title: "Publish exact Candidate",
        body: `Task: BY-1\nCandidate: ${fixture.candidate.id}\nValidation Run: ${fixture.validationRunId}`,
      }),
    ]);
  });

  it("refuses remote publication when the Change branch moved after validation", () => {
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
      publication.publish({
        changeId: fixture.changeId,
        candidateId: fixture.candidate.id,
        validationRunId: fixture.validationRunId,
        policy,
        target: { owner: "acme", repo: "widgets", baseBranch: "main", remoteName: "origin" },
        now,
      }),
    ).toEqual({ ok: false, code: "current_head_mismatch" });
    expect(fixture.changeStore.getChangeById(fixture.changeId)?.publication).toBeNull();
  });

  it("releases an unpushed reservation after an exact push failure", () => {
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

    expect(publication.publish(publicationInput(fixture))).toEqual({
      ok: false,
      code: "publication_tooling_failed",
    });
    expect(fixture.changeStore.getChangeById(fixture.changeId)?.publication).toBeNull();
  });

  it("requires passing evidence for the exact resolved policy", () => {
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
      publication.publish({
        changeId: fixture.changeId,
        candidateId: fixture.candidate.id,
        validationRunId: fixture.validationRunId,
        policy: { ...policy, checks: [{ id: "new", command: "true", timeoutSeconds: 1 }] },
        target: { owner: "acme", repo: "widgets", baseBranch: "main", remoteName: "origin" },
        now,
      }),
    ).toEqual({ ok: false, code: "validation_evidence_invalid" });
  });
});

const publicationFixture = (options: { readonly taskBacked?: boolean } = {}) => {
  const root = candidateReadyRepo();
  const database = candidateSqliteInput(root, now);
  const changeStartStore = openSqliteChangeStartStore(database);
  const changeStore = openSqliteChangeStore(database);
  const taskStore = openSqliteTaskStore({ ...database, taskPrefix: "BY" });
  const candidateStore = openSqliteCandidateStore(database);
  const validationRunStore = openSqliteCandidateValidationRunStore(database);
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
