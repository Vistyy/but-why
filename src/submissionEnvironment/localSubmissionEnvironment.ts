import { Effect } from "effect";

import type { RepoLocalContext } from "../init/repoContext.js";
import { createValidationWorkspace } from "../validation/createValidationWorkspace.js";
import { readGitFacts } from "./gitFacts.js";
import { detectGitHubPrTarget, protectedBranchNames } from "./githubTarget.js";
import type {
  CreateValidationWorkspaceForValidationRunInput,
  CreateValidationWorkspaceForValidationRunResult,
  SubmittedCodeCandidateResult,
  SubmissionEnvironment,
} from "./submissionEnvironment.js";

export const localSubmissionEnvironment = (input: {
  readonly context: RepoLocalContext;
}): SubmissionEnvironment => ({
  readSubmittedCodeCandidate: () => readSubmittedCodeCandidate(input.context),
  createValidationWorkspaceForValidationRun: (workspaceInput) =>
    createValidationWorkspaceForValidationRun(input.context, workspaceInput),
});

const readSubmittedCodeCandidate = (context: RepoLocalContext): SubmittedCodeCandidateResult => {
  const gitFacts = readGitFacts(context.root, undefined, {
    allowedUntrackedFiles: context.config.validationWorkspace?.copyFiles ?? [],
  });

  if (!gitFacts.ok) {
    if (gitFacts.code === "GIT_TOOLING_ERROR") {
      return { ok: false, kind: "tooling_error" };
    }

    return {
      ok: false,
      kind: "preflight_rejection",
      code: gitFacts.code,
    };
  }

  if (protectedBranchNames.has(gitFacts.facts.branch)) {
    return {
      ok: false,
      kind: "preflight_rejection",
      code: "PROTECTED_BRANCH",
      branch: gitFacts.facts.branch,
    };
  }

  const prTarget = detectGitHubPrTarget(context.root, gitFacts.facts.branch);

  if (!prTarget.ok) {
    if (prTarget.code === "GITHUB_TOOLING_ERROR") {
      return { ok: false, kind: "tooling_error" };
    }

    return {
      ok: false,
      kind: "preflight_rejection",
      code: "PR_TARGET_NOT_FOUND",
    };
  }

  if (gitFacts.facts.branch === prTarget.target.baseBranch) {
    return {
      ok: false,
      kind: "preflight_rejection",
      code: "PROTECTED_BRANCH",
      branch: gitFacts.facts.branch,
    };
  }

  return {
    ok: true,
    candidate: {
      branch: gitFacts.facts.branch,
      commitSha: gitFacts.facts.commitSha,
      prTarget: prTarget.target,
    },
  };
};

const createValidationWorkspaceForValidationRun = (
  context: RepoLocalContext,
  input: CreateValidationWorkspaceForValidationRunInput,
): Effect.Effect<CreateValidationWorkspaceForValidationRunResult> =>
  Effect.map(
    createValidationWorkspace({
      repoRoot: context.root,
      validationRunId: input.validationRunId,
      submittedSha: input.commitSha,
      copyFiles: context.config.validationWorkspace?.copyFiles ?? [],
      ...(input.recordInterruptedCleanupResult === undefined
        ? {}
        : { recordInterruptedCleanupResult: input.recordInterruptedCleanupResult }),
    }),
    (result) => {
      if (!result.ok) {
        return { ok: false, toolingError: result.toolingError };
      }

      return { ok: true, validationWorkspace: result.setup };
    },
  );
