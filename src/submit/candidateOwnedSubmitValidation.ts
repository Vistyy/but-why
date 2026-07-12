import { captureLocalCandidate } from "../changeCandidateCapture/captureLocalCandidate.js";
import type { RepoLocalContext } from "../init/repoContext.js";
import type { RepoLocalStores } from "../init/repoLocalStores.js";
import { resolveSubmitPolicySnapshot, type SubmitRepoConfig } from "./submitRepoConfig.js";
import type { PublicTaskId } from "../task/taskId.js";
import { resolveAutomaticFixing } from "../validationRun/automaticFixing.js";
import { resolveCopiedFiles } from "../validationRun/copiedFiles.js";
import { taskContextSnapshotV1 } from "../validationRun/taskContextSnapshot.js";
import type {
  CandidateValidationRunRecord,
  RequestValidationResult,
} from "../validationRun/candidateValidationRun.js";

export type CandidateOwnedSubmitValidationResult =
  | {
      readonly ok: true;
      readonly changeId: string;
      readonly candidateId: string;
      readonly run: CandidateValidationRunRecord;
      readonly request: Extract<RequestValidationResult, { readonly ok: true }>;
    }
  | {
      readonly ok: false;
      readonly code:
        | "candidate_capture_failed"
        | "task_change_link_failed"
        | "task_change_mismatch"
        | "policy_resolution_failed"
        | "task_context_missing"
        | "copied_file_resolution_failed"
        | Extract<RequestValidationResult, { readonly ok: false }>["code"];
    };

export const requestCandidateOwnedSubmitValidation = (input: {
  readonly context: RepoLocalContext;
  readonly taskStore: RepoLocalStores["taskStore"];
  readonly changeStore: RepoLocalStores["changeStore"];
  readonly candidateValidationRunStore: RepoLocalStores["candidateValidationRunStore"];
  readonly validationConfig: SubmitRepoConfig;
  readonly taskId: PublicTaskId;
  readonly automaticFixingOverride?: {
    readonly enabled?: boolean;
    readonly command?: string;
  };
  readonly now: string;
}): CandidateOwnedSubmitValidationResult => {
  const captured = captureLocalCandidate({ cwd: input.context.root, now: input.now });
  if (!captured.ok) return { ok: false, code: "candidate_capture_failed" };

  const linked = input.changeStore.linkTask({
    changeId: captured.changeId,
    taskId: input.taskId,
    now: input.now,
  });
  if (!linked.ok && linked.code !== "change_already_linked_to_task") {
    return { ok: false, code: "task_change_link_failed" };
  }
  const linkedChange = input.changeStore.getChangeById(captured.changeId);
  if (linkedChange?.taskId !== input.taskId) {
    return { ok: false, code: "task_change_mismatch" };
  }

  const policy = resolveSubmitPolicySnapshot({
    config: input.validationConfig,
    repositoryRoot: input.context.root,
  });
  if (!policy.ok) return { ok: false, code: "policy_resolution_failed" };

  const taskContext = input.taskStore.getTaskContextById(input.taskId);
  if (taskContext === undefined) return { ok: false, code: "task_context_missing" };

  const copiedFiles = resolveCopiedFiles(
    input.context.root,
    input.context.config.validationWorkspace?.copyFiles ?? [],
  );
  if (!copiedFiles.ok) return { ok: false, code: "copied_file_resolution_failed" };

  const request = input.candidateValidationRunStore.requestValidation({
    changeId: captured.changeId,
    candidateId: captured.candidateId,
    taskId: input.taskId,
    policySnapshot: policy.snapshot,
    automaticFixing: resolveAutomaticFixing({
      origin: "manual",
      repoConfigValue: input.validationConfig.automaticFixing,
      ...(input.automaticFixingOverride?.enabled === undefined
        ? {}
        : { enabledOverride: input.automaticFixingOverride.enabled }),
      ...(input.automaticFixingOverride?.command === undefined
        ? {}
        : { commandOverride: input.automaticFixingOverride.command }),
    }),
    acceptanceContext: taskContextSnapshotV1(taskContext),
    copiedFiles: copiedFiles.files,
    now: input.now,
  });
  if (!request.ok) return request;

  return {
    ok: true,
    changeId: captured.changeId,
    candidateId: captured.candidateId,
    run: request.run,
    request,
  };
};
