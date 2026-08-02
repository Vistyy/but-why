import { runtimeError, success, type CliResult } from "../../cliResults.js";
import type { ChangeReconciliationResult } from "../../change/reconcileChange.js";

export const reconcileResult = (
  changeId: string | undefined,
  result: ChangeReconciliationResult,
): CliResult => {
  if (changeId !== undefined && result.changes.length === 0) {
    return runtimeError({
      code: "change_not_found",
      message: "Change was not found.",
      help: ["Use a Change ID returned by `by change start --json`."],
    });
  }
  return result.rejected
    ? runtimeError({
        code: "reconciliation_rejected",
        message: "The owned pull request does not match the recorded Change facts.",
        details: { changes: result.changes },
        help: [
          "Inspect the Change and resolve the remote mismatch. Do not adopt the pull request.",
        ],
      })
    : success({ changes: result.changes });
};
