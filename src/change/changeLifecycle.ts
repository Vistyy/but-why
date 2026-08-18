import { Effect } from "effect";
import type { RepoConfig } from "../contracts/repoConfig.js";
import type { RepositoryStorageError } from "../contracts/repositoryStorageError.js";
import {
  type RepositoryPreparationEffectExecutor,
  runRepositoryPreparationEffect,
} from "../repositoryPreparation/runRepositoryPreparation.js";
import { type ChangePrepareFailure, changeState } from "./change.js";
import type {
  ChangeStartGitOperations,
  ProvisionChangeWorktreeFailure,
  ResolveChangeStartGitResult,
} from "./changeStartGitOperations.js";
import type { ChangeStartPersistence } from "./changeStartPersistence.js";
import type { ChangeReviewerConfiguration, ChangeStartRecord } from "./changeStartStore.js";
import type { InteractiveSessionHost } from "./interactiveSession/interactiveSessionHost.js";
import type { InteractiveSessionProfileLoader } from "./interactiveSession/interactiveSessionProfile.js";
import type { ChangeImplementResult } from "./interactiveSession/launchInteractiveImplementer.js";
import { launchInteractiveImplementer } from "./interactiveSession/launchInteractiveImplementer.js";

export type { ChangeImplementResult };

export type ChangeStartResult =
  | { readonly ok: true; readonly change: ChangeStartRecord }
  | {
      readonly ok: false;
      readonly code: "reviewer_configuration_invalid";
      readonly message: string;
    }
  | Exclude<ResolveChangeStartGitResult, { readonly ok: true }>
  | (ProvisionChangeWorktreeFailure & { readonly change: ChangeStartRecord });

export type ChangePrepareResult =
  | { readonly ok: true; readonly change: ChangeStartRecord }
  | { readonly ok: false; readonly code: "change_not_found" }
  | { readonly ok: false; readonly code: "change_not_open" }
  | (ProvisionChangeWorktreeFailure & { readonly change: ChangeStartRecord });

export const startChange = <CreationFailure extends object = never>(
  store: ChangeStartPersistence<CreationFailure>,
  git: ChangeStartGitOperations,
  executor: RepositoryPreparationEffectExecutor,
  input: {
    readonly baseBranch?: string;
    readonly reviewerConfiguration?: ChangeReviewerConfiguration;
    readonly resolveReviewerConfiguration?: (
      startingCommit: string,
    ) => Effect.Effect<
      | { readonly ok: true; readonly configuration: ChangeReviewerConfiguration }
      | { readonly ok: false; readonly message: string }
    >;
    readonly now: string;
  },
): Effect.Effect<ChangeStartResult | CreationFailure, RepositoryStorageError> =>
  Effect.gen(function* () {
    if (
      input.reviewerConfiguration === undefined &&
      input.resolveReviewerConfiguration === undefined
    ) {
      return {
        ok: false as const,
        code: "reviewer_configuration_invalid" as const,
        message: "A reviewer configuration is required to create a Change.",
      };
    }

    const gitIntent = git.resolveIntent("pending-change-start", input.baseBranch);
    if (!gitIntent.ok) return gitIntent;
    const resolveReviewerConfiguration = input.resolveReviewerConfiguration;
    const reviewerConfiguration =
      input.reviewerConfiguration !== undefined
        ? { ok: true as const, configuration: input.reviewerConfiguration }
        : resolveReviewerConfiguration === undefined
          ? undefined
          : yield* resolveReviewerConfiguration(gitIntent.intent.startingCommit);
    if (reviewerConfiguration === undefined || !reviewerConfiguration.ok) {
      return {
        ok: false as const,
        code: "reviewer_configuration_invalid" as const,
        message:
          reviewerConfiguration?.message ??
          "A reviewer configuration is required to create a Change.",
      };
    }
    const created = yield* store.create({
      id: "pending-change-start",
      ...gitIntent.intent,
      reviewerConfiguration: reviewerConfiguration.configuration,
      now: input.now,
    });
    if (!("ok" in created)) return created;
    if (!created.ok) return created;

    const provisioned = git.provisionWorktree(
      created.change,
      false,
      gitIntent.intent.startingCommit,
    );
    if (!provisioned.ok) return { ...provisioned, change: created.change };
    return yield* prepareExistingChange(store, executor, created.change, input.now);
  });

export const prepareChange = (
  store: ChangeStartPersistence,
  git: ChangeStartGitOperations,
  executor: RepositoryPreparationEffectExecutor,
  changeId: string,
  now: string,
): Effect.Effect<ChangePrepareResult, RepositoryStorageError> =>
  Effect.gen(function* () {
    const change = yield* store.getById(changeId);
    if (change === undefined) return { ok: false, code: "change_not_found" };
    if (change.state !== changeState.open) return { ok: false, code: "change_not_open" };
    const provisioned = git.provisionWorktree(change, true);
    if (!provisioned.ok) return { ...provisioned, change };
    return yield* prepareExistingChange(store, executor, change, now);
  });

export const implementChange = (
  repositoryPath: string,
  repoConfig: RepoConfig,
  store: ChangeStartPersistence,
  interactiveSessionHost: InteractiveSessionHost,
  globalConfigPath: string,
  profileLoader: InteractiveSessionProfileLoader,
  changeId: string,
  implementerPrompt: string | undefined,
): Effect.Effect<ChangeImplementResult, RepositoryStorageError> =>
  Effect.gen(function* () {
    const change = yield* store.getById(changeId);
    if (change === undefined) return { ok: false, code: "change_not_found" };
    if (change.state !== changeState.open) return { ok: false, code: "change_not_open" };
    return yield* launchInteractiveImplementer({
      repositoryPath,
      repoConfig,
      change,
      interactiveSessionHost,
      globalConfigPath,
      profileLoader,
      implementerPrompt,
    });
  });

type PreparationResult = { readonly ok: true; readonly change: ChangeStartRecord };

export const prepareExistingChange = (
  store: Pick<ChangeStartPersistence, "recordPrepareOutcome">,
  executor: RepositoryPreparationEffectExecutor,
  change: ChangeStartRecord,
  now: string,
): Effect.Effect<PreparationResult, RepositoryStorageError> =>
  Effect.gen(function* () {
    const prepare = change.prepare;
    if (prepare === null) {
      const recorded = yield* store.recordPrepareOutcome(change.id, null, now);
      return { ok: true as const, change: recorded };
    }

    const outcome = yield* runRepositoryPreparationEffect({
      prepare,
      exec: executor,
      cwd: change.worktreePath,
    })
      .pipe(
        Effect.mapError(
          (error): ChangePrepareFailure => ({
            command: prepare.command,
            exitCode: 1,
            timedOut: false,
            stdout: "",
            stderr: error instanceof Error ? error.message : String(error),
          }),
        ),
      )
      .pipe(
        Effect.match({
          onFailure: (failure) => ({ ok: false as const, failure }),
          onSuccess: (result) => ({ ok: true as const, result }),
        }),
      );

    const failure =
      outcome.ok && outcome.result.exitCode === 0
        ? null
        : outcome.ok
          ? outcome.result
          : outcome.failure;
    const recorded = yield* store.recordPrepareOutcome(change.id, failure, now);
    return { ok: true as const, change: recorded };
  });
