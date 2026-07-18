import type { ChangeCloseReason, ChangeRecord } from "./change.js";

export type ChangeStore = {
  readonly createChange: (input: CreateChangeInput) => CreateChangeResult;
  readonly getChangeById: (changeId: string) => ChangeRecord | undefined;
  readonly getChangeByRepositoryBranch: (
    repositoryCommonDirectory: string,
    branchRef: string,
  ) => ChangeRecord | undefined;
  readonly closeChange: (input: CloseChangeInput) => CloseChangeResult;
};

export type CreateChangeInput = {
  readonly repositoryCommonDirectory: string;
  readonly branchRef: string;
  readonly taskId?: string;
  readonly now: string;
};

export type CloseChangeInput = {
  readonly changeId: string;
  readonly reason: ChangeCloseReason;
  readonly now: string;
};

export type CloseChangeResult =
  | { readonly ok: true; readonly changed: boolean; readonly change: ChangeRecord }
  | { readonly ok: false; readonly code: "change_not_found" }
  | {
      readonly ok: false;
      readonly code: "change_already_closed";
      readonly reason: ChangeCloseReason;
    };

export type CreateChangeResult =
  | { readonly ok: true; readonly change: ChangeRecord }
  | {
      readonly ok: false;
      readonly code: "repository_branch_already_linked" | "task_already_linked" | "task_not_found";
    };
