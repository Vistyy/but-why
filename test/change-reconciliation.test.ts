import { execFileSync } from "node:child_process";
import { chmodSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { describe } from "vitest";

import { openChangeReconciliation } from "../src/change/reconcileChange.js";
import type { GitHubPullRequest } from "../src/change/ownedPullRequestGateway.js";
import { openSqliteChangePersistence } from "../src/sqlite/sqliteChangePersistence.js";
import { runByWithEnv } from "./support/by-cli.js";
import { createTestWorkspace } from "./support/testWorkspace.js";
import { createInitializedRepo } from "./support/initializedRepo.js";
import { withTestRepository } from "./support/repository.js";

const now = "2026-07-24T10:00:00.000Z";
const pathEnvironmentVariable = "PATH";

describe("by change reconcile", () => {
  it.effect(
    "returns an open owned PR at its expected head without mutation",
    () =>
      Effect.gen(function* () {
        const repository = initializedRepository();
        const started = startChangeProcess(repository, "--output", "json");
        const change = JSON.parse(started.stdout) as ChangeProcessOutput;
        const headSha = git(change.worktreePath, "rev-parse", "HEAD");
        const target = publicationTarget;
        const headBranch = change.branch.slice("refs/heads/".length);
        yield* recordPublishedPullRequest(
          repository,
          change.change.id,
          target,
          headBranch,
          headSha,
        );

        const ghDirectory = createTestWorkspace();
        writeFileSync(
          join(ghDirectory, "gh"),
          `#!/bin/sh\nprintf '%s\\n' '${JSON.stringify(openPullRequest(target, headBranch, headSha))}'\n`,
        );
        chmodSync(join(ghDirectory, "gh"), 0o755);

        const result = runByWithEnv(
          change.worktreePath,
          { PATH: `${ghDirectory}:${process.env[pathEnvironmentVariable] ?? ""}` },
          "change",
          "reconcile",
          change.change.id,
          "--output",
          "json",
        );

        expect(result.status).toBe(0);
        expect(JSON.parse(result.stdout)).toEqual({
          changes: [
            {
              changeId: change.change.id,
              status: "open",
              pullRequest: { number: 42, url: "https://github.com/acme/widgets/pull/42" },
            },
          ],
        });
        expect(yield* readChange(repository, change.change.id)).toMatchObject({ state: "open" });
      }),
    15_000,
  );

  it.effect(
    "leaves a closed unmerged owned pull request and its Change open",
    () =>
      Effect.gen(function* () {
        const repository = initializedRepository();
        const started = startChangeProcess(repository, "--output", "json");
        const change = JSON.parse(started.stdout) as ChangeProcessOutput;
        const headSha = git(change.worktreePath, "rev-parse", "HEAD");
        const headBranch = change.branch.slice("refs/heads/".length);
        yield* recordPublishedPullRequest(
          repository,
          change.change.id,
          publicationTarget,
          headBranch,
          headSha,
        );

        yield* withTestRepository(
          repository,
          Effect.gen(function* () {
            const changes = yield* openSqliteChangePersistence();
            const reconciliation = openChangeReconciliation({
              persistence: changes,
              github: {
                findPullRequests: () => [],
                getPullRequest: () => ({
                  number: 42,
                  url: "https://github.com/acme/widgets/pull/42",
                  repository: { owner: publicationTarget.owner, repo: publicationTarget.repo },
                  state: "closed",
                  merged: false,
                  baseBranch: publicationTarget.baseBranch,
                  headBranch,
                  headSha,
                }),
                createPullRequest: () => {
                  throw new Error("Reconciliation must not create a pull request");
                },
                updatePullRequest: () => {
                  throw new Error("Reconciliation must not update a pull request");
                },
              },
              cleanup: () => {
                throw new Error("Open Changes must not be cleaned");
              },
            });

            expect(
              yield* reconciliation.reconcile({
                repositoryCommonDirectory: join(repository, ".git"),
                changeId: change.change.id,
                now,
              }),
            ).toEqual({
              rejected: false,
              changes: [
                {
                  changeId: change.change.id,
                  status: "closed_unmerged",
                  pullRequest: {
                    number: 42,
                    url: "https://github.com/acme/widgets/pull/42",
                  },
                },
              ],
            });
          }),
        );
        expect(yield* readChange(repository, change.change.id)).toMatchObject({ state: "open" });
      }),
    15_000,
  );

  it.effect(
    "rejects unexpected pull request ownership facts without adopting them",
    () =>
      Effect.gen(function* () {
        const repository = initializedRepository();
        const started = startChangeProcess(repository, "--output", "json");
        const change = JSON.parse(started.stdout) as ChangeProcessOutput;
        const headSha = git(change.worktreePath, "rev-parse", "HEAD");
        const headBranch = change.branch.slice("refs/heads/".length);
        yield* recordPublishedPullRequest(
          repository,
          change.change.id,
          publicationTarget,
          headBranch,
          headSha,
        );
        const expected: GitHubPullRequest = {
          number: 42,
          url: "https://github.com/acme/widgets/pull/42",
          repository: { owner: publicationTarget.owner, repo: publicationTarget.repo },
          state: "open",
          merged: false,
          baseBranch: publicationTarget.baseBranch,
          headBranch,
          headSha,
        };
        const unexpected: readonly GitHubPullRequest[] = [
          { ...expected, repository: { owner: "other", repo: publicationTarget.repo } },
          { ...expected, baseBranch: "release" },
          { ...expected, headBranch: "other-feature" },
          { ...expected, headSha: "unexpected-head" },
        ];

        yield* withTestRepository(
          repository,
          Effect.gen(function* () {
            const changes = yield* openSqliteChangePersistence();
            for (const pullRequest of unexpected) {
              const reconciliation = openChangeReconciliation({
                persistence: changes,
                github: {
                  findPullRequests: () => [],
                  getPullRequest: () => pullRequest,
                  createPullRequest: () => {
                    throw new Error("Reconciliation must not create a pull request");
                  },
                  updatePullRequest: () => {
                    throw new Error("Reconciliation must not update a pull request");
                  },
                },
                cleanup: () => {
                  throw new Error("Rejected Changes must not be cleaned");
                },
              });
              expect(
                yield* reconciliation.reconcile({
                  repositoryCommonDirectory: join(repository, ".git"),
                  changeId: change.change.id,
                  now,
                }),
              ).toMatchObject({
                rejected: true,
                changes: [{ changeId: change.change.id, status: "rejected" }],
              });
            }
          }),
        );
        expect(yield* readChange(repository, change.change.id)).toMatchObject({ state: "open" });
      }),
    30_000,
  );

  it.effect(
    "atomically completes a merged Change and its linked Task before cleanup",
    () =>
      Effect.gen(function* () {
        const repository = initializedRepository();
        const taskId = createApprovedTaskProcess(repository);
        const started = startChangeProcess(repository, "--task", taskId, "--output", "json");
        const change = JSON.parse(started.stdout) as ChangeProcessOutput;
        const headSha = git(change.worktreePath, "rev-parse", "HEAD");
        const target = publicationTarget;
        const headBranch = change.branch.slice("refs/heads/".length);
        yield* recordPublishedPullRequest(
          repository,
          change.change.id,
          target,
          headBranch,
          headSha,
        );

        const result = reconcileWithPullRequest(
          repository,
          mergedPullRequest(target, headBranch, headSha),
          change.change.id,
        );

        expect(result.status).toBe(0);
        expect(JSON.parse(result.stdout)).toMatchObject({
          changes: [
            {
              changeId: change.change.id,
              status: "completed",
              cleanup: { state: "complete", blockingReason: null },
            },
          ],
        });
        expect(yield* readChange(repository, change.change.id)).toMatchObject({
          state: "closed",
          closeReason: "completed",
          cleanup: { state: "complete", blockingReason: null },
        });
        expect(runByWithEnv(repository, {}, "task", "show", taskId).stdout).toContain(
          "state: done",
        );
      }),
    15_000,
  );

  it.effect(
    "retains unsafe cleanup with its blocking reason after completing a merged Change",
    () =>
      Effect.gen(function* () {
        const repository = initializedRepository();
        const started = startChangeProcess(repository, "--output", "json");
        const change = JSON.parse(started.stdout) as ChangeProcessOutput;
        const headSha = git(change.worktreePath, "rev-parse", "HEAD");
        writeFileSync(join(change.worktreePath, "uncommitted.txt"), "preserve this work\n");
        const target = publicationTarget;
        const headBranch = change.branch.slice("refs/heads/".length);
        yield* recordPublishedPullRequest(
          repository,
          change.change.id,
          target,
          headBranch,
          headSha,
        );

        const result = reconcileWithPullRequest(
          repository,
          mergedPullRequest(target, headBranch, headSha),
          change.change.id,
        );

        expect(result.status).toBe(0);
        expect(JSON.parse(result.stdout)).toMatchObject({
          changes: [
            {
              changeId: change.change.id,
              status: "completed",
              cleanup: { state: "pending", blockingReason: "worktree_has_uncommitted_changes" },
            },
          ],
        });
        expect(yield* readChange(repository, change.change.id)).toMatchObject({
          state: "closed",
          cleanup: { state: "pending", blockingReason: "worktree_has_uncommitted_changes" },
        });
      }),
    15_000,
  );
});

type ChangeProcessOutput = {
  readonly change: { readonly id: string };
  readonly branch: string;
  readonly worktreePath: string;
};

const publicationTarget = {
  owner: "acme",
  repo: "widgets",
  baseBranch: "main",
  remoteName: "origin",
} as const;

const recordPublishedPullRequest = (
  repository: string,
  changeId: string,
  target: typeof publicationTarget,
  headBranch: string,
  expectedHeadSha: string,
) =>
  withTestRepository(
    repository,
    Effect.gen(function* () {
      const changes = yield* openSqliteChangePersistence();
      const publication = {
        changeId,
        candidateId: "candidate-1",
        validationRunId: "validation-run-1",
        target,
        headBranch,
        expectedHeadSha,
        now,
      };
      const begun = yield* changes.beginPublication(publication);
      if (!begun.ok) throw new Error(begun.code);
      const recorded = yield* changes.recordPublishedPullRequest({
        ...publication,
        pullRequest: { number: 42, url: "https://github.com/acme/widgets/pull/42" },
      });
      if (!recorded.ok) throw new Error(recorded.code);
    }),
  );

const readChange = (repository: string, changeId: string) =>
  withTestRepository(
    repository,
    Effect.gen(function* () {
      const changes = yield* openSqliteChangePersistence();
      return yield* changes.getChangeById(changeId);
    }),
  );

const createApprovedTaskProcess = (repository: string): string => {
  const descriptionPath = join(repository, "task.md");
  writeFileSync(descriptionPath, "Complete me");
  const created = runByWithEnv(
    repository,
    { BUT_WHY_NOW: now },
    "task",
    "create",
    "--title",
    "Merged Change",
    "--description-file",
    descriptionPath,
    "--output",
    "json",
  );
  if (created.status !== 0) throw new Error(created.stdout || created.stderr);
  const taskId = (JSON.parse(created.stdout) as { readonly task: { readonly id: string } }).task.id;
  const approved = runByWithEnv(repository, { BUT_WHY_NOW: now }, "task", "approve", taskId);
  if (approved.status !== 0) throw new Error(approved.stdout || approved.stderr);
  return taskId;
};

const startChangeProcess = (repository: string, ...args: readonly string[]) =>
  runByWithEnv(repository, { BUT_WHY_NOW: now }, "change", "start", ...args);

const reconcileWithPullRequest = (repository: string, pullRequest: object, changeId: string) => {
  const ghDirectory = createTestWorkspace();
  writeFileSync(
    join(ghDirectory, "gh"),
    `#!/bin/sh\nprintf '%s\\n' '${JSON.stringify(pullRequest)}'\n`,
  );
  chmodSync(join(ghDirectory, "gh"), 0o755);
  return runByWithEnv(
    repository,
    { PATH: `${ghDirectory}:${process.env[pathEnvironmentVariable] ?? ""}` },
    "change",
    "reconcile",
    changeId,
    "--output",
    "json",
  );
};

const initializedRepository = (): string => {
  const repository = createInitializedRepo();
  git(repository, "config", "user.name", "But Why Test");
  git(repository, "config", "user.email", "but-why@example.test");
  git(repository, "branch", "-M", "main");
  writeFileSync(join(repository, "README.md"), "# Test repository\n");
  git(repository, "add", "README.md", ".gitignore", ".but-why/config.json");
  git(repository, "commit", "-m", "Initialize repository");
  git(repository, "remote", "add", "origin", repository);
  git(repository, "update-ref", "refs/remotes/origin/main", "refs/heads/main");
  git(repository, "symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main");
  return repository;
};

const openPullRequest = (
  target: { readonly owner: string; readonly repo: string; readonly baseBranch: string },
  headBranch: string,
  headSha: string,
) => ({
  number: 42,
  url: "https://github.com/acme/widgets/pull/42",
  state: "open",
  merged: false,
  base: { ref: target.baseBranch, repo: { owner: { login: target.owner }, name: target.repo } },
  head: { ref: headBranch, sha: headSha },
});

const mergedPullRequest = (
  target: { readonly owner: string; readonly repo: string; readonly baseBranch: string },
  headBranch: string,
  headSha: string,
) => ({ ...openPullRequest(target, headBranch, headSha), state: "closed", merged: true });

const git = (cwd: string, ...args: readonly string[]): string =>
  execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
