import { openSqliteTaskStore } from "../../src/sqlite/sqliteTaskStore.js";
import type { TaskStore } from "../../src/task/taskStore.js";
import { createSqliteState } from "./sqliteState.js";

export const createTaskStore = (taskPrefix = "BY"): TaskStore =>
  openSqliteTaskStore({ ...createSqliteState(), taskPrefix });
