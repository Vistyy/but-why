import { expect, layer } from "@effect/vitest";
import { join } from "node:path";
import { Context, Effect, Layer } from "effect";
import { afterAll, beforeAll } from "vitest";

import type { ChangePersistence } from "../../src/change/changePersistence.js";
import type {
  GitHubPullRequest,
  GitHubPullRequestRequest,
} from "../../src/change/ownedPullRequestGateway.js";
import type { CaptureLocalCandidateResult } from "../../src/change/candidateCapture/captureLocalCandidate.js";
import type { ChangeValidationPersistence } from "../../src/change/validation/changeValidationPersistence.js";
import { openCandidatePublication } from "../../src/change/publication/candidatePublication.js";
import { RepositorySql } from "../../src/sqlite/repositorySql.js";
import { openSqliteChangePersistence } from "../../src/sqlite/sqliteChangePersistence.js";
import { openSqliteChangeValidationPersistence } from "../../src/sqlite/sqliteChangeValidationPersistence.js";
import { openSqliteCandidateCapturePersistence } from "../../src/sqlite/sqliteCandidateCapturePersistence.js";
import { captureLocalCandidate } from "../support/candidateCapture.js";
import { candidateReadyRepo, git } from "../support/candidateReadyRepo.js";
import { cloneInitializedRepositoryState } from "../support/initializedRepo.js";
import { withTestRepository } from "../support/repository.js";
import { acquireTestWorkspace, releaseTestWorkspace } from "../support/testWorkspace.js";

const now = "2026-07-22T10:00:00.000Z";
const policy = { checks: [], copyFiles: [], specialistReviews: [] };
const target = { owner: "acme", repo: "widgets", baseBranch: "main", remoteName: "origin" };
type Captured = Extract<CaptureLocalCandidateResult, { readonly ok: true }>;
let candidateRepoTemplate: string;

beforeAll(() => {
  candidateRepoTemplate = acquireTestWorkspace();
  candidateReadyRepo(candidateRepoTemplate);
});

afterAll(() => {
  releaseTestWorkspace(candidateRepoTemplate);
});

class PublicationTemplate extends Context.Tag("@but-why/PublicationTemplate")<
  PublicationTemplate,
  { readonly captured: Captured; readonly validationRunId: string }
>() {}

const publicationTemplateLayer = Layer.effect(
  PublicationTemplate,
  Effect.gen(function* () {
    const captured = yield* captureLocalCandidate({ cwd: candidateRepoTemplate, now });
    if (!captured.ok) return yield* Effect.dieMessage(`Candidate capture failed: ${captured.code}`);
    const validationRunId = yield* withTestRepository(
      candidateRepoTemplate,
      Effect.gen(function* () {
        const repository = yield* RepositorySql;
        yield* repository.operation(
          "complete publication Change fixture",
          (sql) => sql`
          UPDATE changes
          SET starting_commit = ${git(candidateRepoTemplate, "rev-parse", "refs/heads/main")},
              worktree_path = ${candidateRepoTemplate}
          WHERE id = ${captured.changeId}
        `,
        );
        const validation = yield* openSqliteChangeValidationPersistence();
        return yield* completeValidation(validation, captured, now);
      }),
    );
    return { captured, validationRunId };
  }),
);

layer(publicationTemplateLayer)("Candidate publication", (it) => {
  it.scoped("publishes exact taskless metadata only from matching policy evidence", () =>
    withFixture((fixture) =>
      Effect.gen(function* () {
        const requests: unknown[] = [];
        const publication = openCandidatePublication({
          changePersistence: fixture.changes,
          validationPersistence: fixture.validation,
          git: {
            readBranchHead: () => fixture.captured.headSha,
            readFirstNonMergeCommitSubject: () => ({
              ok: true,
              subject: "Add taskless publication",
            }),
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
        expect(yield* publication.publish(input(fixture))).toMatchObject({
          ok: true,
          created: true,
        });
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

  it.scoped("does not record an incomplete pull request creation response", () =>
    withFixture((fixture) =>
      Effect.gen(function* () {
        const { repository: _repository, ...incomplete } = pullRequest(fixture.captured.headSha);
        const publication = openCandidatePublication({
          changePersistence: fixture.changes,
          validationPersistence: fixture.validation,
          git: {
            readBranchHead: () => fixture.captured.headSha,
            readFirstNonMergeCommitSubject: () => ({ ok: true, subject: "Publication" }),
          },
          github: {
            findPullRequests: () => [],
            getPullRequest: () => undefined,
            createPullRequest: () => ({ ok: true, pullRequest: incomplete }),
            updatePullRequest: () => {
              throw new Error("Unexpected PR update");
            },
          },
        });

        expect(yield* publication.publish(input(fixture))).toMatchObject({
          ok: false,
          code: "publication_remote_mismatch",
          expectedRemoteHeadSha: fixture.captured.headSha,
          observedRemoteHeadSha: fixture.captured.headSha,
        });
        expect(yield* fixture.changes.getChangeById(fixture.captured.changeId)).toMatchObject({
          publication: { pullRequest: null },
        });
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
        expect(yield* publication.publish(input(fixture))).toMatchObject({
          ok: true,
          created: true,
        });
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

  it.scoped("publishes the latest Implementation Decision Log without claiming review", () =>
    withFixture((fixture) =>
      Effect.gen(function* () {
        const requests: unknown[] = [];
        const recorded = yield* fixture.changes.recordImplementationDecision({
          changeId: fixture.captured.changeId,
          content: "Keep the decision log separate from approved intent.",
          now,
        });
        expect(recorded.ok).toBe(true);
        const publication = openCandidatePublication({
          changePersistence: fixture.changes,
          validationPersistence: fixture.validation,
          git: {
            readBranchHead: () => fixture.captured.headSha,
            readFirstNonMergeCommitSubject: () => ({ ok: true, subject: "Decision publication" }),
          },
          github: successfulCreation(requests),
        });
        expect(yield* publication.publish(input(fixture))).toMatchObject({ ok: true });
        expect((requests[0] as { readonly body: string }).body).toContain(
          "Keep the decision log separate from approved intent.",
        );
        expect((requests[0] as { readonly body: string }).body).toContain(
          "Implementation Decision Log",
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

  it.scoped("confirms a stale update response before recording the Candidate", () =>
    withFixture((fixture) =>
      Effect.gen(function* () {
        let branchHead = fixture.captured.headSha;
        let remote = pullRequest(branchHead);
        const updates: unknown[] = [];
        const confirmationDelays: number[] = [];
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
              const staleResponse = remote;
              remote = pullRequest(request.expectedHeadSha);
              return { ok: true, pullRequest: staleResponse };
            },
          },
          delayBeforeConfirmation: (milliseconds) =>
            Effect.sync(() => {
              confirmationDelays.push(milliseconds);
            }),
        });
        expect(yield* publication.publish(input(fixture))).toMatchObject({ ok: true });

        yield* fixture.changes.recordImplementationDecision({
          changeId: fixture.captured.changeId,
          content: "Update the owned pull request with the current decision log.",
          now: "2026-07-22T10:04:00.000Z",
        });
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
            body: expect.stringContaining(
              "Update the owned pull request with the current decision log.",
            ),
          }),
        );
        expect(confirmationDelays).toEqual([100]);

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

  it.scoped("returns a remote mismatch after three stale confirmation reads", () =>
    withFixture((fixture) =>
      Effect.gen(function* () {
        let branchHead = fixture.captured.headSha;
        const remote = pullRequest(branchHead);
        let confirmationReads = 0;
        const confirmationDelays: number[] = [];
        const publication = openCandidatePublication({
          changePersistence: fixture.changes,
          validationPersistence: fixture.validation,
          git: {
            readBranchHead: () => branchHead,
            readFirstNonMergeCommitSubject: () => ({ ok: true, subject: "Publication" }),
          },
          github: {
            findPullRequests: () => [],
            getPullRequest: () => {
              confirmationReads += 1;
              return remote;
            },
            createPullRequest: () => ({ ok: true, pullRequest: remote }),
            updatePullRequest: () => ({ ok: true, pullRequest: remote }),
          },
          delayBeforeConfirmation: (milliseconds) =>
            Effect.sync(() => {
              confirmationDelays.push(milliseconds);
            }),
        });
        expect(yield* publication.publish(input(fixture))).toMatchObject({ ok: true });

        const next = yield* nextCandidate(fixture, "New Candidate", "2026-07-22T10:05:00.000Z");
        branchHead = next.captured.headSha;
        confirmationReads = 0;
        expect(
          yield* publication.publish({
            ...input(fixture),
            candidateId: next.captured.candidateId,
            validationRunId: next.validationRunId,
            now: "2026-07-22T10:05:00.000Z",
          }),
        ).toEqual({ ok: false, code: "publication_remote_mismatch" });
        expect(confirmationReads).toBe(4);
        expect(confirmationDelays).toEqual([100, 100, 100]);
        expect(yield* fixture.changes.getChangeById(fixture.captured.changeId)).toMatchObject({
          publication: {
            candidateId: fixture.captured.candidateId,
            expectedHeadSha: fixture.captured.headSha,
          },
        });
      }),
    ),
  );

  it.scoped("records a later Candidate already present on the owned pull request", () =>
    withFixture((fixture) =>
      Effect.gen(function* () {
        let branchHead = fixture.captured.headSha;
        let remote = pullRequest(branchHead);
        let updateCalls = 0;
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
            updatePullRequest: () => {
              updateCalls += 1;
              throw new Error("An already published Candidate must not be pushed again");
            },
          },
        });
        expect(yield* publication.publish(input(fixture))).toMatchObject({ ok: true });

        const next = yield* nextCandidate(fixture, "New Candidate", "2026-07-22T10:05:00.000Z");
        branchHead = next.captured.headSha;
        remote = pullRequest(next.captured.headSha);
        expect(
          yield* publication.publish({
            ...input(fixture),
            candidateId: next.captured.candidateId,
            validationRunId: next.validationRunId,
            now: "2026-07-22T10:05:00.000Z",
          }),
        ).toMatchObject({ ok: true, created: false, pullRequest: { number: 42 } });
        expect(updateCalls).toBe(0);
        expect(yield* fixture.changes.getChangeById(fixture.captured.changeId)).toMatchObject({
          publication: {
            candidateId: next.captured.candidateId,
            validationRunId: next.validationRunId,
            expectedHeadSha: next.captured.headSha,
          },
        });
      }),
    ),
  );

  it.scoped("rejects every mismatched owned pull request identity during later recovery", () =>
    Effect.forEach(
      [
        { name: "number", mutate: (value: GitHubPullRequest) => ({ ...value, number: 43 }) },
        {
          name: "base branch",
          mutate: (value: GitHubPullRequest) => ({ ...value, baseBranch: "release" }),
        },
        {
          name: "head branch",
          mutate: (value: GitHubPullRequest) => ({ ...value, headBranch: "other-change" }),
        },
        {
          name: "Candidate commit",
          mutate: (value: GitHubPullRequest) => ({ ...value, headSha: "other-candidate" }),
        },
        {
          name: "repository",
          mutate: (value: GitHubPullRequest) => ({
            ...value,
            repository: { owner: "other", repo: "widgets" },
          }),
        },
        {
          name: "missing state",
          mutate: ({ state: _state, ...value }: GitHubPullRequest) => value,
        },
        {
          name: "missing merged fact",
          mutate: ({ merged: _merged, ...value }: GitHubPullRequest) => value,
        },
        {
          name: "closed state",
          mutate: (value: GitHubPullRequest) => ({ ...value, state: "closed" as const }),
        },
        {
          name: "merged state",
          mutate: (value: GitHubPullRequest) => ({
            ...value,
            state: "closed" as const,
            merged: true,
          }),
        },
      ],
      ({ name, mutate }) =>
        withFixture((fixture) =>
          Effect.gen(function* () {
            let branchHead = fixture.captured.headSha;
            let remote: GitHubPullRequest = pullRequest(branchHead);
            let updateCalls = 0;
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
                updatePullRequest: () => {
                  updateCalls += 1;
                  return { ok: true, pullRequest: remote };
                },
              },
            });
            expect(yield* publication.publish(input(fixture))).toMatchObject({ ok: true });

            const next = yield* nextCandidate(
              fixture,
              `Reject mismatched ${name}`,
              "2026-07-22T10:05:00.000Z",
            );
            branchHead = next.captured.headSha;
            remote = mutate(pullRequest(next.captured.headSha));
            expect(
              yield* publication.publish({
                ...input(fixture),
                candidateId: next.captured.candidateId,
                validationRunId: next.validationRunId,
                now: "2026-07-22T10:05:00.000Z",
              }),
            ).toEqual({ ok: false, code: "publication_remote_mismatch" });
            expect(updateCalls).toBe(0);
            expect(yield* fixture.changes.getChangeById(fixture.captured.changeId)).toMatchObject({
              publication: {
                candidateId: fixture.captured.candidateId,
                expectedHeadSha: fixture.captured.headSha,
                pullRequest: { number: 42 },
              },
            });
          }),
        ),
      { concurrency: 1 },
    ),
  );

  it.scoped("recovers a created pull request after its response is lost", () =>
    withFixture((fixture) =>
      Effect.gen(function* () {
        const remotePullRequests: {
          readonly number: number;
          readonly url: string;
          readonly repository: { readonly owner: string; readonly repo: string };
          readonly state: "open";
          readonly merged: false;
          readonly baseBranch: string;
          readonly headBranch: string;
          readonly headSha: string;
        }[] = [];
        let createCalls = 0;
        const publication = openCandidatePublication({
          changePersistence: fixture.changes,
          validationPersistence: fixture.validation,
          git: {
            readBranchHead: () => fixture.captured.headSha,
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
                repository: { owner: request.owner, repo: request.repo },
                state: "open",
                merged: false,
                baseBranch: request.baseBranch,
                headBranch: request.headBranch,
                headSha: request.expectedHeadSha,
              });
              return { ok: false, code: "remote_response_lost" };
            },
            updatePullRequest: () => {
              throw new Error("Recovery must not update the pull request");
            },
          },
        });

        expect(yield* publication.publish(input(fixture))).toMatchObject({
          ok: true,
          created: true,
          pullRequest: { number: 42 },
        });
        expect(yield* publication.publish(input(fixture))).toMatchObject({
          ok: true,
          created: false,
          pullRequest: { number: 42 },
        });
        expect(createCalls).toBe(1);
      }),
    ),
  );
  it.scoped("rejects a newer Candidate when it does not contain the remote commit", () =>
    withFixture((fixture) =>
      Effect.gen(function* () {
        let branchHead = fixture.captured.headSha;
        const remote = pullRequest(fixture.captured.headSha);
        const publication = openCandidatePublication({
          changePersistence: fixture.changes,
          validationPersistence: fixture.validation,
          git: {
            readBranchHead: () => branchHead,
            containsCommit: () => false,
            readFirstNonMergeCommitSubject: () => ({ ok: true, subject: "Publication" }),
          },
          github: {
            findPullRequests: () => [remote],
            getPullRequest: () => remote,
            createPullRequest: () => ({ ok: false as const, code: "remote_rejected" as const }),
            updatePullRequest: () => ({ ok: true as const, pullRequest: remote }),
          },
        });
        expect(yield* publication.publish(input(fixture))).toMatchObject({ ok: false });
        const next = yield* nextCandidate(
          fixture,
          "Untrusted Candidate",
          "2026-07-25T15:30:00.000Z",
        );
        branchHead = next.captured.headSha;
        expect(
          yield* publication.publish({
            ...input(fixture),
            candidateId: next.captured.candidateId,
            validationRunId: next.validationRunId,
            now: "2026-07-25T15:30:00.000Z",
          }),
        ).toMatchObject({
          ok: false,
          code: "publication_remote_mismatch",
          observedRemoteHeadSha: fixture.captured.headSha,
        });
      }),
    ),
  );

  it.scoped("retains the marker after a known recovery rejection", () =>
    withFixture((fixture) =>
      Effect.gen(function* () {
        let creates = 0;
        const publication = openCandidatePublication({
          changePersistence: fixture.changes,
          validationPersistence: fixture.validation,
          git: {
            readBranchHead: () => fixture.captured.headSha,
            readFirstNonMergeCommitSubject: () => ({ ok: true, subject: "Publication" }),
          },
          github: {
            findPullRequests: () => [],
            getPullRequest: () => undefined,
            createPullRequest: () => {
              creates += 1;
              return {
                ok: false as const,
                code: "remote_rejected" as const,
                evidence: {
                  operation: "pull_request_creation" as const,
                  classification: "rejected" as const,
                  exitStatus: 422,
                },
              };
            },
            updatePullRequest: () => {
              throw new Error("Unexpected update");
            },
          },
        });
        expect(yield* publication.publish(input(fixture))).toMatchObject({ ok: false });
        const next = yield* nextCandidate(fixture, "Rejected Recovery", "2026-07-25T15:35:00.000Z");
        expect(
          yield* publication.publish({
            ...input(fixture),
            candidateId: next.captured.candidateId,
            validationRunId: next.validationRunId,
            now: "2026-07-25T15:35:00.000Z",
          }),
        ).toMatchObject({
          ok: false,
          code: "publication_tooling_failed",
          evidence: { operation: "pull_request_creation", exitStatus: 422 },
        });
        expect(creates).toBe(2);
        expect(yield* fixture.changes.getChangeById(fixture.captured.changeId)).toMatchObject({
          publication: { candidateId: next.captured.candidateId, pullRequest: null },
        });
      }),
    ),
  );

  it.scoped("reuses the exact old pull request for a newer Candidate", () =>
    withFixture((fixture) =>
      Effect.gen(function* () {
        let branchHead = fixture.captured.headSha;
        const oldPullRequest = pullRequest(fixture.captured.headSha);
        let updates = 0;
        const publication = openCandidatePublication({
          changePersistence: fixture.changes,
          validationPersistence: fixture.validation,
          git: {
            readBranchHead: () => branchHead,
            containsCommit: () => true,
            readFirstNonMergeCommitSubject: () => ({ ok: true, subject: "Publication" }),
          },
          github: {
            findPullRequests: () => [oldPullRequest],
            getPullRequest: () => oldPullRequest,
            createPullRequest: () => ({ ok: false as const, code: "remote_rejected" as const }),
            updatePullRequest: (request) => {
              updates += 1;
              return { ok: true as const, pullRequest: pullRequest(request.expectedHeadSha) };
            },
          },
        });
        expect(yield* publication.publish(input(fixture))).toMatchObject({
          ok: false,
          code: "publication_tooling_failed",
        });
        const next = yield* nextCandidate(
          fixture,
          "Recovered Candidate",
          "2026-07-25T15:40:00.000Z",
        );
        branchHead = next.captured.headSha;
        const recovered = yield* publication.publish({
          ...input(fixture),
          candidateId: next.captured.candidateId,
          validationRunId: next.validationRunId,
          now: "2026-07-25T15:40:00.000Z",
        });
        expect(recovered).toMatchObject({ ok: true, created: false, pullRequest: { number: 42 } });
        expect(updates).toBe(1);
      }),
    ),
  );

  it.scoped("bounds empty recovery creation and final confirmation", () =>
    withFixture((fixture) =>
      Effect.gen(function* () {
        let branchHead = fixture.captured.headSha;
        let createCalls = 0;
        const publication = openCandidatePublication({
          changePersistence: fixture.changes,
          validationPersistence: fixture.validation,
          git: {
            readBranchHead: () => branchHead,
            readFirstNonMergeCommitSubject: () => ({ ok: true, subject: "Publication" }),
          },
          github: {
            findPullRequests: () => [],
            getPullRequest: () => undefined,
            createPullRequest: () => {
              createCalls += 1;
              return createCalls === 1
                ? { ok: false as const, code: "remote_rejected" as const }
                : { ok: false as const, code: "remote_response_lost" as const };
            },
            updatePullRequest: () => {
              throw new Error("Recovery must not update the pull request");
            },
          },
        });
        expect(yield* publication.publish(input(fixture))).toMatchObject({
          ok: false,
          code: "publication_tooling_failed",
        });
        const next = yield* nextCandidate(
          fixture,
          "Recovery Candidate",
          "2026-07-25T16:00:00.000Z",
        );
        branchHead = next.captured.headSha;
        expect(
          yield* publication.publish({
            ...input(fixture),
            candidateId: next.captured.candidateId,
            validationRunId: next.validationRunId,
            now: "2026-07-25T16:00:00.000Z",
          }),
        ).toMatchObject({ ok: false, code: "publication_creation_unconfirmed" });
        expect(createCalls).toBe(2);
        expect(
          yield* publication.publish({
            ...input(fixture),
            candidateId: next.captured.candidateId,
            validationRunId: next.validationRunId,
            now: "2026-07-25T16:01:00.000Z",
          }),
        ).toMatchObject({ ok: false, code: "publication_creation_unconfirmed" });
        expect(createCalls).toBe(3);
        expect(yield* fixture.changes.getChangeById(fixture.captured.changeId)).toMatchObject({
          publication: {
            candidateId: next.captured.candidateId,
            expectedHeadSha: next.captured.headSha,
            pullRequest: null,
          },
        });
      }),
    ),
  );

  it.scoped("retains the marker when remote branch state is unavailable", () =>
    withFixture((fixture) =>
      Effect.gen(function* () {
        const publication = openCandidatePublication({
          changePersistence: fixture.changes,
          validationPersistence: fixture.validation,
          git: {
            readBranchHead: () => fixture.captured.headSha,
            readFirstNonMergeCommitSubject: () => ({ ok: true, subject: "Publication" }),
          },
          github: {
            findPullRequests: () => [],
            getPullRequest: () => undefined,
            createPullRequest: () => ({
              ok: false as const,
              code: "remote_lookup_failed" as const,
              evidence: {
                operation: "remote_lookup" as const,
                classification: "unavailable" as const,
              },
            }),
            updatePullRequest: () => {
              throw new Error("Unexpected update");
            },
          },
        });
        expect(yield* publication.publish(input(fixture))).toMatchObject({
          ok: false,
          code: "publication_tooling_failed",
          evidence: { operation: "remote_lookup", classification: "unavailable" },
        });
        expect(yield* fixture.changes.getChangeById(fixture.captured.changeId)).toMatchObject({
          publication: { candidateId: fixture.captured.candidateId, pullRequest: null },
        });
      }),
    ),
  );

  it.scoped("does not create after a conflicting non-empty recovery lookup", () =>
    withFixture((fixture) =>
      Effect.gen(function* () {
        let creates = 0;
        const publication = openCandidatePublication({
          changePersistence: fixture.changes,
          validationPersistence: fixture.validation,
          git: {
            readBranchHead: () => fixture.captured.headSha,
            readFirstNonMergeCommitSubject: () => ({ ok: true, subject: "Publication" }),
          },
          github: {
            findPullRequests: () => [pullRequest("foreign-head")],
            getPullRequest: () => undefined,
            createPullRequest: () => {
              creates += 1;
              return { ok: false as const, code: "remote_response_lost" as const };
            },
            updatePullRequest: () => {
              throw new Error("Unexpected update");
            },
          },
        });
        expect(yield* publication.publish(input(fixture))).toMatchObject({
          ok: false,
          code: "publication_lookup_ambiguous",
        });
        expect(creates).toBe(1);
        expect(yield* fixture.changes.getChangeById(fixture.captured.changeId)).toMatchObject({
          publication: { pullRequest: null },
        });
      }),
    ),
  );
});

type Fixture = {
  readonly root: string;
  readonly captured: Captured;
  readonly changes: ChangePersistence;
  readonly validation: ChangeValidationPersistence;
  readonly validationRunId: string;
};

const withFixture = <A, E>(use: (fixture: Fixture) => Effect.Effect<A, E, RepositorySql>) =>
  Effect.gen(function* () {
    const template = yield* PublicationTemplate;
    const root = yield* cloneInitializedRepositoryState(candidateRepoTemplate);
    return yield* withTestRepository(
      root,
      Effect.gen(function* () {
        const changes = yield* openSqliteChangePersistence();
        const validation = yield* openSqliteChangeValidationPersistence();
        return yield* use({
          root,
          captured: template.captured,
          changes,
          validation,
          validationRunId: template.validationRunId,
        });
      }),
    );
  });

function completeValidation(
  validation: ChangeValidationPersistence,
  captured: Captured,
  at: string,
) {
  return Effect.gen(function* () {
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
}

const nextCandidate = (fixture: Fixture, subject: string, at: string) =>
  Effect.gen(function* () {
    const headSha = `${subject}-head`;
    const capture = yield* openSqliteCandidateCapturePersistence();
    const result = yield* capture.commitCapture({
      repositoryCommonDirectory: join(fixture.root, ".git"),
      branchRef: "refs/heads/feature",
      expectedChangeId: fixture.captured.changeId,
      baseRef: "refs/remotes/origin/main",
      changeBaseSha: fixture.captured.changeBaseSha,
      headSha,
      now: at,
    });
    if (!result.ok) throw new Error(result.code);
    const captured: Captured = {
      ok: true,
      changeId: result.changeId,
      candidateId: result.candidateId,
      branchRef: "refs/heads/feature",
      changeBaseSha: fixture.captured.changeBaseSha,
      headSha,
      trackedTreeMatchesChangeBase: false,
    };
    const validationRunId = yield* completeValidation(fixture.validation, captured, at);
    return { captured, validationRunId };
  });

const input = (fixture: Fixture) => ({
  changeId: fixture.captured.changeId,
  candidateId: fixture.captured.candidateId,
  validationRunId: fixture.validationRunId,
  changeBaseSha: fixture.captured.changeBaseSha,
  policy,
  target,
  now,
});

const pullRequest = (headSha: string) => ({
  number: 42,
  url: "https://github.com/acme/widgets/pull/42",
  repository: { owner: "acme", repo: "widgets" },
  state: "open" as const,
  merged: false,
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
