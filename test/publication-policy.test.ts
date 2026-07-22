import { expect, it } from "@effect/vitest";
import { Effect } from "effect";

import type { ChangePersistence } from "../src/change/changePersistence.js";
import type { GitHubPullRequestRequest } from "../src/change/ownedPullRequestGateway.js";
import type { CaptureLocalCandidateResult } from "../src/changeCandidateCapture/captureLocalCandidate.js";
import type { ChangeValidationPersistence } from "../src/changeValidation/changeValidationPersistence.js";
import { openCandidatePublication } from "../src/publication/candidatePublication.js";
import { RepositorySql } from "../src/sqlite/repositorySql.js";
import { openSqliteChangePersistence } from "../src/sqlite/sqliteChangePersistence.js";
import { openSqliteChangeValidationPersistence } from "../src/sqlite/sqliteChangeValidationPersistence.js";
import { captureLocalCandidate } from "./support/changeCandidateCapture.js";
import { candidateReadyRepo, git } from "./support/candidateReadyRepo.js";
import { withTestRepository } from "./support/repository.js";

const now = "2026-07-22T10:00:00.000Z";
const policy = { sandboxMode: "none" as const, checks: [], copyFiles: [], specialistReviews: [] };
const target = { owner: "acme", repo: "widgets", baseBranch: "main", remoteName: "origin" };

it.scoped("publishes exact taskless metadata only from matching policy evidence", () =>
  withFixture((fixture) =>
    Effect.gen(function* () {
      const requests: unknown[] = [];
      const publication = openCandidatePublication({
        changePersistence: fixture.changes,
        validationPersistence: fixture.validation,
        git: {
          readBranchHead: () => fixture.captured.headSha,
          readFirstNonMergeCommitSubject: () => ({ ok: true, subject: "Add taskless publication" }),
        },
        github: successfulCreation(requests),
      });
      expect(
        yield* publication.publish({
          ...input(fixture),
          policy: { ...policy, checks: [{ id: "new", command: "true", timeoutSeconds: 1 }] },
        }),
      ).toEqual({ ok: false, code: "validation_evidence_invalid" });
      expect(requests).toEqual([]);
      expect(yield* publication.publish(input(fixture))).toMatchObject({ ok: true, created: true });
      expect(requests).toEqual([
        {
          ...target,
          headBranch: "feature",
          branchRef: "refs/heads/feature",
          expectedHeadSha: fixture.captured.headSha,
          title: "Add taskless publication",
          body: `Change: ${fixture.captured.changeId}\nCandidate: ${fixture.captured.candidateId}\nValidation Run: ${fixture.validationRunId}`,
        },
      ]);
    }),
  ),
);

it.scoped("releases a failed reservation and permits a clean retry", () =>
  withFixture((fixture) =>
    Effect.gen(function* () {
      let currentHead = "moved-head";
      let createCalls = 0;
      const publication = openCandidatePublication({
        changePersistence: fixture.changes,
        validationPersistence: fixture.validation,
        git: {
          readBranchHead: () => currentHead,
          readFirstNonMergeCommitSubject: () => ({ ok: true, subject: "Retry publication" }),
        },
        github: {
          findPullRequests: () => [],
          getPullRequest: () => undefined,
          createPullRequest: (request) => {
            createCalls += 1;
            return createCalls === 1
              ? { ok: false as const, code: "push_failed" as const }
              : { ok: true as const, pullRequest: pullRequest(request.expectedHeadSha) };
          },
          updatePullRequest: () => {
            throw new Error("Unexpected PR update");
          },
        },
      });
      expect(yield* publication.publish(input(fixture))).toEqual({
        ok: false,
        code: "current_head_mismatch",
      });
      expect(createCalls).toBe(0);
      currentHead = fixture.captured.headSha;
      expect(yield* publication.publish(input(fixture))).toEqual({
        ok: false,
        code: "publication_tooling_failed",
      });
      expect(yield* fixture.changes.getChangeById(fixture.captured.changeId)).toMatchObject({
        publication: null,
      });
      expect(yield* publication.publish(input(fixture))).toMatchObject({ ok: true, created: true });
    }),
  ),
);

it.scoped("uses taskless fallback metadata and reports unavailable history", () =>
  withFixture((fixture) =>
    Effect.gen(function* () {
      const requests: unknown[] = [];
      let historyAvailable = false;
      const publication = openCandidatePublication({
        changePersistence: fixture.changes,
        validationPersistence: fixture.validation,
        git: {
          readBranchHead: () => fixture.captured.headSha,
          readFirstNonMergeCommitSubject: () =>
            historyAvailable
              ? { ok: true as const, subject: undefined }
              : { ok: false as const, code: "commit_history_unavailable" as const },
        },
        github: successfulCreation(requests),
      });
      expect(yield* publication.publish(input(fixture))).toEqual({
        ok: false,
        code: "commit_history_unavailable",
      });
      expect(requests).toEqual([]);
      historyAvailable = true;
      expect(yield* publication.publish(input(fixture))).toMatchObject({ ok: true });
      expect(requests).toContainEqual(
        expect.objectContaining({ title: `Change ${fixture.captured.changeId.slice(0, 8)}` }),
      );
    }),
  ),
);

it.scoped("publishes Task-backed metadata without reading commit history", () =>
  withFixture((fixture) =>
    Effect.gen(function* () {
      const repository = yield* RepositorySql;
      yield* repository.operation(
        "create publication Task",
        (sql) => sql`
        INSERT INTO tasks (id, numeric_id, title, description, state, created_at, updated_at)
        VALUES ('BY-1', 1, 'Publish exact Candidate', 'Description', 'implementing', ${now}, ${now})
      `,
      );
      yield* repository.operation(
        "attach Task publication metadata",
        (sql) => sql`
        UPDATE changes
        SET task_id = 'BY-1', acceptance_context = ${JSON.stringify({ version: 1, title: "Publish exact Candidate", description: "Description", comments: [] })}
        WHERE id = ${fixture.captured.changeId}
      `,
      );
      const requests: unknown[] = [];
      const publication = openCandidatePublication({
        changePersistence: fixture.changes,
        validationPersistence: fixture.validation,
        git: {
          readBranchHead: () => fixture.captured.headSha,
          readFirstNonMergeCommitSubject: () => {
            throw new Error("Task-backed metadata must not read commit history");
          },
        },
        github: successfulCreation(requests),
      });
      expect(yield* publication.publish(input(fixture))).toMatchObject({ ok: true });
      expect(requests).toContainEqual(
        expect.objectContaining({
          title: "Publish exact Candidate",
          body: `Task: BY-1\nCandidate: ${fixture.captured.candidateId}\nValidation Run: ${fixture.validationRunId}`,
        }),
      );
    }),
  ),
);

it.scoped("updates only the owned pull request at its expected remote head", () =>
  withFixture((fixture) =>
    Effect.gen(function* () {
      let branchHead = fixture.captured.headSha;
      let remote = pullRequest(branchHead);
      const updates: unknown[] = [];
      const publication = openCandidatePublication({
        changePersistence: fixture.changes,
        validationPersistence: fixture.validation,
        git: {
          readBranchHead: () => branchHead,
          readFirstNonMergeCommitSubject: () => ({ ok: true, subject: "Publication" }),
        },
        github: {
          findPullRequests: () => [],
          getPullRequest: () => remote,
          createPullRequest: () => ({ ok: true, pullRequest: remote }),
          updatePullRequest: (request) => {
            updates.push(request);
            remote = pullRequest(request.expectedHeadSha);
            return { ok: true, pullRequest: remote };
          },
        },
      });
      expect(yield* publication.publish(input(fixture))).toMatchObject({ ok: true });

      const next = yield* nextCandidate(fixture, "New Candidate", "2026-07-22T10:05:00.000Z");
      branchHead = next.captured.headSha;
      expect(
        yield* publication.publish({
          ...input(fixture),
          candidateId: next.captured.candidateId,
          validationRunId: next.validationRunId,
          now: "2026-07-22T10:05:00.000Z",
        }),
      ).toMatchObject({ ok: true, created: false });
      expect(updates).toContainEqual(
        expect.objectContaining({
          number: 42,
          expectedCurrentHeadSha: fixture.captured.headSha,
          expectedHeadSha: next.captured.headSha,
        }),
      );

      remote = { ...remote, headSha: "foreign-head" };
      const third = yield* nextCandidate(fixture, "Third Candidate", "2026-07-22T10:10:00.000Z");
      branchHead = third.captured.headSha;
      expect(
        yield* publication.publish({
          ...input(fixture),
          candidateId: third.captured.candidateId,
          validationRunId: third.validationRunId,
          now: "2026-07-22T10:10:00.000Z",
        }),
      ).toEqual({ ok: false, code: "publication_remote_mismatch" });
      expect(updates).toHaveLength(1);
      expect(yield* fixture.changes.getChangeById(fixture.captured.changeId)).toMatchObject({
        publication: {
          candidateId: next.captured.candidateId,
          expectedHeadSha: next.captured.headSha,
        },
      });
    }),
  ),
);

type Captured = Extract<CaptureLocalCandidateResult, { readonly ok: true }>;
type Fixture = {
  readonly root: string;
  readonly captured: Captured;
  readonly changes: ChangePersistence;
  readonly validation: ChangeValidationPersistence;
  readonly validationRunId: string;
};

const withFixture = <A, E>(use: (fixture: Fixture) => Effect.Effect<A, E, RepositorySql>) => {
  const root = candidateReadyRepo();
  return Effect.gen(function* () {
    const captured = yield* captureLocalCandidate({ cwd: root, now });
    if (!captured.ok) throw new Error(captured.code);
    return yield* withTestRepository(
      root,
      Effect.gen(function* () {
        const repository = yield* RepositorySql;
        yield* repository.operation(
          "complete publication Change fixture",
          (sql) => sql`
          UPDATE changes
          SET starting_commit = ${git(root, "rev-parse", "refs/heads/main")}, worktree_path = ${root}
          WHERE id = ${captured.changeId}
        `,
        );
        const changes = yield* openSqliteChangePersistence();
        const validation = yield* openSqliteChangeValidationPersistence();
        const validationRunId = yield* completeValidation(validation, captured, now);
        return yield* use({ root, captured, changes, validation, validationRunId });
      }),
    );
  });
};

const completeValidation = (
  validation: ChangeValidationPersistence,
  captured: Captured,
  at: string,
) =>
  Effect.gen(function* () {
    const run = yield* validation.startOrReuse({
      candidateId: captured.candidateId,
      headSha: captured.headSha,
      policy,
      now: at,
    });
    if (run.reused) throw new Error("Expected a new Validation Run");
    yield* validation.complete({
      validationRunId: run.validationRunId,
      outcome: "passed",
      now: at,
    });
    return run.validationRunId;
  });

const nextCandidate = (fixture: Fixture, subject: string, at: string) =>
  Effect.gen(function* () {
    git(fixture.root, "commit", "--allow-empty", "-m", subject);
    const captured = yield* captureLocalCandidate({ cwd: fixture.root, now: at });
    if (!captured.ok) throw new Error(captured.code);
    const validationRunId = yield* completeValidation(fixture.validation, captured, at);
    return { captured, validationRunId };
  });

const input = (fixture: Fixture) => ({
  changeId: fixture.captured.changeId,
  candidateId: fixture.captured.candidateId,
  validationRunId: fixture.validationRunId,
  policy,
  target,
  now,
});

const pullRequest = (headSha: string) => ({
  number: 42,
  url: "https://github.com/acme/widgets/pull/42",
  baseBranch: "main",
  headBranch: "feature",
  headSha,
});

const successfulCreation = (requests: unknown[]) => ({
  findPullRequests: () => [],
  getPullRequest: () => undefined,
  createPullRequest: (request: GitHubPullRequestRequest) => {
    requests.push(request);
    return { ok: true as const, pullRequest: pullRequest(request.expectedHeadSha) };
  },
  updatePullRequest: () => {
    throw new Error("Unexpected PR update");
  },
});
