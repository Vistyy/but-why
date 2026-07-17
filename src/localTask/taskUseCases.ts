import { existsSync } from "node:fs";

import { openRepoLocalStores } from "../init/repoLocalStores.js";
import { loadRepoLocalContext, type LoadRepoLocalContextError } from "../init/repoContext.js";
import { openTaskUseCases, type TaskUseCases } from "../task/taskUseCases.js";

export type LoadTaskUseCasesInput = {
  readonly cwd: string;
  readonly requireState: boolean;
  readonly migrationTimestamp: () => string;
};

export type LoadTaskUseCasesResult =
  | {
      readonly ok: true;
      readonly tasks: TaskUseCases;
    }
  | {
      readonly ok: false;
      readonly error: LoadTaskUseCasesError;
    };

export type LoadTaskUseCasesError =
  | LoadRepoLocalContextError
  | {
      readonly code: "state_store_unavailable";
      readonly taskPrefix: string;
    };

export const loadTaskUseCases = (input: LoadTaskUseCasesInput): LoadTaskUseCasesResult => {
  const repoContext = loadRepoLocalContext(input.cwd, input.migrationTimestamp);

  if (!repoContext.ok) {
    return repoContext;
  }

  if (input.requireState && !existsSync(repoContext.context.paths.statePath)) {
    return {
      ok: false,
      error: {
        code: "state_store_unavailable",
        taskPrefix: repoContext.context.taskPrefix,
      },
    };
  }

  const { taskStore, taskStartStore, validationRunStore } = openRepoLocalStores(
    repoContext.context,
    input.migrationTimestamp,
  );

  return {
    ok: true,
    tasks: openTaskUseCases(repoContext.context, {
      taskStore,
      taskStartStore,
      validationRunStore,
    }),
  };
};
