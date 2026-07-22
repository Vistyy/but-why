import { expect, it } from "@effect/vitest";
import { Effect } from "effect";

import { openCandidatePublication } from "../src/publication/candidatePublication.js";
import { RepositorySql } from "../src/sqlite/repositorySql.js";
import { openSqliteChangePersistence } from "../src/sqlite/sqliteChangePersistence.js";
import { openSqliteChangeValidationPersistence } from "../src/sqlite/sqliteChangeValidationPersistence.js";
import { captureLocalCandidate } from "./support/changeCandidateCapture.js";
import { candidateReadyRepo, git } from "./support/candidateReadyRepo.js";
import { withTestRepository } from "./support/repository.js";

const now = "2026-07-22T10:00:00.000Z";
const policy = {
  sandboxMode: "none" as const,
  checks: [],
  copyFiles: [],
  specialistReviews: [],
};

it.scoped("recovers a created pull request after its response is lost", () =>
  Effect.gen(function* () {
    const root = candidateReadyRepo();
    const captured = yield* captureLocalCandidate({ cwd: root, now });
    if (!captured.ok) throw new Error(captured.code);

    yield* withTestRepository(
      root,
      Effect.gen(function* () {
        const repository = yield* RepositorySql;
        yield* repository.operation(
          "complete publication Change fixture",
          (sql) => sql`
          UPDATE changes
          SET
            starting_commit = ${git(root, "rev-parse", "refs/heads/main")},
            worktree_path = ${root}
          WHERE id = ${captured.changeId}
        `,
        );
        const changes = yield* openSqliteChangePersistence();
        const validation = yield* openSqliteChangeValidationPersistence();
        const run = yield* validation.startOrReuse({
          candidateId: captured.candidateId,
          headSha: captured.headSha,
          policy,
          now,
        });
        if (run.reused) throw new Error("Expected a new Validation Run");
        yield* validation.complete({
          validationRunId: run.validationRunId,
          outcome: "passed",
          now,
        });

        const remotePullRequests: {
          readonly number: number;
          readonly url: string;
          readonly baseBranch: string;
          readonly headBranch: string;
          readonly headSha: string;
        }[] = [];
        let createCalls = 0;
        const publication = openCandidatePublication({
          changePersistence: changes,
          validationPersistence: validation,
          git: {
            readBranchHead: () => captured.headSha,
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
              throw new Error("Recovery must not update the pull request");
            },
          },
        });
        const input = {
          changeId: captured.changeId,
          candidateId: captured.candidateId,
          validationRunId: run.validationRunId,
          policy,
          target: {
            owner: "acme",
            repo: "widgets",
            baseBranch: "main",
            remoteName: "origin",
          },
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
  }),
);
