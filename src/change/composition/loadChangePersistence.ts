import type { TaskChangeCancellationChangeOperations } from "../../taskChange/adapters/sqlite/sqliteTaskChangeCancellationPersistence.js";
import type { TaskChangeTerminalOperations } from "../../taskChange/adapters/sqlite/sqliteTaskChangeCompletionPersistence.js";
import type { TaskChangeCompletionOperations } from "../../taskChange/adapters/sqlite/sqliteTaskChangePersistence.js";
import type { TaskChangeStartChangeOperations } from "../../taskChange/adapters/sqlite/sqliteTaskChangeStartPersistence.js";
import {
  cancelChange,
  readCancellationChange,
} from "../adapters/sqlite/sqliteChangeCancellationPersistence.js";
import {
  createChange,
  insertLinkedChange,
  readChangeStartById,
  recordPrepareOutcome,
} from "../adapters/sqlite/sqliteChangeStartPersistence.js";
import { completeMergedChange } from "../adapters/sqlite/sqliteCompleteMergedChangeStorage.js";
import { requireTerminalChange } from "../adapters/sqlite/sqliteTerminalChangeStorage.js";

export const taskChangeStartChangeOperations: TaskChangeStartChangeOperations = {
  createChange,
  insertLinkedChange,
  readChangeStartById,
  recordPrepareOutcome,
};

export const taskChangeCancellationChangeOperations: TaskChangeCancellationChangeOperations = {
  cancelChange,
  readCancellationChange,
};

export const taskChangeCompletionChangeOperations: Pick<
  TaskChangeCompletionOperations,
  "completeChange"
> = {
  completeChange: completeMergedChange,
};

export const taskChangeTerminalOperations: TaskChangeTerminalOperations = {
  requireTerminalChange,
};
