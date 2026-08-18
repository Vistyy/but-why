import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createInitializedRepo } from "./initializedRepo.js";
import { runTestProcess } from "./testProcess.js";

export const candidateReadyRepo = (workspace?: string): string => {
  const root = createInitializedRepo(workspace);
  git(root, "config", "user.email", "test@example.com");
  git(root, "config", "user.name", "Test User");
  git(root, "checkout", "-b", "main");
  git(root, "commit", "--allow-empty", "-m", "main");
  git(root, "remote", "add", "origin", "https://example.com/origin.git");
  git(root, "update-ref", "refs/remotes/origin/main", "refs/heads/main");
  git(root, "symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main");
  writeFileSync(join(root, ".gitignore"), "");
  git(root, "add", ".gitignore", ".but-why/config.json");
  git(root, "commit", "-m", "initialize but why");
  git(root, "checkout", "-b", "feature");
  git(root, "commit", "--allow-empty", "-m", "feature");
  const database = new DatabaseSync(join(root, ".git", "but-why", "state.sqlite"));
  try {
    database
      .prepare(`
        INSERT INTO changes (
          id, branch_ref, base_ref, base_remote_url, worktree_path,
          reviewer_configuration, checks_definition, cleanup_pending
        ) VALUES (1, 'refs/heads/feature', 'refs/remotes/origin/main',
          'https://github.com/acme/widgets.git', ?,
          '{"acceptanceReview":null,"specialistReviews":[]}', '[]', 0)
      `)
      .run(root);
  } finally {
    database.close();
  }
  return root;
};

export const registerCandidateChange = (
  root: string,
  branchRef: string,
  worktreePath: string,
): void => {
  const database = new DatabaseSync(join(commonDirectory(root), "but-why", "state.sqlite"));
  try {
    database
      .prepare(`
        INSERT INTO changes (
          branch_ref, base_ref, base_remote_url, worktree_path,
          reviewer_configuration, checks_definition, cleanup_pending
        ) VALUES (?, 'refs/remotes/origin/main', 'https://github.com/acme/widgets.git', ?,
          '{"acceptanceReview":null,"specialistReviews":[]}', '[]', 0)
      `)
      .run(branchRef, worktreePath);
  } finally {
    database.close();
  }
};

export const setCandidateChangePolicy = (
  root: string,
  branchRef: string,
  policy: {
    readonly prepare?: { readonly command: string; readonly timeoutSeconds: number };
    readonly checks: readonly {
      readonly id: string;
      readonly command: string;
      readonly timeoutSeconds: number;
    }[];
    readonly reviewerConfiguration?: unknown;
  },
): void => {
  const database = new DatabaseSync(join(commonDirectory(root), "but-why", "state.sqlite"));
  try {
    database
      .prepare(`
        UPDATE changes
        SET prepare_definition = ?, checks_definition = ?,
          reviewer_configuration = COALESCE(?, reviewer_configuration)
        WHERE branch_ref = ?
      `)
      .run(
        policy.prepare === undefined ? null : JSON.stringify(policy.prepare),
        policy.checks.length === 0 ? null : JSON.stringify(policy.checks),
        policy.reviewerConfiguration === undefined
          ? null
          : JSON.stringify(policy.reviewerConfiguration),
        branchRef,
      );
  } finally {
    database.close();
  }
};

export const git = (cwd: string, ...args: readonly string[]): string => {
  const result = runTestProcess("git", args, { cwd });
  if (result.status !== 0) throw new Error(result.stderr);
  return result.stdout.trim();
};

export const commonDirectory = (root: string): string =>
  git(root, "rev-parse", "--path-format=absolute", "--git-common-dir");

export const candidateRepositoryConfig = (root: string) => ({
  statePath: join(commonDirectory(root), "but-why", "state.sqlite"),
  commonDirectory: commonDirectory(root),
});
