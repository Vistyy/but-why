import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

import { createSandbox, type Sandbox } from "@ai-hero/sandcastle";
import { noSandbox } from "@ai-hero/sandcastle/sandboxes/no-sandbox";

import type { CleanupState } from "../repoState.js";

export type ValidationWorkspaceCleanupResult = {
  readonly worktree: CleanupState;
  readonly tempRef: CleanupState;
};

export type ValidationWorkspaceSetup = {
  readonly runId: string;
  readonly tempRefName: string;
  readonly submittedSha: string;
  readonly worktreePath: string;
  readonly worktreeHead: string;
  readonly cleanupResult: ValidationWorkspaceCleanupResult;
};

export type ValidationWorkspaceToolingError = {
  readonly operationName: string;
  readonly tempRefName: string;
  readonly submittedSha: string;
  readonly worktreePath?: string;
  readonly errorMessage: string;
  readonly cleanupResult: ValidationWorkspaceCleanupResult;
};

export type CreateValidationWorkspaceInput = {
  readonly repoRoot: string;
  readonly runId: string;
  readonly submittedSha: string;
  readonly copyFiles: readonly string[];
};

export type CreateValidationWorkspaceResult =
  | {
      readonly ok: true;
      readonly setup: ValidationWorkspaceSetup;
    }
  | {
      readonly ok: false;
      readonly toolingError: ValidationWorkspaceToolingError;
    };

const zeroSha = "0000000000000000000000000000000000000000";

export const createValidationWorkspace = async (
  input: CreateValidationWorkspaceInput,
): Promise<CreateValidationWorkspaceResult> => {
  const tempRefName = validationTempRefName(input.runId);
  const expectedWorktreePath = expectedSandcastleWorktreePath(input.repoRoot, tempRefName);
  let sandbox: Sandbox | undefined;
  let tempRefReady = false;
  let worktreePath: string | undefined;

  const fail = async (
    operationName: string,
    errorMessage: string,
  ): Promise<CreateValidationWorkspaceResult> => {
    const cleanupResult = await cleanupValidationWorkspace({
      repoRoot: input.repoRoot,
      tempRefName,
      sandbox,
      worktreePath,
      tempRefReady,
    });

    return {
      ok: false,
      toolingError: {
        operationName,
        tempRefName,
        submittedSha: input.submittedSha,
        worktreePath: worktreePath ?? expectedWorktreePath,
        errorMessage,
        cleanupResult,
      },
    };
  };

  const refResult = ensureValidationTempRef(input.repoRoot, tempRefName, input.submittedSha);

  if (!refResult.ok) {
    return fail("create_temp_ref", refResult.message);
  }

  tempRefReady = true;

  for (const path of input.copyFiles) {
    if (!existsSync(join(input.repoRoot, path))) {
      return fail(
        "copy_allowlisted_file",
        `Allowlisted validation workspace file is missing: ${path}`,
      );
    }
  }

  const existingWorktree = inspectExistingWorktree(expectedWorktreePath);

  if (
    existingWorktree.exists &&
    existingWorktree.branch !== undefined &&
    existingWorktree.branch !== "HEAD" &&
    existingWorktree.branch !== tempRefName
  ) {
    return fail(
      "create_sandcastle_workspace",
      `Validation worktree already exists for a different Run: ${expectedWorktreePath}`,
    );
  }

  if (existingWorktree.exists && existingWorktree.head !== input.submittedSha) {
    return fail(
      "create_sandcastle_workspace",
      `Validation worktree already exists for a different commit: ${expectedWorktreePath}`,
    );
  }

  if (existingWorktree.exists && existingWorktree.dirty) {
    worktreePath = expectedWorktreePath;
    const removed = git(input.repoRoot, ["worktree", "remove", "--force", expectedWorktreePath]);

    if (!removed.ok && existsSync(expectedWorktreePath)) {
      return fail(
        "create_sandcastle_workspace",
        `Validation worktree already exists with uncommitted changes: ${expectedWorktreePath}`,
      );
    }

    worktreePath = undefined;
  }

  try {
    sandbox = await createSandbox({
      cwd: input.repoRoot,
      branch: tempRefName,
      sandbox: noSandbox(),
      copyToWorktree: [...input.copyFiles],
    });
  } catch (error) {
    worktreePath = expectedWorktreePath;
    return fail("create_sandcastle_workspace", errorMessage(error));
  }

  worktreePath = sandbox.worktreePath;
  const headResult = await sandbox.exec("git rev-parse HEAD");

  if (headResult.exitCode !== 0) {
    return fail(
      "create_sandcastle_workspace",
      [headResult.stderr, headResult.stdout].join("\n").trim(),
    );
  }

  const worktreeHead = headResult.stdout.trim();

  if (worktreeHead !== input.submittedSha) {
    return fail(
      "create_sandcastle_workspace",
      `Validation worktree HEAD ${worktreeHead} did not match submitted SHA ${input.submittedSha}.`,
    );
  }

  const cleanupResult = await cleanupValidationWorkspace({
    repoRoot: input.repoRoot,
    tempRefName,
    sandbox,
    worktreePath,
    tempRefReady,
  });

  if (cleanupResult.worktree === "failed" || cleanupResult.tempRef === "failed") {
    return {
      ok: false,
      toolingError: {
        operationName: "cleanup_validation_workspace",
        tempRefName,
        submittedSha: input.submittedSha,
        worktreePath,
        errorMessage: "Validation workspace cleanup failed after successful setup.",
        cleanupResult,
      },
    };
  }

  return {
    ok: true,
    setup: {
      runId: input.runId,
      tempRefName,
      submittedSha: input.submittedSha,
      worktreePath,
      worktreeHead,
      cleanupResult,
    },
  };
};

export const validationTempRefName = (runId: string): string =>
  `refs/but-why/runs/${runId}/validation`;

const expectedSandcastleWorktreePath = (repoRoot: string, tempRefName: string): string =>
  join(repoRoot, ".sandcastle", "worktrees", tempRefName.replaceAll("/", "-"));

const ensureValidationTempRef = (
  repoRoot: string,
  tempRefName: string,
  submittedSha: string,
): { readonly ok: true } | { readonly ok: false; readonly message: string } => {
  const existing = git(repoRoot, ["rev-parse", "--verify", `${tempRefName}^{commit}`]);

  if (existing.ok) {
    const existingSha = existing.stdout.trim();

    if (existingSha === submittedSha) {
      return { ok: true };
    }

    return {
      ok: false,
      message: `Validation temp ref ${tempRefName} already points to ${existingSha}, not ${submittedSha}.`,
    };
  }

  const created = git(repoRoot, ["update-ref", "--no-deref", tempRefName, submittedSha, zeroSha]);

  if (created.ok) {
    return { ok: true };
  }

  const raced = git(repoRoot, ["rev-parse", "--verify", `${tempRefName}^{commit}`]);

  if (raced.ok && raced.stdout.trim() === submittedSha) {
    return { ok: true };
  }

  return { ok: false, message: created.message };
};

const inspectExistingWorktree = (
  worktreePath: string,
):
  | { readonly exists: false }
  | {
      readonly exists: true;
      readonly branch: string | undefined;
      readonly head: string | undefined;
      readonly dirty: boolean;
    } => {
  if (!existsSync(worktreePath)) {
    return { exists: false };
  }

  const branch = git(worktreePath, ["rev-parse", "--symbolic-full-name", "HEAD"]);
  const head = git(worktreePath, ["rev-parse", "HEAD"]);
  const status = git(worktreePath, ["status", "--porcelain=v1"]);

  return {
    exists: true,
    branch: branch.ok ? branch.stdout.trim() : undefined,
    head: head.ok ? head.stdout.trim() : undefined,
    dirty: !status.ok || status.stdout.trim().length > 0,
  };
};

const cleanupValidationWorkspace = async (input: {
  readonly repoRoot: string;
  readonly tempRefName: string;
  readonly sandbox: Sandbox | undefined;
  readonly worktreePath: string | undefined;
  readonly tempRefReady: boolean;
}): Promise<ValidationWorkspaceCleanupResult> => {
  const worktree = await cleanupWorktree(input.repoRoot, input.sandbox, input.worktreePath);
  const tempRef = input.tempRefReady
    ? deleteTempRef(input.repoRoot, input.tempRefName)
    : "not_created";

  return { worktree, tempRef };
};

const cleanupWorktree = async (
  repoRoot: string,
  sandbox: Sandbox | undefined,
  worktreePath: string | undefined,
): Promise<CleanupState> => {
  if (sandbox === undefined && worktreePath === undefined) {
    return "not_created";
  }

  try {
    if (sandbox === undefined) {
      if (worktreePath === undefined || !existsSync(worktreePath)) {
        return "not_created";
      }

      const removed = git(repoRoot, ["worktree", "remove", "--force", worktreePath]);

      return removed.ok || !existsSync(worktreePath) ? "removed" : "failed";
    }

    const closeResult = await sandbox.close();
    const preservedPath = closeResult.preservedWorktreePath ?? worktreePath;

    if (preservedPath !== undefined && existsSync(preservedPath)) {
      const removed = git(repoRoot, ["worktree", "remove", "--force", preservedPath]);

      if (!removed.ok && existsSync(preservedPath)) {
        return "failed";
      }
    }

    return "removed";
  } catch {
    return "failed";
  }
};

const deleteTempRef = (repoRoot: string, tempRefName: string): CleanupState => {
  const result = git(repoRoot, ["update-ref", "-d", tempRefName]);

  if (result.ok) {
    return "removed";
  }

  return git(repoRoot, ["rev-parse", "--verify", `${tempRefName}^{commit}`]).ok
    ? "failed"
    : "removed";
};

type GitResult =
  | {
      readonly ok: true;
      readonly stdout: string;
    }
  | {
      readonly ok: false;
      readonly message: string;
    };

const git = (cwd: string, args: readonly string[]): GitResult => {
  const result = spawnSync("git", [...args], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  if (result.status === 0) {
    return { ok: true, stdout: result.stdout };
  }

  return {
    ok: false,
    message: [result.stderr.trim(), result.stdout.trim()].filter(Boolean).join("\n"),
  };
};

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);
