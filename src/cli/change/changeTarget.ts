import { Effect } from "effect";
import { hasPublicChangeIdShape } from "../../change/changeId.js";
import { loadChangeList } from "../../change/composition/loadChangeInspection.js";
import {
  type CliResult,
  repoStateLoadError,
  repositoryStorageErrorResult,
  runtimeError,
} from "../../cliResults.js";
import { findCurrentRepositoryWorktreeFacts } from "../../repositoryRuntime/repositoryContext.js";

type ChangeTargetResolution =
  | { readonly ok: true; readonly changeId: string }
  | { readonly ok: false; readonly result: CliResult };

export const resolveChangeId = (
  changeId: string | undefined,
  cwd: string,
  commandName: string,
  operationalRepoRoot?: string,
): Effect.Effect<ChangeTargetResolution> => {
  if (changeId !== undefined) {
    return Effect.succeed(
      hasPublicChangeIdShape(changeId)
        ? { ok: true, changeId }
        : {
            ok: false,
            result: runtimeError({
              code: "change_not_found",
              message: "Change was not found.",
              help: ["Use a Change ID returned by `by change list --all`."],
            }),
          },
    );
  }

  const loaded = loadChangeList({
    cwd,
    ...(operationalRepoRoot === undefined ? {} : { operationalRepoRoot }),
  });
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
