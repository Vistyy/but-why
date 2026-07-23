import { Effect } from "effect";

import type { RepositoryStorageError } from "../../contracts/repositoryStorageError.js";
import type {
  CandidateCaptureChange,
  ChangeCandidateCapturePersistence,
} from "./changeCandidateCapturePersistence.js";
import type {
  ChangeCandidateCaptureGit,
  LocalCandidateWorkspace,
} from "./changeCandidateCaptureGit.js";

export type CaptureLocalCandidateInput = {
  readonly cwd: string;
  readonly now: string;
  readonly changeId?: string;
  readonly baseRef?: string;
  readonly allowRebind?: boolean;
};

export type CandidateBaseSource = "saved_change" | "caller" | "remote_default";

export type CaptureLocalCandidateResult =
  | {
      readonly ok: true;
      readonly changeId: string;
      readonly candidateId: string;
      readonly branchRef: string;
      readonly selectedBaseRef: string;
      readonly baseSource: CandidateBaseSource;
      readonly resolvedTargetSha: string;
      readonly comparisonBaseSha: string;
      readonly headSha: string;
    }
  | {
      readonly ok: false;
      readonly code:
        | "detached_head"
        | "unborn_branch"
        | "dirty_work"
        | "conflicting_branch_facts"
        | "change_not_found"
        | "change_closed"
        | "change_from_different_repository"
        | "change_rebind_not_authorized"
        | "rebind_requires_change_id"
        | "destination_branch_has_history"
        | "invalid_base_ref"
        | "base_ref_conflict"
        | "missing_remote_default"
        | "ambiguous_remote_default"
        | "local_base_unavailable"
        | "comparison_base_unavailable"
        | "candidate_provenance_conflict"
        | "capture_conflict"
        | "git_tooling_error";
    };

type CaptureRejection = Extract<CaptureLocalCandidateResult, { readonly ok: false }>;

type ChangeSelection = {
  readonly change?: CandidateCaptureChange;
  readonly rebindFromRef?: string;
};

export type ChangeCandidateCapture = {
  readonly capture: (
    input: CaptureLocalCandidateInput,
  ) => Effect.Effect<CaptureLocalCandidateResult, RepositoryStorageError>;
};

export const openChangeCandidateCapture = (dependencies: {
  readonly persistence: ChangeCandidateCapturePersistence;
  readonly git: ChangeCandidateCaptureGit;
}): ChangeCandidateCapture => ({
  capture: (input) => captureLocalCandidate(dependencies, input),
});

const captureLocalCandidate = (
  dependencies: {
    readonly persistence: ChangeCandidateCapturePersistence;
    readonly git: ChangeCandidateCaptureGit;
  },
  input: CaptureLocalCandidateInput,
): Effect.Effect<CaptureLocalCandidateResult, RepositoryStorageError> =>
  Effect.gen(function* () {
    if (input.allowRebind === true && input.changeId === undefined) {
      return { ok: false, code: "rebind_requires_change_id" } as const;
    }

    const workspace = yield* dependencies.git.readWorkspace(input.cwd);
    if (!workspace.ok) return workspace;
    const changeSelection = yield* selectChange(dependencies.persistence, input, workspace.facts);
    if (!changeSelection.ok) return changeSelection;

    const base = yield* selectBase(
      dependencies.git,
      input.cwd,
      input.baseRef,
      changeSelection.selection.change?.baseRef ?? null,
    );
    if (!base.ok) return base;
    const resolvedTargetSha = yield* dependencies.git.resolveLocalBranch(input.cwd, base.ref);
    if (resolvedTargetSha === undefined) return { ok: false, code: "local_base_unavailable" };
    const comparisonBaseSha = yield* dependencies.git.findComparisonBase(
      input.cwd,
      resolvedTargetSha,
      workspace.facts.headSha,
    );
    if (comparisonBaseSha === undefined) {
      return { ok: false, code: "comparison_base_unavailable" };
    }

    const committed = yield* dependencies.persistence.commitCapture({
      repositoryCommonDirectory: workspace.facts.repositoryCommonDirectory,
      branchRef: workspace.facts.branchRef,
      ...(changeSelection.selection.change === undefined
        ? {}
        : { expectedChangeId: changeSelection.selection.change.id }),
      ...(changeSelection.selection.rebindFromRef === undefined
        ? {}
        : { rebindFromRef: changeSelection.selection.rebindFromRef }),
      selectedBaseRef: base.ref,
      resolvedTargetSha,
      comparisonBaseSha,
      headSha: workspace.facts.headSha,
      now: input.now,
    });
    if (!committed.ok) return { ok: false, code: mapCommitError(committed.code) };

    return {
      ok: true,
      changeId: committed.changeId,
      candidateId: committed.candidateId,
      branchRef: workspace.facts.branchRef,
      selectedBaseRef: base.ref,
      baseSource: base.source,
      resolvedTargetSha,
      comparisonBaseSha,
      headSha: workspace.facts.headSha,
    };
  });

const selectChange = (
  changes: ChangeCandidateCapturePersistence,
  input: CaptureLocalCandidateInput,
  workspace: LocalCandidateWorkspace,
): Effect.Effect<
  { readonly ok: true; readonly selection: ChangeSelection } | CaptureRejection,
  RepositoryStorageError
> =>
  Effect.gen(function* () {
    const destination = yield* changes.getChangeByRepositoryBranch(
      workspace.repositoryCommonDirectory,
      workspace.branchRef,
    );
    if (input.changeId !== undefined) {
      return yield* selectSuppliedChange(
        changes,
        input.changeId,
        input.allowRebind,
        workspace,
        destination,
      );
    }
    if (workspace.renameFromRef !== undefined) {
      const renamed = yield* changes.getChangeByRepositoryBranch(
        workspace.repositoryCommonDirectory,
        workspace.renameFromRef,
      );
      if (renamed?.state === "open") {
        return destination === undefined
          ? {
              ok: true,
              selection: { change: renamed, rebindFromRef: workspace.renameFromRef },
            }
          : { ok: false, code: "destination_branch_has_history" };
      }
    }
    if (destination !== undefined) {
      return destination.state === "closed"
        ? { ok: false, code: "change_closed" }
        : { ok: true, selection: { change: destination } };
    }
    return { ok: true, selection: {} };
  });

const selectSuppliedChange = (
  changes: ChangeCandidateCapturePersistence,
  changeId: string,
  allowRebind: boolean | undefined,
  workspace: LocalCandidateWorkspace,
  destination: CandidateCaptureChange | undefined,
): Effect.Effect<
  { readonly ok: true; readonly selection: ChangeSelection } | CaptureRejection,
  RepositoryStorageError
> =>
  Effect.gen(function* () {
    const change = yield* changes.getChangeById(changeId);
    if (change === undefined) return { ok: false, code: "change_not_found" };
    if (change.state === "closed") return { ok: false, code: "change_closed" };
    if (change.repositoryCommonDirectory !== workspace.repositoryCommonDirectory) {
      return { ok: false, code: "change_from_different_repository" };
    }
    if (change.branchRef === workspace.branchRef) {
      return destination?.id === change.id
        ? { ok: true, selection: { change } }
        : { ok: false, code: "capture_conflict" };
    }
    if (workspace.renameFromRef !== undefined && workspace.renameFromRef !== change.branchRef) {
      return { ok: false, code: "conflicting_branch_facts" };
    }
    if (workspace.renameFromRef !== change.branchRef && allowRebind !== true) {
      return { ok: false, code: "change_rebind_not_authorized" };
    }
    return destination === undefined
      ? { ok: true, selection: { change, rebindFromRef: change.branchRef } }
      : { ok: false, code: "destination_branch_has_history" };
  });

type SelectedBase =
  | { readonly ok: true; readonly ref: string; readonly source: CandidateBaseSource }
  | CaptureRejection;

const selectBase = (
  git: ChangeCandidateCaptureGit,
  cwd: string,
  supplied: string | undefined,
  saved: string | null,
): Effect.Effect<SelectedBase> => {
  if (saved !== null) return selectSavedBase(git, cwd, supplied, saved);
  if (supplied !== undefined) return selectCallerBase(git, cwd, supplied);
  return selectRemoteDefaultBase(git, cwd);
};

const selectSavedBase = (
  git: ChangeCandidateCaptureGit,
  cwd: string,
  supplied: string | undefined,
  saved: string,
): Effect.Effect<SelectedBase> => {
  if (supplied !== undefined && supplied !== saved) {
    return Effect.succeed({ ok: false, code: "base_ref_conflict" });
  }
  return Effect.map(
    git.localBranchExists(cwd, saved),
    (exists): SelectedBase =>
      exists
        ? { ok: true, ref: saved, source: "saved_change" }
        : { ok: false, code: "local_base_unavailable" },
  );
};

const selectCallerBase = (
  git: ChangeCandidateCaptureGit,
  cwd: string,
  supplied: string,
): Effect.Effect<SelectedBase> => {
  if (!supplied.startsWith("refs/heads/")) {
    return Effect.succeed({ ok: false, code: "invalid_base_ref" });
  }
  return Effect.map(
    git.localBranchExists(cwd, supplied),
    (exists): SelectedBase =>
      exists
        ? { ok: true, ref: supplied, source: "caller" }
        : { ok: false, code: "local_base_unavailable" },
  );
};

const selectRemoteDefaultBase = (
  git: ChangeCandidateCaptureGit,
  cwd: string,
): Effect.Effect<SelectedBase> =>
  Effect.gen(function* () {
    const recorded = yield* git.recordedRemoteDefaultLocalBranches(cwd);
    if (recorded === undefined) return { ok: false, code: "git_tooling_error" };
    const unique = [...new Set(recorded)];
    if (unique.length === 0) return { ok: false, code: "missing_remote_default" };
    if (unique.length > 1) return { ok: false, code: "ambiguous_remote_default" };
    const ref = unique[0];
    if (ref === undefined) return { ok: false, code: "local_base_unavailable" };
    return (yield* git.localBranchExists(cwd, ref))
      ? { ok: true, ref, source: "remote_default" }
      : { ok: false, code: "local_base_unavailable" };
  });

const mapCommitError = (
  code:
    | "change_not_found"
    | "change_closed"
    | "change_binding_conflict"
    | "destination_branch_has_history"
    | "base_ref_conflict"
    | "candidate_provenance_conflict",
): CaptureRejection["code"] => (code === "change_binding_conflict" ? "capture_conflict" : code);
