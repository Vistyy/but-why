import { runtimeError, success, type CliResult } from "../../cliResults.js";
import type { ChangeReconciliationResult } from "../../change/reconcileChange.js";

export const reconcileResult = (
  changeId: string | undefined,
  result: ChangeReconciliationResult,
  discardWork: boolean,
): CliResult => {
  if (changeId !== undefined && result.changes.length === 0) {
    return runtimeError({
      code: "change_not_found",
      message: "Change was not found.",
      help: ["Use a Change ID returned by `by change start --json`."],
    });
  }
  if (result.changes.some((change) => change.status === "unavailable")) {
    return runtimeError({
      code: "reconciliation_unavailable",
      message: "The owned pull request facts are temporarily unavailable.",
      details: { changes: result.changes },
      help: ["Restore GitHub access and the pull request, then retry reconciliation."],
    });
  }
  if (result.rejected) {
    if (result.changes.some((change) => change.rejection === "discard_open_change")) {
      return runtimeError({
        code: "discard_open_change",
        message: "Work discard requires one exact terminal Change.",
        details: { changes: result.changes },
        help: [
          "Complete or cancel the Change first, then retry `by change reconcile <change-id> --discard-work`.",
        ],
      });
    }
    return runtimeError({
      code: "reconciliation_rejected",
      message: "The owned pull request does not match the recorded Change facts.",
      details: { changes: result.changes },
      help: ["Inspect the Change and resolve the remote mismatch. Do not adopt the pull request."],
    });
  }
  const pendingDiscard =
    discardWork &&
    result.changes.some(
      (change) =>
        change.status === "cleanup_pending" ||
        (change.cleanup !== undefined && change.cleanup.state === "pending"),
    );
  return success({
    changes: result.changes,
    ...(pendingDiscard && changeId !== undefined
      ? {
          help: [
            `Discard cleanup is pending. Retry the exact discard with \`by change reconcile ${changeId} --discard-work\`.`,
          ],
        }
      : {}),
  });
};
