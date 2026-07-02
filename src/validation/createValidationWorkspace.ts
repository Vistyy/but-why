import { existsSync } from "node:fs";
import { join } from "node:path";

import { createSandbox, type Sandbox } from "@ai-hero/sandcastle";
import { noSandbox } from "@ai-hero/sandcastle/sandboxes/no-sandbox";

import {
  cleanupValidationWorkspace,
  ensureValidationTempRef,
  expectedSandcastleWorktreePath,
  inspectExistingWorktree,
  removeValidationWorktree,
  validationTempRefName,
  type ValidationWorkspaceCleanupResult,
} from "./validationGitGlue.js";

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
    const removed = removeValidationWorktree(input.repoRoot, expectedWorktreePath);

    if (!removed && existsSync(expectedWorktreePath)) {
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

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);
