import { Effect } from "effect";
import { hasPublicChangeIdShape, isPublicChangeIdForPrefix } from "../../change/changeId.js";
import { loadChangeList } from "../../change/composition/loadChangeInspection.js";
import {
  type CliResult,
  repoStateLoadError,
  repositoryStorageErrorResult,
  runtimeError,
} from "../../cliResults.js";
import { findCurrentRepositoryWorktreeFacts } from "../../repositoryRuntime/repositoryContext.js";
import { resolveRepositoryIdPrefix } from "../../repositoryRuntime/repositoryRuntime.js";

type ChangeTargetResolution =
  | { readonly ok: true; readonly changeId: string }
  | { readonly ok: false; readonly result: CliResult };

export const rejectedExplicitChangeId = (changeId: string, cwd: string): CliResult | undefined => {
  const idPrefix = hasPublicChangeIdShape(changeId) ? resolveRepositoryIdPrefix(cwd) : undefined;
  if (idPrefix === undefined && hasPublicChangeIdShape(changeId)) return undefined;
  return idPrefix !== undefined && isPublicChangeIdForPrefix(changeId, idPrefix)
    ? undefined
    : runtimeError({
        code: "change_not_found",
        message: "Change was not found.",
        help: ["Use a Change ID returned by `by change list --all`."],
      });
};

export const resolveChangeId = (
  changeId: string | undefined,
  cwd: string,
  commandName: string,
): Effect.Effect<ChangeTargetResolution> => {
  if (changeId !== undefined) {
    const rejected = rejectedExplicitChangeId(changeId, cwd);
    return Effect.succeed(
      rejected === undefined ? { ok: true, changeId } : { ok: false, result: rejected },
    );
  }

  const loaded = loadChangeList({ cwd });
  if (!loaded.ok) return Effect.succeed({ ok: false, result: repoStateLoadError(loaded.error) });

  const facts = findCurrentRepositoryWorktreeFacts(cwd);
  if (!facts.ok) return Effect.succeed(unresolvedChangeTarget(commandName));

  return loaded
    .operation({
      repositoryCommonDirectory: loaded.commonDirectory,
      includeClosed: false,
    })
    .pipe(
      Effect.map((changes) => {
        const matches = changes.filter(
          (change) =>
            change.worktreePath === facts.worktreePath && change.branchRef === facts.branchRef,
        );
        const match = matches[0];
        return matches.length === 1 && match !== undefined
          ? { ok: true as const, changeId: match.id }
          : unresolvedChangeTarget(
              commandName,
              facts.worktreePath,
              facts.branchRef,
              matches.length,
            );
      }),
      Effect.catchAll((error) =>
        Effect.succeed({ ok: false as const, result: repositoryStorageErrorResult(error) }),
      ),
      Effect.catchAllCause(() => Effect.succeed(unresolvedChangeTarget(commandName))),
    );
};

const unresolvedChangeTarget = (
  commandName: string,
  worktreePath?: string,
  branchRef?: string,
  matchCount?: number,
): ChangeTargetResolution => ({
  ok: false,
  result: runtimeError({
    code: "change_context_unresolved",
    message: "The current Git worktree does not match exactly one recorded Managed Worktree.",
    details: {
      ...(worktreePath === undefined ? {} : { worktreePath }),
      ...(branchRef === undefined ? {} : { repositoryBranch: branchRef }),
      ...(matchCount === undefined ? {} : { matchCount }),
    },
    help: [`Rerun this command with <change-id>: \`by change ${commandName} <change-id>\`.`],
  }),
});
