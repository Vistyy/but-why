import { join } from "node:path";

import type { ChangeRecord } from "../change/change.js";
import type { ChangeStore } from "../change/changeStore.js";
import { openChangeCandidateCaptureStores } from "../init/repoLocalStores.js";
import {
  findComparisonBase,
  localBranchExists,
  readLocalCandidateWorkspace,
  recordedRemoteDefaultLocalBranches,
  resolveLocalBranch,
  type LocalCandidateWorkspace,
} from "./localGitCandidate.js";

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
        | "shared_state_identity_conflict"
        | "git_tooling_error";
    };

type CaptureRejection = Extract<CaptureLocalCandidateResult, { readonly ok: false }>;

type ChangeSelection = {
  readonly change?: ChangeRecord;
  readonly rebindFromRef?: string;
};

export const captureLocalCandidate = (
  input: CaptureLocalCandidateInput,
): CaptureLocalCandidateResult => {
  if (input.allowRebind === true && input.changeId === undefined) {
    return { ok: false, code: "rebind_requires_change_id" };
  }

  const workspace = readLocalCandidateWorkspace(input.cwd);
  if (!workspace.ok) return workspace;
  const sqliteInput = {
    statePath: join(workspace.facts.repositoryCommonDirectory, "but-why", "state.sqlite"),
    migrationTimestamp: () => input.now,
    commonDirectory: workspace.facts.repositoryCommonDirectory,
  };
  const storesResult = openChangeCandidateCaptureStores(sqliteInput);
  if (!storesResult.ok) return storesResult;
  const changeSelection = selectChange(storesResult.stores.changeStore, input, workspace.facts);
  if (!changeSelection.ok) return changeSelection;

  const base = selectBase(
    input.cwd,
    input.baseRef,
    changeSelection.selection.change?.baseRef ?? null,
  );
  if (!base.ok) return base;
  const resolvedTargetSha = resolveLocalBranch(input.cwd, base.ref);
  if (resolvedTargetSha === undefined) return { ok: false, code: "local_base_unavailable" };
  const comparisonBaseSha = findComparisonBase(
    input.cwd,
    resolvedTargetSha,
    workspace.facts.headSha,
  );
  if (comparisonBaseSha === undefined) {
    return { ok: false, code: "comparison_base_unavailable" };
  }

  const committed = storesResult.stores.captureStore.commitCapture({
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
};

const selectChange = (
  changes: ChangeStore,
  input: CaptureLocalCandidateInput,
  workspace: LocalCandidateWorkspace,
): { readonly ok: true; readonly selection: ChangeSelection } | CaptureRejection => {
  const destination = changes.getChangeByRepositoryBranch(
    workspace.repositoryCommonDirectory,
    workspace.branchRef,
  );
  if (input.changeId !== undefined) {
    return selectSuppliedChange(changes, input.changeId, input.allowRebind, workspace, destination);
  }
  if (workspace.renameFromRef !== undefined) {
    const renamed = changes.getChangeByRepositoryBranch(
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
};

const selectSuppliedChange = (
  changes: ChangeStore,
  changeId: string,
  allowRebind: boolean | undefined,
  workspace: LocalCandidateWorkspace,
  destination: ChangeRecord | undefined,
): { readonly ok: true; readonly selection: ChangeSelection } | CaptureRejection => {
  const change = changes.getChangeById(changeId);
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
};

type SelectedBase =
  | { readonly ok: true; readonly ref: string; readonly source: CandidateBaseSource }
  | CaptureRejection;

const selectBase = (
  cwd: string,
  supplied: string | undefined,
  saved: string | null,
): SelectedBase => {
  if (saved !== null) return selectSavedBase(cwd, supplied, saved);
  if (supplied !== undefined) return selectCallerBase(cwd, supplied);
  return selectRemoteDefaultBase(cwd);
};

const selectSavedBase = (
  cwd: string,
  supplied: string | undefined,
  saved: string,
): SelectedBase => {
  if (supplied !== undefined && supplied !== saved) return { ok: false, code: "base_ref_conflict" };
  return localBranchExists(cwd, saved)
    ? { ok: true, ref: saved, source: "saved_change" }
    : { ok: false, code: "local_base_unavailable" };
};

const selectCallerBase = (cwd: string, supplied: string): SelectedBase => {
  if (!supplied.startsWith("refs/heads/")) return { ok: false, code: "invalid_base_ref" };
  return localBranchExists(cwd, supplied)
    ? { ok: true, ref: supplied, source: "caller" }
    : { ok: false, code: "local_base_unavailable" };
};

const selectRemoteDefaultBase = (cwd: string): SelectedBase => {
  const recorded = recordedRemoteDefaultLocalBranches(cwd);
  if (recorded === undefined) return { ok: false, code: "git_tooling_error" };
  const unique = [...new Set(recorded)];
  if (unique.length === 0) return { ok: false, code: "missing_remote_default" };
  if (unique.length > 1) return { ok: false, code: "ambiguous_remote_default" };
  const ref = unique[0];
  return ref !== undefined && localBranchExists(cwd, ref)
    ? { ok: true, ref, source: "remote_default" }
    : { ok: false, code: "local_base_unavailable" };
};

const mapCommitError = (
  code:
    | "change_not_found"
    | "change_closed"
    | "change_binding_conflict"
    | "destination_branch_has_history"
    | "base_ref_conflict"
    | "candidate_provenance_conflict",
): CaptureRejection["code"] => (code === "change_binding_conflict" ? "capture_conflict" : code);
