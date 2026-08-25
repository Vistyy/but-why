import { Effect } from "effect";
import type { RepoConfig } from "../contracts/repoConfig.js";
import type { RepositoryStorageError } from "../contracts/repositoryStorageError.js";
import {
  type RepositoryPreparationEffectExecutor,
  runRepositoryPreparationEffect,
} from "../repositoryPreparation/runRepositoryPreparation.js";
import { type ChangePrepareFailure, changeState } from "./change.js";
import type { ChangePolicyResolution, ChangePolicyResolutionFailure } from "./changePolicy.js";
import type {
  ChangeStartGitOperations,
  ProvisionChangeWorktreeFailure,
  ResolveChangeStartGitResult,
} from "./changeStartGitOperations.js";
import type {
  ChangeStartCreationResult,
  ChangeStartPersistence,
} from "./changeStartPersistence.js";
import type { ChangeStartRecord } from "./changeStartStore.js";
import type { InteractiveSessionHost } from "./interactiveSession/interactiveSessionHost.js";
import type { InteractiveSessionProfileLoader } from "./interactiveSession/interactiveSessionProfile.js";
import type { ChangeImplementResult } from "./interactiveSession/launchInteractiveImplementer.js";
import { launchInteractiveImplementer } from "./interactiveSession/launchInteractiveImplementer.js";

export type { ChangeImplementResult };

export type ChangeStartResult =
  | { readonly ok: true; readonly change: ChangeStartRecord }
  | ChangePolicyResolutionFailure
  | Exclude<ResolveChangeStartGitResult, { readonly ok: true }>
  | Exclude<ChangeStartCreationResult, { readonly ok: true }>
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
    readonly resolvePolicy: (startingCommit: string) => Effect.Effect<ChangePolicyResolution>;
    readonly now: string;
  },
): Effect.Effect<ChangeStartResult | CreationFailure, RepositoryStorageError> =>
  Effect.gen(function* () {
    const gitIntent = git.resolveIntent(input.baseBranch);
    if (!gitIntent.ok) return gitIntent;
    const policy = yield* input.resolvePolicy(gitIntent.intent.startingCommit);
    if (!policy.ok) return policy;
    const created = yield* store.create({
      baseRef: gitIntent.intent.baseRef,
      baseRemoteUrl: gitIntent.intent.baseRemoteUrl,
      managedWorktreeParent: gitIntent.intent.managedWorktreeParent,
      policy: policy.policy,
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
    const prepare = change.policy.prepare;
    if (prepare === null) {
      const recorded = yield* store.recordPrepareOutcome(change.id, null, now);
      return { ok: true as const, change: recorded };
    }

    const outcome = yield* runRepositoryPreparationEffect({
      prepare,
      exec: executor,
      cwd: change.worktreePath,
    }).pipe(
      Effect.mapError(
        (error): ChangePrepareFailure => ({
          command: prepare.command,
          exitCode: 1,
          timedOut: false,
          stdout: "",
          stderr: error instanceof Error ? error.message : String(error),
        }),
      ),
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
